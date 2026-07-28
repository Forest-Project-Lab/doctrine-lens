#!/usr/bin/env node
// Document Manager - core fetcher.
// Saves raw HTML / PDF / asset bytes verbatim (no AI summarization).
// Records SHA-256 hash + timestamp + HTTP headers in a manifest.

import { chromium } from 'playwright';
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '../../..');
const DOCS_DIR = join(ROOT, 'docs');
const MANIFEST_DIR = join(DOCS_DIR, 'manifest');

// Content-based validation blocklist (closes the gap where status-only validation
// marks substantively-empty error pages as `valid: true`).
// Some SPAs return HTTP 200 for nonexistent IDs with a near-empty body that always
// hashes to the same visibleSha256. List those known-invalid fingerprints here and a
// fetch whose visible body matches one is marked `valid: false`.
// reversibility: removing an entry (or leaving the array empty) restores prior
//   status-only behavior. scope: HTML mode only (binary mode does not compute visibleSha256).
// Populate per-project as you discover such pages, e.g.:
//   { visibleSha256: '<hash of the empty-result body>', visibleBytes: 531, note: '<what page>' }
const KNOWN_INVALID_VISIBLE_SIGNATURES = [];

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * Direct HTTP binary fetch (no Playwright). Used for downloadable assets (docx/xlsx/pdf/zip/json)
 * that page.goto refuses with "Download is starting".
 */
async function fetchBinaryDirect({ url, category, fileName, timeoutMs }) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  let resp;
  try {
    resp = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 doctrine-lens-DocManager/0.1',
        'Accept': '*/*',
        'Accept-Language': 'ja,en;q=0.8',
      },
      redirect: 'follow',
    });
  } finally {
    clearTimeout(t);
  }
  const buf = Buffer.from(await resp.arrayBuffer());
  const status = resp.status;
  const contentType = resp.headers.get('content-type');

  const derived = new URL(url).pathname.replace(/\/$/, '').split('/').pop() || 'index';
  const stem = sanitizeFileName(fileName ?? derived);
  const outDir = join(DOCS_DIR, 'raw', category);
  await mkdir(outDir, { recursive: true });
  const outPath = join(outDir, `${stem}.bin`);

  const newHash = sha256(buf);
  let prevRawHash = null;
  if (existsSync(outPath)) prevRawHash = sha256(await readFile(outPath));
  const rawChanged = prevRawHash !== newHash;
  const changed = rawChanged;

  if (rawChanged) {
    if (existsSync(outPath) && prevRawHash) {
      const histDir = join(outDir, '.history');
      await mkdir(histDir, { recursive: true });
      await writeFile(join(histDir, `${stem}-${prevRawHash.slice(0, 12)}.bin`), await readFile(outPath));
    }
    await writeFile(outPath, buf);
  }

  const valid = status >= 200 && status < 300;
  const invalidReason = valid ? null : `HTTP_${status}`;

  const manifestPath = join(MANIFEST_DIR, `${category}.json`);
  const manifest = await readJson(manifestPath, { category, entries: {} });
  const prev = manifest.entries[url];
  // file path collision detection (binary mode; see detectFilePathCollision above)
  const fileRel = outPath.replace(`${DOCS_DIR}/`, '');
  warnFilePathCollision(url, fileRel, detectFilePathCollision(manifest, url, fileRel));
  // prev field preservation: extract.mjs / aggregate-targets.mjs populate custom fields
  // (`clean` / `links` …) on a manifest entry; rebuilding the entry object on a fetch
  // re-invoke would drop them. Shallow-merge prev → new known fields so custom fields are
  // preserved while freshly-fetched fields win. scope: binary mode (HTML/PDF path mirrors this below).
  // reversibility: `...prev,` 1 行削除で v1 動作完全復元可 (= 既存 known field の overwrite ordering 変更ゼロ)
  manifest.entries[url] = {
    ...prev,
    url,
    file: outPath.replace(`${DOCS_DIR}/`, ''),
    mode: 'binary',
    sha256: newHash,
    visibleSha256: null,
    bytes: buf.length,
    visibleBytes: null,
    status,
    contentType,
    waitStrategy: 'direct-fetch',
    valid,
    invalidReason,
    networkLog: null,
    firstSeen: prev?.firstSeen ?? new Date().toISOString(),
    lastFetched: new Date().toISOString(),
    lastChanged: changed ? new Date().toISOString() : (prev?.lastChanged ?? new Date().toISOString()),
    revisions: (prev?.revisions ?? 0) + (changed ? 1 : 0),
    rawRevisions: (prev?.rawRevisions ?? 0) + (rawChanged ? 1 : 0),
  };
  await writeJson(manifestPath, manifest);

  return {
    path: outPath,
    sha256: newHash,
    visibleSha256: null,
    bytes: buf.length,
    visibleBytes: null,
    changed,
    rawChanged,
    status,
    contentType,
    waitStrategy: 'direct-fetch',
    networkLogPath: null,
    valid,
    invalidReason,
  };
}

