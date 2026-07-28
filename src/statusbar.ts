// 状態の帯 — 取得の様子を地図の外でも伝える。
//
// なぜ要るか: 統治木も python も無い環境では、地図を開かない限り何も起きない。
// 見出しは黙って空を返すので、利用者には「壊れている」と「対象が無い」の区別が付かない。
// 帯は常に見えるので、そこに理由を出す。
import * as vscode from "vscode";

import { messages } from "./l10n.js";
import type { LensSession, SessionState } from "./session.js";

export class LensStatusBar {
  readonly #item: vscode.StatusBarItem;
  readonly #disposables: vscode.Disposable[] = [];

  constructor(session: LensSession) {
    this.#item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
    this.#item.name = "Doctrine Lens";
    this.#disposables.push(session.onDidChange((state) => this.#render(state)));
    this.#render(session.state);
    this.#item.show();
  }

  dispose(): void {
    for (const item of this.#disposables.splice(0)) item.dispose();
    this.#item.dispose();
  }

  #render(state: SessionState): void {
    if (state.busy) {
      this.#item.text = `$(sync~spin) ${messages.statusBusy()}`;
      this.#item.tooltip = undefined;
      this.#item.command = undefined;
      this.#item.backgroundColor = undefined;
      return;
    }

    if (state.unavailable) {
      // 使えないことは異常ではない。警告の色は使わず、理由を tooltip に置く。
      this.#item.text = `$(circle-slash) ${messages.statusUnavailable()}`;
      this.#item.tooltip = [state.unavailable.text, state.unavailable.detail]
        .filter(Boolean)
        .join("\n\n");
      this.#item.command = undefined;
      this.#item.backgroundColor = undefined;
      return;
    }

    if (state.failure) {
      this.#item.text = `$(warning) ${messages.statusUnavailable()}`;
      this.#item.tooltip = state.failure.detail;
      this.#item.command = "doctrineLens.refresh";
      this.#item.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
      return;
    }

    const docs = state.snapshot?.graph.nodes.length ?? 0;
    const label = state.candidate?.label ?? "";
    const parts = [messages.statusReady(docs, label)];
    // 数は session が保つ値から取る。`snapshot.findings` は速い拍で null になるため、
    // そこから数えると保存のたびに 0 へ落ちる（ADR-008・実際に起きた欠陥）。
    if (state.staleCount > 0) parts.push(messages.statusStale(state.staleCount));

    this.#item.text = `$(telescope) ${parts.join(" · ")}`;
    this.#item.tooltip = tooltipFor(state);
    // 統治木が二つ以上あるときだけ、押すと切り替えになる（ADR-006）。
    this.#item.command =
      state.candidateCount > 1 ? "doctrineLens.selectWorkspaceFolder" : "doctrineLens.open";
    this.#item.backgroundColor = undefined;
  }
}

function tooltipFor(state: SessionState): string {
  const lines: string[] = [];
  if (state.candidate) lines.push(state.candidate.docsRoot);
  // 判定がいつのものかを出す。古い判定を新しい事実に見せない（ADR-008）。
  lines.push(
    state.auditAt
      ? messages.auditAsOf(state.auditAt.toLocaleString())
      : messages.auditNever(),
  );
  return lines.filter(Boolean).join("\n");
}
