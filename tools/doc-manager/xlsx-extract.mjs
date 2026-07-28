#!/usr/bin/env node
// Document Manager - xlsx text extractor.
// xlsx is a ZIP containing xl/sharedStrings.xml and xl/worksheets/sheet*.xml.
// Cells reference shared strings via t="s" with <v>index</v>.
// We extract each sheet as a Markdown table (per sheet section).
//
// No external deps beyond system `unzip` and Node stdlib.

import { execSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
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

function parseSharedStrings(xml) {
  // <si>...<t>text</t>...</si>  (may contain multiple <t> if rich text)
  const items = [];
  const siBlocks = xml.match(/<si\b[^>]*>[\s\S]*?<\/si>/g) || [];
  for (const block of siBlocks) {
    const parts = [...block.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decodeEntities(m[1]));
    items.push(parts.join(''));
  }
  return items;
}

// Convert "A1" → {col:1, row:1}.  Columns A..Z=1..26, AA=27, etc.
function parseCellRef(ref) {
  const m = ref.match(/^([A-Z]+)(\d+)$/);
  if (!m) return { col: 0, row: 0 };
  let col = 0;
  for (const c of m[1]) col = col * 26 + (c.charCodeAt(0) - 64);
  return { col, row: Number(m[2]) };
}

/**
 * Parse a sheet XML into a 2D array of strings.
 * @param {string} xml
 * @param {string[]} sst shared string table
 */
function parseSheet(xml, sst) {
  const rows = {};
  let maxCol = 0;
  let maxRow = 0;
  const rowBlocks = xml.match(/<row\b[^>]*>[\s\S]*?<\/row>/g) || [];
  for (const rb of rowBlocks) {
    const cells = [...rb.matchAll(/<c\b([^>]*?)>([\s\S]*?)<\/c>|<c\b([^>]*?)\/>/g)];
    for (const m of cells) {
      const attrs = m[1] || m[3] || '';
      const inner = m[2] || '';
      const refM = attrs.match(/r="([A-Z]+\d+)"/);
      const tM = attrs.match(/t="([^"]+)"/);
      const type = tM ? tM[1] : 'n';
      if (!refM) continue;
      const { col, row } = parseCellRef(refM[1]);
      if (col > maxCol) maxCol = col;
      if (row > maxRow) maxRow = row;

      let value = '';
      if (type === 's') {
        const vM = inner.match(/<v[^>]*>([\s\S]*?)<\/v>/);
        if (vM) value = sst[Number(vM[1])] ?? '';
      } else if (type === 'inlineStr') {
        const tInline = [...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => decodeEntities(x[1]));
        value = tInline.join('');
      } else if (type === 'str') {
        const fM = inner.match(/<f[^>]*>[\s\S]*?<\/f>\s*<v[^>]*>([\s\S]*?)<\/v>/) || inner.match(/<v[^>]*>([\s\S]*?)<\/v>/);
        value = fM ? decodeEntities(fM[1]) : '';
      } else if (type === 'b') {
        const vM = inner.match(/<v[^>]*>([\s\S]*?)<\/v>/);
        value = vM ? (vM[1] === '1' ? 'TRUE' : 'FALSE') : '';
      } else {
        // number or default
        const vM = inner.match(/<v[^>]*>([\s\S]*?)<\/v>/);
        value = vM ? vM[1] : '';
      }
      if (!rows[row]) rows[row] = {};
      rows[row][col] = value;
    }
  }
  const grid = [];
  for (let r = 1; r <= maxRow; r++) {
    const row = [];
    for (let c = 1; c <= maxCol; c++) row.push((rows[r] && rows[r][c]) ?? '');
    grid.push(row);
  }
  return grid;
}