/**
 * Extract a stable "visible content" representation from HTML, suitable for
 * SHA-256 diff-detection on SPA pages where lazy-chunk hashes / build IDs / random
 * attributes change every fetch but visible content does not.
 * - strips <script>, <style>, <noscript>
 * - strips HTML comments
 * - removes all attribute values from remaining tags (keeps tag/text structure)
 * - reduces whitespace to single spaces
 * - returns Buffer for hashing
 */
export function htmlToVisible(html) {
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return Buffer.from(cleaned, 'utf8');
}

function sanitizeFileName(name) {
  return name.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 200);
}

// raw file path collision detection.
// Problem: if two different URLs resolve to the same output file path, the manifest's
// sha256 cells for those entries drift from the actual on-disk content (last write wins).
// pattern: after reading the manifest and before writing the new entry, linearly scan for
//   "does another URL already hold this same file path?"; on collision, console.warn (NOT
//   process.exit — fully backward-compatible + reversible read-only diagnostic).
// scope: HTML/PDF path (fetchOne) + binary path (fetchBinaryDirect) both.
// reversibility: delete this helper + its one-line call sites to fully restore prior behavior.
// returns: [{ url: string, file: string }] (colliding URLs; empty array = no collision)
function detectFilePathCollision(manifest, currentKey, currentFileRel) {
  if (!manifest || !manifest.entries) return [];
  const collisions = [];
  for (const [otherUrl, entry] of Object.entries(manifest.entries)) {
    if (otherUrl === currentKey) continue;
    if (entry && entry.file === currentFileRel) {
      collisions.push({ url: otherUrl, file: entry.file });
    }
  }
  return collisions;
}

function warnFilePathCollision(currentKey, fileRel, collisions) {
  if (collisions.length === 0) return;
  const otherList = collisions.map((c) => `    - ${c.url}`).join('\n');
  process.stderr.write(
    `[fetch:collision-warn] file path collision detected\n` +
      `  current: ${currentKey}\n` +
      `  target file: ${fileRel}\n` +
      `  conflicting URL(s) already pointing to same file in manifest:\n${otherList}\n` +
      `  consequence: last-write-wins overwrite = manifest sha/visibleSha cells of conflicting entries\n` +
      `    will drift from on-disk content.\n` +
      `  fix: assign a distinct \`fileName\` in the target spec for each URL (recommended).\n`,
  );
}

async function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(await readFile(path, 'utf8'));
}

async function writeJson(path, data) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2));
}

/**
 * Fetch a single URL via a headless Chromium and persist raw bytes.
 * waitUntil ladder: networkidle → load → domcontentloaded.
 * Each rung uses its own timeout; the next is tried only if the prior throws.
 * @param {object} args
 * @param {import('playwright').Browser} args.browser
 * @param {string} args.url
 * @param {string} args.category  Subdirectory under docs/raw (e.g. "example-source")
 * @param {string} [args.fileName] Override file name (extensionless).
 * @param {"html"|"pdf"|"binary"} [args.mode] Storage mode. Default "html".
 * @param {string} [args.waitFor] Optional CSS selector to wait for after navigation.
 * @param {number} [args.timeoutMs] Per-rung timeout. Default 30000ms.
 * @param {boolean} [args.networkLog] Save network log JSON alongside the body.
 * @returns {Promise<{path:string,sha256:string,bytes:number,changed:boolean,status:number,contentType:string|null,waitStrategy:string,networkLogPath:string|null}>}
 */
