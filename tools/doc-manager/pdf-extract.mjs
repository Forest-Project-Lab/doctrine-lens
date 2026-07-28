#!/usr/bin/env node
// Document Manager - pdf text extractor.
// Parses PDF binary (already fetched via fetch.mjs binary mode and SHA-256 recorded)
// and emits clean Markdown alongside the raw .bin file. Mirrors docx-extract.mjs:
//   - reads docs/raw/<category>/<stem>.bin
//   - writes docs/clean/<category>/<stem>.md
//   - updates docs/manifest/<category>.json entry to include clean.{file,bytes,sha256,extractor}
//
// Uses pdf-parse v2 (PDFParse class API). pdf-parse is declared in package.json
// `dependencies`; run `npm install` before using this extractor.
//
// Handles:
//   - per-page text extraction (PDFParse.getText)
//   - emits page boundary markers `\n\n--- Page N ---\n\n` so verbatim line numbers
//     correlate with PDF pages (downstream verbatim mapping uses line numbers)
//   - Japanese full-width tab `　` is preserved (告示 indentation 慣行)
//
// Does NOT handle: tables (would require getTable + structural reconstruction),
// images (告示 is text-only), embedded fonts / OCR (assumes searchable text PDF).

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '../../..');
const DOCS_DIR = join(ROOT, 'docs');
const MANIFEST_DIR = join(DOCS_DIR, 'manifest');

function sha256(s) {
  return createHash('sha256').update(s).digest('hex');
}

/**
 * Convert raw PDF buffer to Markdown text.
 * Returns { markdown, pageCount, charCount }.
 *
 * Markdown shape:
 *   --- Page 1 ---
 *
 *   <page 1 text verbatim>
 *
 *   --- Page 2 ---
 *
 *   <page 2 text verbatim>
 *
 * Verbatim policy (運用ルール #2 / #9 整合): no rewrites, no summaries, no AI calls.
 * pdf-parse extracts glyph strings in reading order from the PDF content stream.
 */
export async function pdfBufferToMarkdown(buf) {
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: buf });
  const result = await parser.getText();
  const pages = result.pages || [];
  let md = '';
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const pageText = (page.text ?? page).toString();
    md += `--- Page ${i + 1} ---\n\n`;
    md += pageText.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    md += '\n\n';
  }
  if (pages.length === 0 && typeof result.text === 'string') {
    // Fallback: whole-document text (no per-page split available)
    md += '--- Page 1 ---\n\n';
    md += result.text.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    md += '\n';
  }
  return {
    markdown: md.replace(/\n{4,}/g, '\n\n\n').trim() + '\n',
    pageCount: pages.length || (typeof result.text === 'string' ? 1 : 0),
    charCount: (result.text || '').length,
  };
}

export async function extractPdfFile(pdfPath, outMdPath) {
  const buf = await readFile(pdfPath);
  const { markdown, pageCount, charCount } = await pdfBufferToMarkdown(buf);
  if (outMdPath) {
    await mkdir(dirname(outMdPath), { recursive: true });
    await writeFile(outMdPath, markdown);
  }
  return {
    rawBytes: buf.length,
    mdBytes: Buffer.byteLength(markdown, 'utf8'),
    mdSha256: sha256(markdown),
    pageCount,
    charCount,
    markdown,
  };
}

// CLI: `node pdf-extract.mjs <category> <stem>` reads docs/raw/<cat>/<stem>.bin,
//      writes docs/clean/<cat>/<stem>.md, updates manifest entry.
if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , category, stem] = process.argv;
  if (!category || !stem) {
    console.error('Usage: node pdf-extract.mjs <category> <stem>');
    process.exit(2);
  }
  const pdfPath = join(DOCS_DIR, 'raw', category, `${stem}.bin`);
  if (!existsSync(pdfPath)) {
    console.error(`No file at ${pdfPath}`);
    process.exit(2);
  }
  const outMdPath = join(DOCS_DIR, 'clean', category, `${stem}.md`);
  const r = await extractPdfFile(pdfPath, outMdPath);
  console.log(
    `pdf=${r.rawBytes}B  md=${r.mdBytes}B  pages=${r.pageCount}  chars=${r.charCount}  sha=${r.mdSha256.slice(0, 12)}`
  );

  // Update manifest entry for this stem.
  const manifestPath = join(MANIFEST_DIR, `${category}.json`);
  if (existsSync(manifestPath)) {
    const mf = JSON.parse(await readFile(manifestPath, 'utf8'));
    let updated = false;
    for (const [, entry] of Object.entries(mf.entries)) {
      if (entry.file === `raw/${category}/${stem}.bin`) {
        entry.clean = {
          file: outMdPath.replace(`${DOCS_DIR}/`, ''),
          bytes: r.mdBytes,
          sha256: r.mdSha256,
          extractor: 'pdf-extract.mjs',
        };
        updated = true;
        break;
      }
    }
    if (updated) await writeFile(manifestPath, JSON.stringify(mf, null, 2));
  }
}
