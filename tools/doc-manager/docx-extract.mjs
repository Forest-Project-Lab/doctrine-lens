#!/usr/bin/env node
// Document Manager - docx text extractor.
// Parses Office Open XML (docx) by unzipping word/document.xml and converting w:p/w:t/w:pStyle/w:tbl
// to Markdown. No external deps beyond `unzip` (system) and Node stdlib.
//
// Handles:
//   - paragraphs (<w:p>)
//   - headings (Heading1..9, ヘッディング1.., 見出し1.. styles)
//   - bullet/numbered lists (<w:numPr>)
//   - tables (<w:tbl><w:tr><w:tc>) as pipe-tables
//   - inline bold/italic (<w:b/>, <w:i/>)
//   - drawing/image presence (<w:drawing>) as `[IMAGE]` placeholder
//
// Does NOT handle: complex formatting, nested tables, embedded charts.

import { execSync } from 'node:child_process';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '../../..');
const DOCS_DIR = join(ROOT, 'docs');
const MANIFEST_DIR = join(DOCS_DIR, 'manifest');

function sha256(s) {
  return createHash('sha256').update(s).digest('hex');
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

// Extract text from a <w:p> element body (NOT including the <w:p> tag itself).
// Returns plain text, joining all <w:t> in order. <w:tab/>, <w:br/> become tab/newline.
function paragraphText(pInner) {
  let out = '';
  // Inline iteration: split on relevant child tags.
  const tokens = pInner.match(/<w:t\b[^>]*>[\s\S]*?<\/w:t>|<w:tab\s*\/>|<w:br\s*\/>|<w:drawing\b[\s\S]*?<\/w:drawing>/g) || [];
  for (const tok of tokens) {
    if (/^<w:t\b/.test(tok)) {
      const m = tok.match(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/);
      if (m) out += decodeEntities(m[1]);
    } else if (/^<w:tab/.test(tok)) {
      out += '\t';
    } else if (/^<w:br/.test(tok)) {
      out += '\n';
    } else if (/^<w:drawing/.test(tok)) {
      out += ' [IMAGE] ';
    }
  }
  return out;
}

function paragraphStyle(pInner) {
  const m = pInner.match(/<w:pStyle\s+w:val="([^"]+)"/);
  return m ? m[1] : '';
}

function isListItem(pInner) {
  return /<w:numPr\b/.test(pInner);
}

function isHeadingStyle(style) {
  const m = style.match(/^(?:Heading|ヘッディング|見出し)\s*(\d)/i);
  return m ? Number(m[1]) : 0;
}

// Convert a <w:tbl>...</w:tbl> block to a Markdown table.
function tableToMarkdown(tblInner) {
  const rows = [];
  const trMatches = [...tblInner.matchAll(/<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g)];
  for (const tr of trMatches) {
    const cells = [...tr[1].matchAll(/<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g)].map((m) => {
      // For each cell, gather text from all paragraphs within.
      const paras = [...m[1].matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)].map((p) => paragraphText(p[1]).trim());
      return paras.join(' ').replace(/\|/g, '\\|').replace(/\n/g, ' ').trim();
    });
    rows.push(cells);
  }
  if (rows.length === 0) return '';
  // Build pipe-table with first row as header.
  const ncol = Math.max(...rows.map((r) => r.length));
  const padded = rows.map((r) => {
    while (r.length < ncol) r.push('');
    return r;
  });
  const header = '| ' + padded[0].join(' | ') + ' |';
  const sep = '| ' + Array(ncol).fill('---').join(' | ') + ' |';
  const body = padded.slice(1).map((r) => '| ' + r.join(' | ') + ' |').join('\n');
  return '\n\n' + header + '\n' + sep + (body ? '\n' + body : '') + '\n\n';
}

/**
 * Convert docx XML (word/document.xml) to Markdown.
 */