export async function fetchOne({ browser, url, category, fileName, mode = 'html', waitFor, timeoutMs = 30000, networkLog = false }) {
  // Binary mode uses Node native fetch — page.goto refuses to navigate to download responses
  // (returns "Download is starting" error) and we don't need JS execution for binary assets.
  if (mode === 'binary') {
    return await fetchBinaryDirect({ url, category, fileName, timeoutMs });
  }

  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 doctrine-lens-DocManager/0.1',
    viewport: { width: 1366, height: 900 },
    locale: 'ja-JP',
  });
  const page = await context.newPage();
  const networkEvents = [];
  if (networkLog) {
    page.on('request', (req) => {
      networkEvents.push({
        phase: 'request',
        ts: new Date().toISOString(),
        method: req.method(),
        url: req.url(),
        resourceType: req.resourceType(),
        headers: req.headers(),
      });
    });
    page.on('response', (res) => {
      networkEvents.push({
        phase: 'response',
        ts: new Date().toISOString(),
        url: res.url(),
        status: res.status(),
        contentType: res.headers()['content-type'] ?? null,
      });
    });
    page.on('requestfailed', (req) => {
      networkEvents.push({
        phase: 'requestfailed',
        ts: new Date().toISOString(),
        url: req.url(),
        failureText: req.failure()?.errorText ?? null,
      });
    });
  }
  let response = null;
  let body = null;
  let contentType = null;
  let status = 0;
  let waitStrategy = '';
  try {
    const ladder = ['networkidle', 'load', 'domcontentloaded'];
    let lastErr = null;
    for (const strategy of ladder) {
      try {
        response = await page.goto(url, { waitUntil: strategy, timeout: timeoutMs });
        waitStrategy = strategy;
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
        // Some Playwright versions raise on reload after timeout; ensure a clean page state.
        if (page.isClosed()) throw e;
      }
    }
    if (lastErr) throw lastErr;
    if (!response) throw new Error(`No response for ${url}`);
    status = response.status();
    contentType = response.headers()['content-type'] ?? null;
    if (waitFor) {
      await page.waitForSelector(waitFor, { timeout: timeoutMs }).catch(() => {});
    }
    if (mode === 'html') {
      body = Buffer.from(await page.content(), 'utf8');
    } else if (mode === 'pdf') {
      body = await page.pdf({ format: 'A4', printBackground: true });
    } else {
      body = await response.body();
    }
  } finally {
    await context.close();
  }

  const ext = mode === 'pdf' ? 'pdf' : mode === 'html' ? 'html' : 'bin';
  const derived = new URL(url).pathname.replace(/\/$/, '').split('/').pop() || 'index';
  const stem = sanitizeFileName(fileName ?? derived);
  const outDir = join(DOCS_DIR, 'raw', category);
  await mkdir(outDir, { recursive: true });
  const outPath = join(outDir, `${stem}.${ext}`);

  const newHash = sha256(body);
  let prevRawHash = null;
  let prevVisibleHash = null;
  let prevBytes = null;
  if (existsSync(outPath)) {
    const prevBuf = await readFile(outPath);
    prevRawHash = sha256(prevBuf);
    prevBytes = prevBuf.length;
    if (mode === 'html') prevVisibleHash = sha256(htmlToVisible(prevBuf.toString('utf8')));
  }

  let visibleHash = null;
  let visibleBytes = null;
  if (mode === 'html') {
    const visible = htmlToVisible(body.toString('utf8'));
    visibleHash = sha256(visible);
    visibleBytes = visible.length;
  }

  // For HTML, "changed" tracks the *meaningful* (visible) content.
  // For non-HTML, raw bytes are the only signal.
  const rawChanged = prevRawHash !== newHash;
  const visibleChanged = mode === 'html' ? prevVisibleHash !== visibleHash : rawChanged;
  const changed = mode === 'html' ? visibleChanged : rawChanged;

  if (rawChanged) {
    // Archive prior revision on raw change (even if visible unchanged) to preserve
    // forensic ability — we record everything that arrived, but reconcile meaning by visibleHash.
    if (existsSync(outPath) && prevRawHash) {
      const histDir = join(outDir, '.history');
      await mkdir(histDir, { recursive: true });
      await writeFile(join(histDir, `${stem}-${prevRawHash.slice(0, 12)}.${ext}`), await readFile(outPath));
    }
    await writeFile(outPath, body);
  }

  // Network log (optional)
  let networkLogPath = null;
  if (networkLog) {
    const nlDir = join(DOCS_DIR, 'network-log', category);
    await mkdir(nlDir, { recursive: true });
    networkLogPath = join(nlDir, `${stem}.json`);
    await writeFile(networkLogPath, JSON.stringify({ url, fetchedAt: new Date().toISOString(), waitStrategy, events: networkEvents }, null, 2));
  }

  // Body-level integrity checks (false-positive detection: e.g. Cloudflare challenge returns 403+HTML).
  const bodyStr = mode === 'html' ? body.toString('utf8') : '';
  const cloudflareChallenge =
    /Cloudflare|cf-browser-verification|cf_chl_|Enable JavaScript and cookies to continue|セキュリティ検証/i.test(bodyStr) &&
    /Ray ID:/i.test(bodyStr);
  // content-signature blocklist check (closes the status-only validation gap).
  // HTML mode only — match (visibleSha256, visibleBytes) pair against KNOWN_INVALID_VISIBLE_SIGNATURES.
  // Matches indicate a substantively-empty/error body served with HTTP 2xx.
  const contentSignatureMatch =
    mode === 'html' && visibleHash
      ? KNOWN_INVALID_VISIBLE_SIGNATURES.find(
          (sig) => sig.visibleSha256 === visibleHash && sig.visibleBytes === visibleBytes,
        ) ?? null
      : null;
  const statusOk = status >= 200 && status < 300;
  const valid = statusOk && !cloudflareChallenge && !contentSignatureMatch;
  const invalidReason = !statusOk
    ? `HTTP_${status}`
    : cloudflareChallenge
      ? 'CLOUDFLARE_CHALLENGE'
      : contentSignatureMatch
        ? `CONTENT_SIGNATURE_BLOCKED:${contentSignatureMatch.visibleSha256.slice(0, 12)}`
        : null;

  // Update manifest
  const manifestPath = join(MANIFEST_DIR, `${category}.json`);
  const manifest = await readJson(manifestPath, { category, entries: {} });
  const key = url;
  const prev = manifest.entries[key];
  // file path collision detection (HTML/PDF path; see detectFilePathCollision above)
  const fileRel = outPath.replace(`${DOCS_DIR}/`, '');
  warnFilePathCollision(key, fileRel, detectFilePathCollision(manifest, key, fileRel));
  // prev field preservation (same as binary mode above): preserve custom fields
  // (extract.mjs-populated `clean` / `links` …) while freshly-fetched known fields win.
  manifest.entries[key] = {
    ...prev,
    url,
    file: outPath.replace(`${DOCS_DIR}/`, ''),
    mode,
    sha256: newHash,
    visibleSha256: visibleHash,
    bytes: body.length,
    visibleBytes,
    status,
    contentType,
    waitStrategy,
    valid,
    invalidReason,
    networkLog: networkLogPath ? networkLogPath.replace(`${DOCS_DIR}/`, '') : null,
    firstSeen: prev?.firstSeen ?? new Date().toISOString(),
    lastFetched: new Date().toISOString(),
    lastChanged: changed ? new Date().toISOString() : (prev?.lastChanged ?? new Date().toISOString()),
    revisions: (prev?.revisions ?? 0) + (changed ? 1 : 0),
    rawRevisions: (prev?.rawRevisions ?? 0) + (rawChanged ? 1 : 0),
  };
  await writeJson(manifestPath, manifest);

  return { path: outPath, sha256: newHash, visibleSha256: visibleHash, bytes: body.length, visibleBytes, changed, rawChanged, status, contentType, waitStrategy, networkLogPath, valid, invalidReason };
}

