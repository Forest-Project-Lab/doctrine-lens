// doctrine:begin SPEC-001
// 上流 doctrine の CLI を起こし、標準出力を JSON として読む。
//
// 例外を外へ出さない。失敗はすべて Outcome の値として返す（SPEC-001 エラー時挙動）。
// 呼ぶのは読み取り専用の命令だけである。統治木へ書き込む命令を呼んではならない。
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";

import { fail, ok, type Outcome } from "./model.js";

export interface RunOptions {
  /** python の実行ファイル。既定は設定から来る。 */
  pythonPath: string;
  /** 一回あたりの待ち時間の上限（ミリ秒）。 */
  timeoutMs: number;
  /**
   * 呼び手が居る作業フォルダ。
   *
   * 子プロセスには渡さない（渡すと Windows で cwd の実行体が先に走る。
   * safeCwd を見よ）。実行体の在処を解く基準にも使わない（ADR-010）。
   * 残してあるのは、束ねの鍵と診断のためである。
   */
  cwd: string;
}

let privateCwd: string | undefined;

/**
 * 子プロセスの作業フォルダ。利用者の作業フォルダは渡さない（ADR-010）。
 *
 * Windows の実行体の探索は、名前に区切りが無いとき PATH より先に cwd を見る。
 * `pythonPath` の既定は区切りの無い `python3` なので、細工したリポジトリの根に
 * `python3.exe` を置かれるだけで、設定を一切上書きせずにそれが走る。
 *
 * `tmpdir()` をそのまま渡してはならない。Linux の `/tmp` は誰でも書けるので、
 * `-c` で呼ぶ問い合わせが `/tmp/json.py` を先に読む（同じ機械の別の利用者が
 * 任意のコードを走らせられる。実際に再現した）。自分だけが書ける空の場所を作る。
 */
function safeCwd(): string {
  if (privateCwd) return privateCwd;
  try {
    privateCwd = mkdtempSync(join(tmpdir(), "doctrine-lens-run-"));
  } catch {
    // 作れない環境では tmpdir へ落とす。問い合わせの側でも探索路を塞いである。
    privateCwd = tmpdir();
  }
  return privateCwd;
}

/**
 * 私有の作業フォルダを片づける。拡張機能を終えるときに呼ぶ。
 *
 * 呼ばないと、起動のたびに空のディレクトリが一つ残る。Linux の /tmp は
 * 再起動で消えるが、Windows の %TEMP% と macOS の TMPDIR は自動で片づかない。
 */
export function disposeSafeCwd(): void {
  if (!privateCwd || privateCwd === tmpdir()) return;
  try {
    rmSync(privateCwd, { recursive: true, force: true });
  } catch {
    // 消せなくても構わない。空のディレクトリが一つ残るだけである。
  }
  privateCwd = undefined;
}

/**
 * `pythonPath` を、起こしてよい形に直す。受け付けないなら `null`。
 *
 * 受けるのは三つだけである。
 *   - 区切りを含まない名前（`python3`・`py`）。PATH から探させる。
 *   - `~/` で始まる値。利用者の home を基準に解く。
 *   - 絶対パス。
 *
 * 作業フォルダ基準の相対値（`.venv/bin/python`）は受けない。
 *
 * 受けると、ADR-010 の保証がそのまま破れるためである。`pythonPath` を machine
 * scope にしてあるのは「開いたリポジトリが実行体を差し替えられない」ためだが、
 * 相対値を作業フォルダ基準で解くと、値そのものはリポジトリに書けなくても
 * 解決先はリポジトリが握る。一度 `.venv/bin/python` と設定した利用者は、
 * 以後どのリポジトリを開いても、そのリポジトリが同梱した実行体を走らせる
 * （起動直後の取り直しで走るので、地図を開く操作すら要らない。実際に再現した）。
 * ADR-010 は「作業フォルダごとの切り替えはできなくなる。これは受け入れる」と
 * 書いてあり、実装はその通りでなければならない。
 */
export function resolvePython(pythonPath: string): string | null {
  const raw = pythonPath.trim();
  if (!raw) return "python3";
  // 区切りを含まないなら PATH から探す名前である。解いてはならない。
  if (!/[\\/]/.test(raw)) return raw;
  return resolveUserPath(raw);
}

/**
 * 実行体の在処を指す設定を解く。作業フォルダ基準の相対値は受けない（`null`）。
 *
 * `pythonPath` と `pluginPath` はどちらも「何が走るか」を決める設定であり、
 * ADR-010 が machine scope にしたのは、開いたリポジトリがそれを差し替えられない
 * ようにするためである。相対値を作業フォルダ基準で解くと、値そのものは
 * リポジトリに書けなくても解決先はリポジトリが握る。一度でも相対値を設定した
 * 利用者は、以後どのリポジトリを開いてもそのリポジトリ同梱の実体を走らせる
 * （起動直後の取り直しで走るので、地図を開く操作すら要らない。実際に再現した）。
 *
 * 二つの設定で規律を分けてはならない。片方だけ塞いでも、もう片方から同じことが
 * できる（五巡目に pythonPath だけを塞ぎ、六巡目に pluginPath で再現された）。
 */
