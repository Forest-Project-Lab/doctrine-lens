// doctrine:begin SPEC-005
// 範囲の見出し — 印が囲む範囲の始まりに、結ばれた文書を一行で示す（SPEC-005）。
//
// 見出しの中身を組む処理は src/model/trace.ts の純粋な関数が持つ。
// ここが持つのは編集器への繋ぎだけである。
import * as vscode from "vscode";

import type { GraphNode } from "../doctrine/model.js";
import { messages } from "../l10n.js";
import { headlinesForPath, toEditorLine, type RangeHeadline } from "../model/trace.js";
import type { LensSession } from "../session.js";


export class TraceLensProvider implements vscode.CodeLensProvider {
  readonly #session: LensSession;
  readonly #changed = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.#changed.event;

  constructor(session: LensSession) {
    this.#session = session;
    // 取得が済んだら描き直す。済むまでは空を返す（SPEC-005 制約）。
    session.onDidChange(() => this.#changed.fire());
  }

  dispose(): void {
    this.#changed.dispose();
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const snapshot = this.#session.snapshot;
    if (!snapshot?.ranges) return [];

    const relPath = this.#session.toRelativePath(document.uri);
    if (!relPath) return [];

    const nodesById = new Map<string, GraphNode>(snapshot.graph.nodes.map((n) => [n.id, n]));
    const headlines = headlinesForPath(
      snapshot.ranges,
      relPath,
      nodesById,
      this.#session.staleIds,
    );
    return headlines.flatMap((headline) => buildLenses(headline, document));
  }
}

/** 一つの範囲に出す見出しの並び。SPEC-005 の表の順を守る。 */
function buildLenses(
  headline: RangeHeadline,
  document: vscode.TextDocument,
): vscode.CodeLens[] {
  const line = Math.min(toEditorLine(headline.line), Math.max(0, document.lineCount - 1));
  const range = new vscode.Range(line, 0, line, 0);
  const lenses: vscode.CodeLens[] = [];

  // 1. 文書の id と題。押すとその文書を開く。
  const title = headline.title ? `${headline.docId} ${headline.title}` : headline.docId;
  lenses.push(
    new vscode.CodeLens(range, {
      title: headline.known ? `$(file) ${title}` : `$(file) ${title} — ${messages.notInGraphShort()}`,
      command: headline.known ? "doctrineLens.openDocumentById" : "",
      arguments: [headline.docId],
    }),
  );

  // 2. 指紋の状態。食い違っているときだけ出す。
  if (headline.stale) {
    lenses.push(
      new vscode.CodeLens(range, {
        title: `$(warning) ${messages.staleShort()}`,
        command: "doctrineLens.explainStale",
        arguments: [headline.docId],
      }),
    );
  }

  // 3. 地図で見る。
  lenses.push(
    new vscode.CodeLens(range, {
      title: messages.showOnMap(),
      command: "doctrineLens.revealDocumentById",
      arguments: [headline.docId],
    }),
  );

  return lenses;
}
// doctrine:end SPEC-005
