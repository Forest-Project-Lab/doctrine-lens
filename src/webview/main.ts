// doctrine:begin SPEC-006
// 画面の中身 — 明細を描く。
//
// **ここは判断を一つも持たない。** 波・記号・順序・題名・文言は、すべて本体側で
// 決まったものが `ConsequenceView` として届く。ここがするのは DOM を組むことだけである。
//
// `<svg>` を一要素も作らない。座標を持たない。深度を持たない。
// 表示の仕方を変える操作子を持たない（REQ-002・ADR-012）。
import type { ConsequenceView, RowView, ToHost, ToWebview } from "../shared/protocol.js";

declare function acquireVsCodeApi(): {
  postMessage(message: ToHost): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();
const send = (message: ToHost): void => vscode.postMessage(message);

const el = <T extends HTMLElement>(id: string): T => {
  const found = document.getElementById(id);
  if (!found) throw new Error(`missing element: ${id}`);
  return found as T;
};

const sheet = el("sheet");
const notice = el("notice");
const busy = el("busy");

/** 記号の一文字。意味は本体が決め、字はここが持つ（字は訳さない）。 */
const MARK: Readonly<Record<RowView["symbol"], string>> = {
  broken: "×",
  missing: "+",
  nowhere: "?",
  fix: "!",
  review: "~",
};

function text(tag: string, className: string, content: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = content;
  return node;
}

/** 一行を組む。押すと文書が開く。 */
function drawRow(row: RowView): HTMLElement {
  const item = document.createElement("div");
  item.className = `row ${row.symbol}`;
  item.tabIndex = 0;
  item.dataset["id"] = row.id;

  item.append(text("span", "mark", MARK[row.symbol]));

  const body = document.createElement("div");
  const head = document.createElement("div");
  head.className = "head";
  head.append(text("span", "title", row.title), text("span", "id", row.id));
  if (row.behind > 0) head.append(text("span", "behind", String(row.behind)));
  body.append(head);

  body.append(text("div", "reason", row.reason));
  // 上流の所見の文はそのまま出す。書き直さない（SPEC-006 制約）。
  for (const finding of row.findings) body.append(text("div", "finding", finding));

  for (const range of row.ranges) {
    const link = document.createElement("button");
    link.type = "button";
    link.className = "range";
    link.textContent = range.label;
    link.addEventListener("click", (event) => {
      event.stopPropagation();
      send({
        kind: "openRange",
        path: range.path,
        beginLine: range.beginLine,
        endLine: range.endLine,
      });
    });
    body.append(link);
  }

  item.append(body);
  const open = (): void => send({ kind: "openDocument", id: row.id });
  item.addEventListener("click", open);
  item.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      open();
    }
  });
  return item;
}

function draw(view: ConsequenceView): void {
  sheet.replaceChildren();

  if (view.origin) {
    const box = document.createElement("section");
    box.className = "origin";
    box.append(
      text("h1", "", view.origin.title),
      text("p", "detail", view.origin.detail),
      text("p", "summary", view.summary),
    );
    sheet.append(box);
  } else {
    // 空の絵を出さず、文で断る。何を開けばよいかまで書く（SPEC-006 エラー時挙動）。
    sheet.append(text("section", "empty", view.emptyReason));
  }

  for (const wave of view.waves) {
    const section = document.createElement("section");
    section.className = "wave";
    const heading = document.createElement("h2");
    heading.append(
      text("span", "", wave.heading),
      text("span", "note", wave.note),
      text("span", "count", wave.count),
    );
    section.append(heading);
    for (const row of wave.rows) section.append(drawRow(row));
    sheet.append(section);
  }

  if (view.cycles.length > 0) {
    const section = document.createElement("section");
    section.className = "cycles";
    for (const cycle of view.cycles) {
      // 循環は一行の文字列で書き下す。図より短く、絡んだ線より遥かに読める。
      section.append(text("div", "path", cycle.path));
      for (const finding of cycle.findings) section.append(text("div", "finding", finding));
    }
    sheet.append(section);
  }

  const foot = document.createElement("footer");
  foot.className = "foot";
  for (const line of view.footnotes) foot.append(text("p", "", line));
  const legend = document.createElement("div");
  legend.className = "legend";
  for (const item of view.legend) legend.append(text("span", "", item));
  foot.append(legend);
  sheet.append(foot);
}

el("refresh").addEventListener("click", () => send({ kind: "refresh" }));

window.addEventListener("message", (event: MessageEvent<ToWebview>) => {
  const message = event.data;
  if (message.kind === "view") {
    draw(message.view);
    return;
  }
  if (message.kind === "busy") {
    busy.hidden = !message.busy;
    return;
  }
  if (message.kind === "notice") {
    // 中身の無い通知は「消せ」の意味である。
    const empty = !message.text && !message.detail;
    notice.hidden = empty;
    notice.classList.toggle("error", !empty && message.tone === "error");
    notice.replaceChildren(document.createTextNode(message.text));
    if (message.detail) {
      const pre = document.createElement("pre");
      pre.textContent = message.detail;
      notice.append(pre);
    }
  }
});

send({ kind: "ready" });
// doctrine:end SPEC-006
