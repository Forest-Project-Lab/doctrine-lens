// doctrine:begin SPEC-006
// 画面の中身 — 明細を描く。
//
// **ここは判断を一つも持たない。** 波・記号・順序・題名・文言は、すべて本体側で
// 決まったものが `ConsequenceView` として届く。ここがするのは DOM を組むことだけである。
//
// `<svg>` を一要素も作らない。座標を持たない。深度を持たない。
// 表示の仕方を変える操作子を持たない（REQ-002・ADR-012）。
import type {
  ConsequenceView,
  FindingView,
  RowView,
  ToHost,
  ToWebview,
} from "../shared/protocol.js";

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
/** 所見一件。上流の六項を並べるだけで、重さの判断は足さない。 */
function drawFinding(f: FindingView): HTMLElement {
  const box = document.createElement("div");
  box.className = `finding ${f.severity}`;
  if (f.severity) box.append(text("span", "severity", f.severity));
  box.append(text("span", "message", f.message));
  if (f.check) box.append(text("span", "check", f.check));
  // **六項をそのまま出す**（SPEC-006 制約）。初版は四項しか描かず、
  // `doc_id` と `refs` が画面から消えていた（CHANGE-028）。
  // 一件の所見は `doc_id` でも `refs` でも行に並ぶので、`doc_id` が無いと
  // 「この所見は実際どの文書に付いたのか」を読み手が判じられない。
  if (f.doc_id) box.append(text("span", "doc", f.doc_id));
  if (f.refs.length > 0) box.append(text("span", "refs", f.refs.join(" ")));
  if (f.path) {
    const link = document.createElement("button");
    link.type = "button";
    link.className = "at";
    link.textContent = f.path;
    link.addEventListener("click", (event) => {
      event.stopPropagation();
      // 所見の path は**統治木基準**である（範囲は作業フォルダ基準）。
      // 座標系を言わずに送ると、拡張機能ホストが作業フォルダに継いで開けない。
      send({ kind: "openRange", path: f.path, beginLine: 1, endLine: 1, base: "docs" });
    });
    box.append(link);
  }
  return box;
}

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
  // status は上流の語をそのまま出す。訳さない（REQ-003）。
  if (row.status) head.append(text("span", "status", row.status));
  if (row.behind > 0) head.append(text("span", "behind", String(row.behind)));
  body.append(head);

  body.append(text("div", "reason", row.reason));
  if (row.succeeds) body.append(text("div", "succeeds", row.succeeds));
  // 上流の所見はそのまま出す。書き直さない（SPEC-006 制約）。
  for (const finding of row.findings) body.append(drawFinding(finding));

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
        base: "workspace",
      });
    });
    body.append(link);
  }

  item.append(body);
  const open = (): void => send({ kind: "openDocument", id: row.id });
  item.addEventListener("click", open);
  item.addEventListener("keydown", (event) => {
    // **中の釦に焦点が在る回は、行の動作を起こさない**（CHANGE-028）。
    // keydown は泡立つので、範囲や所見の釦に焦点が在っても行のここへ届く。
    // しかも `preventDefault()` が**釦の素の活性化（Enter→click）まで潰す**ので、
    // 鍵盤だけの利用者は行の中の釦へ一度も到達できなかった（実測）。
    // `click` の `stopPropagation` は click の泡立ちしか止めないので効かない。
    if (event.target !== item) return;
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
    box.className = `origin${view.origin.symbol ? ` ${view.origin.symbol}` : ""}`;
    const head = document.createElement("h1");
    // 起点の記号。行と同じ字を、行と同じ規則で出す。
    if (view.origin.symbol) head.append(text("span", "mark", MARK[view.origin.symbol]));
    head.append(text("span", "", view.origin.title));
    box.append(head, text("p", "detail", view.origin.detail));
    // 起点自身の所見。行にならないので、ここに出さないと画面から消える。
    if (view.origin.findingsNote) box.append(text("p", "note", view.origin.findingsNote));
    for (const finding of view.origin.findings) box.append(drawFinding(finding));
    box.append(text("p", "summary", view.summary));
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
      for (const finding of cycle.findings) section.append(drawFinding(finding));
    }
    sheet.append(section);
  }

  const foot = document.createElement("footer");
  foot.className = "foot";
  for (const line of view.footnotes) foot.append(text("p", "", line));
  // 直の前提の行き先。押せばそこからまた一歩辿れる（ADR-019・CHANGE-016）。
  if (view.premisesAt.length > 0) {
    const at = document.createElement("p");
    at.className = "at premises";
    for (const id of view.premisesAt) {
      const link = document.createElement("button");
      link.type = "button";
      link.textContent = id;
      link.addEventListener("click", () => send({ kind: "openDocument", id }));
      at.append(link);
    }
    foot.append(at);
  }
  // 前提に付いた所見の行き先。**「繋がらない」とは別の行に出す**（CHANGE-028）。
  // 推移の前提も含むので、上の premisesAt に無い id も並ぶ。
  if (view.premiseFindingsAt.length > 0) {
    const at = document.createElement("p");
    at.className = "at premise-findings";
    for (const id of view.premiseFindingsAt) {
      const link = document.createElement("button");
      link.type = "button";
      link.textContent = id;
      link.addEventListener("click", () => send({ kind: "openDocument", id }));
      at.append(link);
    }
    foot.append(at);
  }
  // 行き先。押すとその文書が開き、開けば起点になる（ADR-019）。
  if (view.findingsAt.length > 0) {
    const at = document.createElement("p");
    at.className = "at";
    for (const id of view.findingsAt) {
      const link = document.createElement("button");
      link.type = "button";
      link.textContent = id;
      link.addEventListener("click", () => send({ kind: "openDocument", id }));
      at.append(link);
    }
    foot.append(at);
  }
  // 画面に出た語の定義。木の用語辞書から引いたもの（ADR-018）。
  if (view.terms.length > 0) {
    const words = document.createElement("dl");
    words.className = "terms";
    for (const term of view.terms) {
      words.append(text("dt", "", term.word), text("dd", "", term.meaning));
    }
    foot.append(words);
  }
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
