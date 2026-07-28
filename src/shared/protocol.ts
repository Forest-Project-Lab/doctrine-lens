// 本体と webview のあいだで取り決めた形（IMPL-001)。
//
// webview は子プロセスを起こさない。上流の CLI を呼ぶのは本体だけである。
// webview が受け取るのは取得済みのグラフと登録簿であり、そこから先の
// 場面の組み立てと配置は webview の側で行う。こうするとレンズを回しても
// 往復が起きない。
import type { Graph, Registry } from "../doctrine/model.js";
import type { TraceRange } from "../doctrine/trace.js";
import type { WebviewStrings } from "../l10n.js";
import type { Lens } from "../model/lens.js";

/** 名前を付けて保存したレンズ。作業フォルダごとに保つ。 */
export interface SavedLens {
  readonly name: string;
  readonly lens: Lens;
}

/** 本体から webview へ。 */
export type ToWebview =
  | {
      readonly kind: "snapshot";
      readonly graph: Graph;
      readonly registry: Registry | null;
      readonly docsRoot: string;
      readonly savedLenses: readonly SavedLens[];
      /** 上流が返したコード範囲。取れていなければ `null`。 */
      readonly ranges: readonly TraceRange[] | null;
      /** 上流が指紋の食い違いを挙げた文書の id。集合は渡せないので配列で運ぶ。 */
      readonly staleIds: readonly string[];
      /** 訳し終えた表示の文字列。webview は翻訳の仕組みを持たない（ADR-007）。 */
      readonly strings: WebviewStrings;
      /** 指紋の判定を取った時刻。未取得なら `null`（ADR-008）。 */
      readonly auditAt: string | null;
    }
  | {
      readonly kind: "notice";
      readonly tone: "info" | "error";
      readonly text: string;
      readonly detail: string;
    }
  | { readonly kind: "busy"; readonly busy: boolean }
  | { readonly kind: "savedLenses"; readonly savedLenses: readonly SavedLens[] }
  | { readonly kind: "reveal"; readonly docId: string };

/** webview から本体へ。 */
export type ToHost =
  | { readonly kind: "ready" }
  | { readonly kind: "refresh" }
  | { readonly kind: "openDocument"; readonly path: string }
  | {
      /** コード範囲を編集器で開く。行は上流が返した 1 始まりの値のまま運ぶ。 */
      readonly kind: "openRange";
      readonly path: string;
      readonly beginLine: number;
      readonly endLine: number;
    }
  | {
      /**
       * レンズに名前を付けて保存したい、という要求。
       *
       * 名前を訊くのは本体の役目である。webview は `allow-modals` の無い sandbox に
       * 居るので `window.prompt` が必ず `null` を返す（実機で保存が無反応だった）。
       */
      readonly kind: "requestSaveLens";
      readonly lens: Lens;
    }
  | { readonly kind: "deleteLens"; readonly name: string };