/**
 * @param {Array<{url:string,category:string,fileName?:string,mode?:"html"|"pdf"|"binary",waitFor?:string,timeoutMs?:number,networkLog?:boolean}>} targets
 * @param {object} [common] Defaults merged into every target (timeoutMs, networkLog).
 */
export async function fetchAll(targets, common = {}) {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const results = [];
  try {
    for (const t of targets) {
      const merged = { ...common, ...t };
      process.stdout.write(`[fetch] ${merged.url} (${merged.mode ?? 'html'}) ... `);
      try {
        const r = await fetchOne({ browser, ...merged });
        results.push({ ...merged, ok: true, ...r });
        const v = r.valid ? 'valid' : `INVALID(${r.invalidReason})`;
        const vh = r.visibleSha256 ? ` vh=${r.visibleSha256.slice(0, 12)}` : '';
        const flag = r.changed ? (r.rawChanged && !r.changed ? 'RAW-NOISE' : 'CHANGED') : (r.rawChanged ? 'RAW-NOISE-ONLY' : 'unchanged');
        process.stdout.write(`${r.valid ? 'OK' : 'BAD'} ${r.bytes}B sha=${r.sha256.slice(0, 12)}${vh} wait=${r.waitStrategy} ${v} ${flag}\n`);
      } catch (e) {
        results.push({ ...merged, ok: false, error: String(e) });
        process.stdout.write(`FAIL ${String(e).split('\n')[0]}\n`);
      }
    }
  } finally {
    await browser.close();
  }
  return results;
}

