// doctrine:begin SPEC-001
// 上流 doctrine の CLI を起こし、標準出力を JSON として読む。
//
// 例外を外へ出さない。失敗はすべて Outcome の値として返す（SPEC-001 エラー時挙動）。
// 呼ぶのは読み取り専用の命令だけである。統治木へ書き込む命令を呼んではならない。
import { execFile } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { fail, ok, type Outcome } from "./model.js";

export interface RunOptions {
  /** python の実行ファイル。既定は設定から来る。 */
  pythonPath: string;
  /** 一回あたりの待ち時間の上限（ミリ秒）。 */
  timeoutMs: number;
  /**
   * 呼び手が居る作業フォルダ。
   *
   * 子プロセスには渡さない。渡すと Windows で cwd の実行体が先に走る
   * （safeCwd を見よ）。相対値の `pythonPath` を解く基準としてだけ使う。
   */
  cwd: string;
}

/**
 * 子プロセスの作業フォルダに、利用者の作業フォルダを渡さない（ADR-010）。
 *
 * Windows の実行体の探索は、名前に区切りが無いとき PATH より先に cwd を見る。
 * `pythonPath` の既定は区切りの無い `python3` なので、細工したリポジトリの根に
 * `python3.exe` を置かれるだけで、設定を一切上書きせずにそれが走る。
 * 渡す引数はすべて絶対パスで、cwd に依存する処理は一つも無い。だから捨ててよい。
 */
function safeCwd(): string {
  return tmpdir();
}

/**
 * `pythonPath` を、起こしてよい形に直す。
 *
 * 子プロセスの cwd は捨てる（safeCwd）ので、`.venv/bin/python` のような
 * 相対値をそのまま渡すと必ず ENOENT になる。相対値は作業フォルダ基準で解く。
 * `~` は編集器が展開しないので自分で展開する。
 *
 * 区切りを含まない名前（`python3`・`py`）はそのまま渡す。PATH から探させる。
 */
export function resolvePython(pythonPath: string, cwd: string): string {
  const raw = pythonPath.trim();
  if (!raw) return "python3";
  if (raw.startsWith("~/")) return join(homedir(), raw.slice(2));
  // 区切りを含まないなら PATH から探す名前である。解いてはならない。
  if (!/[\\/]/.test(raw)) return raw;
  return resolve(cwd || ".", raw);
}

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
  const result = await new Promise<
    { kind: "ok"; stdout: string } | { kind: "err"; reason: "spawn" | "exit" | "timeout"; detail: string }
  >((resolvePromise) => {
    execFile(
      resolvePython(options.pythonPath, options.cwd),
      args,
      {
        cwd: safeCwd(),
        timeout: options.timeoutMs,
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
            detail: `timeout after ${options.timeoutMs} ms`,
          });
          return;
        }
        // ENOENT などは起動そのものの失敗。終了コードの失敗と区別する。
        if (code === "ENOENT" || code === "EACCES" || code === "EPERM") {
          resolvePromise({
            kind: "err",
            reason: "spawn",
            detail: `${options.pythonPath}: ${code}`,
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