function gridToMarkdown(grid) {
  if (grid.length === 0) return '_(empty)_\n';
  const ncol = Math.max(...grid.map((r) => r.length));
  const padded = grid.map((r) => {
    const out = r.slice(0, ncol);
    while (out.length < ncol) out.push('');
    return out.map((c) => String(c).replace(/\|/g, '\\|').replace(/\n/g, ' '));
  });
  const header = '| ' + padded[0].join(' | ') + ' |';
  const sep = '| ' + Array(ncol).fill('---').join(' | ') + ' |';
  const body = padded.slice(1).map((r) => '| ' + r.join(' | ') + ' |').join('\n');
  return header + '\n' + sep + (body ? '\n' + body : '') + '\n';
}

export async function extractXlsxFile(xlsxPath, outMdPath) {
  // List sheets
  const list = execSync(`unzip -l "${xlsxPath}" 'xl/worksheets/sheet*.xml'`, { encoding: 'utf8' });
  const sheets = [...list.matchAll(/xl\/worksheets\/(sheet\d+\.xml)/g)].map((m) => m[1]);
  if (sheets.length === 0) throw new Error('No sheets found');

  // Workbook to get sheet names (optional, fallback to filenames)
  let names = sheets.map((s) => s.replace(/\.xml$/, ''));
  try {
    const wb = execSync(`unzip -p "${xlsxPath}" xl/workbook.xml`, { encoding: 'utf8' });
    const nameMatches = [...wb.matchAll(/<sheet\b[^>]*\bname="([^"]+)"/g)].map((m) => decodeEntities(m[1]));
    if (nameMatches.length === sheets.length) names = nameMatches;
  } catch {}

  // Shared strings
  let sst = [];
  try {
    const sstXml = execSync(`unzip -p "${xlsxPath}" xl/sharedStrings.xml`, { encoding: 'utf8' });
    sst = parseSharedStrings(sstXml);
  } catch {
    sst = [];
  }

  let md = '';
  for (let i = 0; i < sheets.length; i++) {
    const xml = execSync(`unzip -p "${xlsxPath}" xl/worksheets/${sheets[i]}`, { encoding: 'utf8', maxBuffer: 100e6 });
    const grid = parseSheet(xml, sst);
    md += `\n\n## ${names[i] || sheets[i]}\n\n` + gridToMarkdown(grid);
  }
  md = md.trim() + '\n';

  if (outMdPath) {
    await mkdir(dirname(outMdPath), { recursive: true });
    await writeFile(outMdPath, md);
  }

  return {
    sheetCount: sheets.length,
    sstCount: sst.length,
    mdBytes: Buffer.byteLength(md, 'utf8'),
    mdSha256: sha256(md),
    markdown: md,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , category, stem] = process.argv;
  if (!category || !stem) {
    console.error('Usage: node xlsx-extract.mjs <category> <stem>');
    process.exit(2);
  }
  const xlsxPath = join(DOCS_DIR, 'raw', category, `${stem}.bin`);
  if (!existsSync(xlsxPath)) {
    console.error(`No file at ${xlsxPath}`);
    process.exit(2);
  }
  const outMdPath = join(DOCS_DIR, 'clean', category, `${stem}.md`);
  const r = await extractXlsxFile(xlsxPath, outMdPath);
  console.log(`xlsx sheets=${r.sheetCount} sst=${r.sstCount} md=${r.mdBytes}B sha=${r.mdSha256.slice(0, 12)}`);

  const manifestPath = join(MANIFEST_DIR, `${category}.json`);
  if (existsSync(manifestPath)) {
    const mf = JSON.parse(await readFile(manifestPath, 'utf8'));
    for (const [url, entry] of Object.entries(mf.entries)) {
      if (entry.file === `raw/${category}/${stem}.bin`) {
        entry.clean = {
          file: outMdPath.replace(`${DOCS_DIR}/`, ''),
          bytes: r.mdBytes,
          sha256: r.mdSha256,
          extractor: 'xlsx-extract.mjs',
        };
        await writeFile(manifestPath, JSON.stringify(mf, null, 2));
        break;
      }
    }
  }
}
