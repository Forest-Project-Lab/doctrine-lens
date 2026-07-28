#!/usr/bin/env node
// Walk every manifest under docs/manifest/, verify the on-disk file SHA-256
// matches the recorded sha, and report state.
//
// Output sections:
//   [OK]       on-disk file sha matches manifest, valid:true
//   [INVALID]  manifest entry has valid:false (e.g. HTTP 4xx, Cloudflare challenge)
//   [MISMATCH] on-disk file sha differs from manifest (manual edit, or extract.mjs ran)
//   [MISSING]  manifest entry exists but on-disk file is gone
//
// Also: optional `--since=<ISO>` filters to entries with `lastChanged >= since`.

import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '../../..');
const DOCS_DIR = join(ROOT, 'docs');
const MANIFEST_DIR = join(DOCS_DIR, 'manifest');

const args = process.argv.slice(2);
const sinceArg = (args.find((a) => a.startsWith('--since=')) ?? '').replace('--since=', '');
const since = sinceArg ? new Date(sinceArg).toISOString() : null;

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

const stats = { ok: 0, invalid: 0, mismatch: 0, missing: 0, total: 0 };
const groups = { OK: [], INVALID: [], MISMATCH: [], MISSING: [] };

if (!existsSync(MANIFEST_DIR)) {
  console.log('docs/manifest/ がまだありません。先に `npm run docs:fetch && npm run docs:extract` を実行してください (nothing to diff).');
  process.exit(0);
}
const manifestFiles = (await readdir(MANIFEST_DIR)).filter((f) => f.endsWith('.json'));
for (const mf of manifestFiles) {
  const path = join(MANIFEST_DIR, mf);
  const m = JSON.parse(await readFile(path, 'utf8'));
  for (const [url, entry] of Object.entries(m.entries)) {
    stats.total += 1;
    if (since && entry.lastChanged < since) continue;
    const filePath = join(DOCS_DIR, entry.file);
    if (!existsSync(filePath)) {
      stats.missing += 1;
      groups.MISSING.push({ url, file: entry.file });
      continue;
    }
    if (entry.valid === false) {
      stats.invalid += 1;
      groups.INVALID.push({ url, file: entry.file, reason: entry.invalidReason });
      continue;
    }
    const actual = sha256(await readFile(filePath));
    if (actual !== entry.sha256) {
      stats.mismatch += 1;
      groups.MISMATCH.push({ url, file: entry.file, expected: entry.sha256.slice(0, 12), actual: actual.slice(0, 12) });
    } else {
      stats.ok += 1;
      groups.OK.push({ url, file: entry.file, lastChanged: entry.lastChanged, revisions: entry.revisions });
    }
  }
}

console.log(`\n== Doc Manager state${since ? ` (since ${since})` : ''} ==`);
console.log(`Total entries: ${stats.total}`);
console.log(`  [OK]       ${stats.ok}`);
console.log(`  [INVALID]  ${stats.invalid}`);
console.log(`  [MISMATCH] ${stats.mismatch}`);
console.log(`  [MISSING]  ${stats.missing}`);

if (stats.missing) {
  console.log(`\n=== MISSING (file gone) ===`);
  for (const x of groups.MISSING) console.log(`  ${x.url} -> ${x.file}`);
}
if (stats.mismatch) {
  console.log(`\n=== MISMATCH (sha drift) ===`);
  for (const x of groups.MISMATCH) console.log(`  ${x.url} : manifest=${x.expected} actual=${x.actual}`);
}
if (stats.invalid) {
  console.log(`\n=== INVALID (manifest valid:false) ===`);
  for (const x of groups.INVALID) console.log(`  ${x.url} : ${x.reason}`);
}
if (since && groups.OK.length) {
  console.log(`\n=== CHANGED SINCE (${since}) ===`);
  groups.OK
    .sort((a, b) => b.lastChanged.localeCompare(a.lastChanged))
    .slice(0, 30)
    .forEach((x) => console.log(`  ${x.lastChanged}  rev=${x.revisions}  ${x.url}`));
}

process.exit(stats.missing + stats.mismatch > 0 ? 1 : 0);
