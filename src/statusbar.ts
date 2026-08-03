// doctrine:begin IMPL-001
// 状態の帯 — 取得の様子を地図の外でも伝える。
//
// なぜ要るか: 統治木も python も無い環境では、地図を開かない限り何も起きない。
// 見出しは黙って空を返すので、利用者には「壊れている」と「対象が無い」の区別が付かない。
// 帯は常に見えるので、そこに理由を出す。
import * as vscode from "vscode";

import { messages } from "./l10n.js";
import { planStatus } from "./model/status.js";
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

    // 何を出すかは編集器の型を使わない関数が決める（src/model/status.ts）。
    // ここは決まったことを帯へ写すだけである。
    const plan = planStatus({
      unavailable: false,
      failed: state.failure !== null,
      docs: state.snapshot?.graph.nodes.length ?? 0,
      staleCount: state.staleCount,
      candidateCount: state.candidateCount,
    });

    if (plan.kind === "failed") {
      this.#item.text = `$(warning) ${messages.statusUnavailable()}`;
      this.#item.tooltip = state.failure?.detail ?? "";
      this.#item.command = plan.command ?? undefined;
      this.#item.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
      return;
    }

    const label = state.candidate?.label ?? "";
    const parts = [messages.statusReady(plan.docs, label)];
    if (plan.stale !== null && plan.stale > 0) parts.push(messages.statusStale(plan.stale));

    this.#item.text = `$(telescope) ${parts.join(" · ")}`;
    this.#item.tooltip = tooltipFor(state);
    this.#item.command = plan.command ?? undefined;
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
// doctrine:end IMPL-001
