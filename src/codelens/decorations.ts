// doctrine:begin SPEC-005
// 範囲の帯 — 印が囲む行の余白に帯を付ける（SPEC-005）。
//
// 帯は範囲の内と外を見分けるためだけのもので、押しても何も起きない。
// 指紋が食い違っている範囲は色を変える。色は編集器の主題の変数から取る。
import * as vscode from "vscode";

import { bandsForPath } from "../model/trace.js";
import type { LensSession } from "../session.js";

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

    // 行と種類を決めるのは model の純粋な関数である。ここは写すだけ。
    const lastLine = Math.max(0, editor.document.lineCount - 1);
    const normal: vscode.Range[] = [];
    const stale: vscode.Range[] = [];
    for (const band of bandsForPath(snapshot.ranges, relPath, this.#session.staleIds, lastLine)) {
      const decoration = new vscode.Range(band.begin, 0, band.end, 0);
      (band.stale ? stale : normal).push(decoration);
    }
    editor.setDecorations(this.#normal, normal);
    editor.setDecorations(this.#stale, stale);
  }
}
// doctrine:end SPEC-005