// CLI:
//   node fetch.mjs <targets.json> [--timeout=ms] [--network-log]
//   node fetch.mjs --url=... --category=... [--mode=html|pdf|binary] [--fileName=...] [--timeout=ms] [--network-log] [--waitFor=selector]
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const flagPairs = args
    .filter((a) => a.startsWith('--'))
    .map((a) => {
      const body = a.replace(/^--/, '');
      const eqIdx = body.indexOf('=');
      if (eqIdx === -1) return [body, true];
      return [body.slice(0, eqIdx), body.slice(eqIdx + 1)];
    });
  const opts = Object.fromEntries(flagPairs);
  const common = {};
  if (opts.timeout) common.timeoutMs = Number(opts.timeout);
  if (opts['network-log']) common.networkLog = true;

  let targets;
  const fileArg = args.find((a) => !a.startsWith('--'));
  if (fileArg) {
    if (!existsSync(fileArg)) {
      console.log(`Targets file not found: ${fileArg}. Add docs/targets/<name>.json batch files and run \`npm run docs:aggregate\` first (nothing to fetch).`);
      process.exit(0);
    }
    targets = JSON.parse(await readFile(fileArg, 'utf8'));
  } else {
    if (!opts.url || !opts.category) {
      console.error('Usage: node fetch.mjs <targets.json>  OR  --url=... --category=... [--mode=html|pdf|binary] [--fileName=...] [--timeout=ms] [--network-log] [--waitFor=selector]');
      process.exit(2);
    }
    const single = {
      url: opts.url,
      category: opts.category,
      mode: opts.mode,
      fileName: opts.fileName,
      waitFor: opts.waitFor,
    };
    targets = [single];
  }
  const r = await fetchAll(targets, common);
  const ok = r.filter((x) => x.ok).length;
  console.log(`\nDone. ${ok}/${r.length} succeeded.`);
  process.exit(ok === r.length ? 0 : 1);
}
