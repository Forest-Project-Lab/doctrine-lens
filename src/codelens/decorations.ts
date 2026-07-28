// doctrine:begin SPEC-005
// 範囲の帯 — 印が囲む行の余白に帯を付ける（SPEC-005）。
//
// 帯は範囲の内と外を見分けるためだけのもので、押しても何も起きない。
// 指紋が食い違っている範囲は色を変える。色は編集器の主題の変数から取る。
import * as vscode from "vscode";

import { rangesForPath } from "../model/trace.js";
import type { LensSession } from "../session.js";
import { toEditorLine } from "./traceLens.js";

export class RangeDecorations {
  readonly #session: LensSession;
  readonly #disposables: vscode.Disposable[] = [];

  readonly #normal = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    overviewRulerLane: vscode.OverviewRulerLane.Left,
    overviewRulerColor: new vscode.ThemeColor("textLink.foreground"),
    borderWidth: "0 0 0 2px",
    borderStyle: "solid",
    light: { borderColor: new vscode.ThemeColor("textLink.foreground") },
    dark: { borderColor: new vscode.ThemeColor("textLink.foreground") },
  });

  readonly #stale = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    overviewRulerLane: vscode.OverviewRulerLane.Left,
    overviewRulerColor: new vscode.ThemeColor("inputValidation.errorBorder"),
    borderWidth: "0 0 0 2px",
    borderStyle: "solid",
    light: { borderColor: new vscode.ThemeColor("inputValidation.errorBorder") },
    dark: { borderColor: new vscode.ThemeColor("inputValidation.errorBorder") },
  });

  constructor(session: LensSession) {
    this.#session = session;
    this.#disposables.push(
      session.onDidChange(() => this.applyToVisible()),
      vscode.window.onDidChangeVisibleTextEditors(() => this.applyToVisible()),
    );
    this.applyToVisible();
  }

  dispose(): void {
    for (const item of this.#disposables.splice(0)) item.dispose();
    this.#normal.dispose();
    this.#stale.dispose();
  }

  applyToVisible(): void {
    for (const editor of vscode.window.visibleTextEditors) this.apply(editor);
  }

  apply(editor: vscode.TextEditor): void {
    const snapshot = this.#session.snapshot;
    // 取得が済むまで何も出さない。空を出してから足す形にしない（SPEC-005 制約）。
    if (!snapshot?.ranges) return;

    const relPath = this.#session.toRelativePath(editor.document.uri);
    if (!relPath) {
      editor.setDecorations(this.#normal, []);
      editor.setDecorations(this.#stale, []);
      return;
    }

    const lastLine = Math.max(0, editor.document.lineCount - 1);
    const normal: vscode.Range[] = [];
    const stale: vscode.Range[] = [];
    for (const range of rangesForPath(snapshot.ranges, relPath)) {
      // 範囲の行がファイルの行数を超えたら末尾へ寄せる（SPEC-005 エラー時挙動）。
      const begin = Math.min(toEditorLine(range.begin_line), lastLine);
      const end = Math.min(toEditorLine(range.end_line), lastLine);
      const decoration = new vscode.Range(begin, 0, Math.max(begin, end), 0);
      (this.#session.staleIds.has(range.id) ? stale : normal).push(decoration);
    }
    editor.setDecorations(this.#normal, normal);
    editor.setDecorations(this.#stale, stale);
  }
}
// doctrine:end SPEC-005