export function resolveUserPath(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;
  if (raw.startsWith("~/")) return join(homedir(), raw.slice(2));
  return isAbsolute(raw) ? raw : null;
}

/**
 * 待ち時間を、子プロセスへ渡してよい形に丸める。
 *
 * `execFile` の `timeout` は符号なし 32bit である。負を渡すと同期的に例外を
 * 投げ（「失敗はすべて Outcome で返す」という約束が破れる）、32bit を超えると
 * Node が 1 ミリ秒へ潰す（あらゆる取得が数ミリ秒で「時間切れ」になり、
 * しかも案内は設定した値をそのまま刷るので嘘をつく）。どちらも実際に再現した。
 * 設定は利用者が手で書けるので、使う直前にここで丸める。
 */
export function clampTimeout(timeoutMs: number): number {
  const value = Math.trunc(timeoutMs);
  if (!Number.isFinite(value)) return DEFAULT_TIMEOUT_MS;
  return Math.min(Math.max(value, MIN_TIMEOUT_MS), MAX_TIMEOUT_MS);
}

const DEFAULT_TIMEOUT_MS = 20000;
const MIN_TIMEOUT_MS = 1000;
/** `execFile` の timeout は符号なし 32bit。これを超えると Node が 1ms へ潰す。 */
const MAX_TIMEOUT_MS = 2147483647;

/** 診断に添える標準エラーの長さの上限。全部載せると画面が埋まる。 */
const DETAIL_LIMIT = 2000;

function clip(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > DETAIL_LIMIT ? `${trimmed.slice(0, DETAIL_LIMIT)}…` : trimmed;
}

/**
 * python を起こして標準出力を JSON として読む。
 *
 * 解析した値の形は検めない。上流が形の正本であり、こちらは写すだけである
 * （知らない項が増えても落とさない。SPEC-001 受入基準 3）。
 */
export async function runJson<T>(args: string[], options: RunOptions): Promise<Outcome<T>> {
  const command = resolvePython(options.pythonPath);
  if (command === null) {
    // 設定そのものが受け付けられない。取得の失敗ではないので、そう伝える。
    return fail<T>(
      "bad-setting",
      `doctrineLens.pythonPath must be an absolute path, a "~/" path, ` +
        `or a bare command name; got "${options.pythonPath}"`,
    );
  }
  const timeoutMs = clampTimeout(options.timeoutMs);

  const result = await new Promise<
    { kind: "ok"; stdout: string } | { kind: "err"; reason: "spawn" | "exit" | "timeout"; detail: string }
  >((resolvePromise) => {
    // execFile は引数が受け付けられない値だと同期的に投げる。投げさせない
    // （この層の約束は「失敗はすべて Outcome の値で返す」である）。
    try {
    execFile(
      command,
      args,
      {
        cwd: safeCwd(),
        timeout: timeoutMs,
        // 大きな統治木でも標準出力が切れないようにする。
        maxBuffer: 64 * 1024 * 1024,
        encoding: "utf8",
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolvePromise({ kind: "ok", stdout });
          return;
        }
        const killed = (error as NodeJS.ErrnoException & { killed?: boolean }).killed === true;
        const code = (error as NodeJS.ErrnoException).code;
        if (killed) {
          resolvePromise({
            kind: "err",
            reason: "timeout",
            // 丸めたあとの値を刷る。設定した値をそのまま刷ると、丸めた回に嘘をつく。
            detail: `timeout after ${timeoutMs} ms`,
          });
          return;
        }
        // ENOENT などは起動そのものの失敗。終了コードの失敗と区別する。
        if (code === "ENOENT" || code === "EACCES" || code === "EPERM") {
          resolvePromise({
            kind: "err",
            reason: "spawn",
            detail: `${command}: ${code}`,
          });
          return;
        }
        resolvePromise({
          kind: "err",
          reason: "exit",
          detail: clip(stderr || error.message),
        });
      },
    );
    } catch (error) {
      resolvePromise({ kind: "err", reason: "spawn", detail: String(error) });
    }
  });

  if (result.kind === "err") {
    const reason =
      result.reason === "timeout"
        ? "timeout"
        : result.reason === "spawn"
          ? "spawn-failed"
          : "exit-nonzero";
    return fail<T>(reason, result.detail);
  }

  try {
    return ok(JSON.parse(result.stdout) as T);
  } catch {
    return fail<T>("bad-json", clip(result.stdout.slice(0, 400)));
  }
}
// doctrine:end SPEC-001
