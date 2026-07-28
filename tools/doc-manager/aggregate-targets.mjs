#!/usr/bin/env node
// Aggregate every docs/targets/*.json batch file (except the generated all.json)
// into a single deduped targets list.
// Output: docs/targets/all.json
//
// Deduping rule: same URL = same target. fileName / category / waitFor from the
// first occurrence wins (the alphabetically-first batch takes precedence). If a
// later batch uses a different fileName, that is preserved as an `aliases` array.

import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '../../..');
const TARGETS_DIR = join(ROOT, 'docs', 'targets');
const OUT_PATH = join(TARGETS_DIR, 'all.json');

let entries = [];
try {
  entries = await readdir(TARGETS_DIR);
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
  console.log(`No docs/targets/ directory yet — create one and add <name>.json batch files (array of {url, fileName, category}).`);
  process.exit(0);
}

const files = entries.filter((f) => f.endsWith('.json') && f !== 'all.json').sort();

const seen = new Map(); // url -> target
for (const f of files) {
  const arr = JSON.parse(await readFile(join(TARGETS_DIR, f), 'utf8'));
  for (const t of arr) {
    if (!seen.has(t.url)) {
      seen.set(t.url, { ...t, source: f });
    } else {
      const existing = seen.get(t.url);
      if (t.fileName && existing.fileName !== t.fileName) {
        existing.aliases = existing.aliases || [];
        if (!existing.aliases.includes(t.fileName)) existing.aliases.push(t.fileName);
      }
    }
  }
}

const out = [...seen.values()];
out.sort((a, b) => a.url.localeCompare(b.url));
await mkdir(TARGETS_DIR, { recursive: true });
await writeFile(OUT_PATH, JSON.stringify(out, null, 2));
console.log(`Aggregated ${files.length} target batch file(s) → ${out.length} unique URLs in docs/targets/all.json`);
if (out.length) {
  console.log(`Sources sampled:`);
  const bySrc = {};
  for (const t of out) (bySrc[t.source] = bySrc[t.source] || 0, bySrc[t.source]++);
  Object.entries(bySrc).forEach(([s, n]) => console.log(`  ${s}: ${n}`));
}