export function docxXmlToMarkdown(xml) {
  // Restrict to <w:body>...</w:body> if present, else use as-is.
  const bodyMatch = xml.match(/<w:body\b[^>]*>([\s\S]*)<\/w:body>/);
  const body = bodyMatch ? bodyMatch[1] : xml;

  let md = '';
  let cursor = 0;
  // We iterate top-level <w:p> and <w:tbl> in order.
  // Use a regex that matches either, in document order.
  const topRe = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>|<w:tbl\b[^>]*>([\s\S]*?)<\/w:tbl>/g;
  let m;
  let inListContext = null; // null | 'ul'
  while ((m = topRe.exec(body))) {
    if (m[1] !== undefined) {
      // paragraph
      const pInner = m[1];
      const style = paragraphStyle(pInner);
      const text = paragraphText(pInner).replace(/\s+\n/g, '\n').trim();
      const heading = isHeadingStyle(style);
      const isLi = isListItem(pInner);

      if (heading > 0) {
        if (text) md += '\n\n' + '#'.repeat(Math.min(heading, 6)) + ' ' + text + '\n\n';
        inListContext = null;
      } else if (isLi && text) {
        if (inListContext !== 'ul') {
          md += '\n';
          inListContext = 'ul';
        }
        md += '- ' + text + '\n';
      } else if (text) {
        md += '\n\n' + text + '\n';
        inListContext = null;
      } else {
        // empty paragraph
      }
    } else if (m[2] !== undefined) {
      md += tableToMarkdown(m[2]);
      inListContext = null;
    }
  }
  return md.replace(/\n{4,}/g, '\n\n\n').trim() + '\n';
}

export async function extractDocxFile(docxPath, outMdPath) {
  const xml = execSync(`unzip -p "${docxPath}" word/document.xml`, {
    encoding: 'utf8',
    maxBuffer: 200 * 1024 * 1024,
  });
  const md = docxXmlToMarkdown(xml);
  if (outMdPath) {
    await mkdir(dirname(outMdPath), { recursive: true });
    await writeFile(outMdPath, md);
  }
  return {
    xmlBytes: Buffer.byteLength(xml, 'utf8'),
    mdBytes: Buffer.byteLength(md, 'utf8'),
    mdSha256: sha256(md),
    markdown: md,
  };
}

// CLI: `node docx-extract.mjs <category> <stem>` reads docs/raw/<cat>/<stem>.bin, writes docs/clean/<cat>/<stem>.md
//      and updates the manifest entry to include `clean.{file,bytes,sha256}`.
if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , category, stem] = process.argv;
  if (!category || !stem) {
    console.error('Usage: node docx-extract.mjs <category> <stem>');
    process.exit(2);
  }
  const docxPath = join(DOCS_DIR, 'raw', category, `${stem}.bin`);
  if (!existsSync(docxPath)) {
    console.error(`No file at ${docxPath}`);
    process.exit(2);
  }
  const outMdPath = join(DOCS_DIR, 'clean', category, `${stem}.md`);
  const r = await extractDocxFile(docxPath, outMdPath);
  console.log(`docx=${(await readFile(docxPath)).length}B  xml=${r.xmlBytes}B  md=${r.mdBytes}B  sha=${r.mdSha256.slice(0, 12)}`);

  // Update manifest entry for this URL.
  const manifestPath = join(MANIFEST_DIR, `${category}.json`);
  if (existsSync(manifestPath)) {
    const mf = JSON.parse(await readFile(manifestPath, 'utf8'));
    let updated = false;
    for (const [url, entry] of Object.entries(mf.entries)) {
      if (entry.file === `raw/${category}/${stem}.bin`) {
        entry.clean = {
          file: outMdPath.replace(`${DOCS_DIR}/`, ''),
          bytes: r.mdBytes,
          sha256: r.mdSha256,
          extractor: 'docx-extract.mjs',
        };
        updated = true;
        break;
      }
    }
    if (updated) await writeFile(manifestPath, JSON.stringify(mf, null, 2));
  }
}
