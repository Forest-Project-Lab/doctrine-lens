// doctrine:begin SPEC-002
// 画面の中身 — SVG を手で組み立て、選択とダイヤルの操作に応じる（ADR-002）。
//
// 場面の組み立てと配置は src/model の純粋な関数に委ねる。ここが持つのは
// 描き方と操作だけである。model を webview 側で動かすので、レンズを回しても
// 本体との往復が起きない。
import type { Graph, GraphNode, Registry } from "../doctrine/model.js";
import type { TraceRange } from "../doctrine/trace.js";
import {
  ascend,
  buildScene,
  descend,
  NO_FOCUS,
  type Focus,
  type Position,
  type RecoveredReason,
  type Scene,
  type SceneContext,
  type SceneNode,
} from "../model/depth.js";
import { layoutScene, type Layout, type Placed } from "../model/layout.js";
import { rangesForDocument } from "../model/trace.js";
import {
  buildColorScale,
  colorKeyOf,
  colorOf,
  DEFAULT_LENS,
  effectiveLayout,
  layoutsFor,
  withColorBy,
  withDepth,
  withFilter,
  withLayout,
  type ColorBy,
  type Depth,
  type LayoutMode,
  type Lens,
} from "../model/lens.js";
import type { WebviewStrings } from "../l10n.js";
import type { SavedLens, ToHost, ToWebview } from "../shared/protocol.js";

declare function acquireVsCodeApi(): {
  postMessage(message: ToHost): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();
const send = (message: ToHost): void => vscode.postMessage(message);

/**
 * 文字列の一式を、欠けた鍵に耐える形で包む（ADR-007）。
 *
 * 届く前は全て空文字。届いたあとも、知らない鍵を引いたら空文字を返す。
 * 鍵が一つ欠けただけで描画全体が落ちるのは釣り合わない
 * （実際に、渡す側と受ける側が食い違って画面が壊れた）。
 * 食い違いそのものは l10n.test.ts が字面で止める。ここは最後の受け皿である。
 */
function tolerantStrings(source: Partial<WebviewStrings> = {}): WebviewStrings {
  return new Proxy(source, {
    get: (target, key) => {
      const value = (target as Record<string | symbol, unknown>)[key];
      return typeof value === "string" ? value : "";
    },
  }) as WebviewStrings;
}

const PENDING_STRINGS = tolerantStrings();

function layoutLabel(mode: LayoutMode): string {
  const s = state.strings;
  return mode === "map" ? s.layoutMap
    : mode === "lane" ? s.layoutLane
    : mode === "detail" ? s.layoutDetail
    : s.layoutList;
}

function colorByLabel(key: ColorBy): string {
  const s = state.strings;
  return key === "type" ? s.colorType
    : key === "status" ? s.colorStatus
    : key === "domain" ? s.colorDomain
    : s.colorOwner;
}

interface State {
  graph: Graph;
  registry: Registry | null;
  docsRoot: string;
  lens: Lens;
  position: Position;
  savedLenses: readonly SavedLens[];
  /** 画面上で選んでいる節点。降りる操作の対象になる。 */
  selected: string | null;
  /** 上流が返したコード範囲。取れていなければ `null`。 */
  ranges: readonly TraceRange[] | null;
  /** 上流が指紋の食い違いを挙げた文書の id。 */
  staleIds: ReadonlySet<string>;
  /** 訳し終えた表示の文字列（ADR-007）。 */
  strings: WebviewStrings;
  /** 指紋の判定を取った時刻。未取得なら `null`（ADR-008）。 */
  auditAt: string | null;
  /** いま当てている保存済みレンズの名。当てていなければ空。 */
  activeLensName: string;
}

const state: State = {
  graph: { nodes: [], edges: [] },
  registry: null,
  docsRoot: "",
  lens: DEFAULT_LENS,
  position: { depth: 0, focus: NO_FOCUS },
  savedLenses: [],
  selected: null,
  ranges: null,
  staleIds: new Set(),
  strings: PENDING_STRINGS,
  auditAt: null,
  activeLensName: "",
};

/** 場面を組むときに渡す、グラフの外から来る値。 */
function sceneContext(): SceneContext {
  return { ranges: state.ranges, staleIds: state.staleIds };
}

// 画面の拡大と平行移動。地図そのものの座標は動かさない。
const view = { scale: 1, tx: 0, ty: 0 };

const el = <T extends HTMLElement>(id: string): T => {
  const found = document.getElementById(id);
  if (!found) throw new Error(`missing element: ${id}`);
  return found as T;
};

const svg = el<HTMLElement>("svg") as unknown as SVGSVGElement;
const canvas = el("canvas");
const crumbs = el("crumbs");
const notice = el("notice");
// 場面そのものが告げること（辺の省略・段の戻し・部分的に取れなかったもの）は
// 別の帯へ出す。本体が取得のたびに送る「消せ」に巻き込まれないようにするため。
const sceneNotice = el("sceneNotice");
const emptyText = el("empty");
const inspector = el("inspector");
const legend = el("legend");
const busy = el("busy");

const colorBySelect = el<HTMLSelectElement>("colorBy");
const layoutSelect = el<HTMLSelectElement>("layout");
const filterTypeSelect = el<HTMLSelectElement>("filterType");
const filterDomainSelect = el<HTMLSelectElement>("filterDomain");
const currentOnlyBox = el<HTMLInputElement>("currentOnly");
const savedLensSelect = el<HTMLSelectElement>("savedLens");

// --- 描画 ----------------------------------------------------------------

const SVG_NS = "http://www.w3.org/2000/svg";

function svgEl<K extends keyof SVGElementTagNameMap>(
  name: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) {
    node.setAttribute(key, String(value));
  }
  return node;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function currentScene(): Scene {
  return buildScene(
    state.graph,
    state.lens,
    state.position.focus,
    state.registry,
    sceneContext(),
  );
}

interface Point {
  x: number;
  y: number;
}

/** 矢印の先が縁に食い込まないように空ける間。 */
const ARROW_GAP = 7;

function center(placed: Placed): Point {
  return { x: placed.x + placed.w / 2, y: placed.y + placed.h / 2 };
}

/**
 * `placed` の中心から `toward` へ向かう半直線が、矩形の縁と交わる点を返す。
 *
 * `gap` を足すと、その分だけ縁の手前で止まる（矢印の先を置く場所を空ける）。
 */
function borderPoint(placed: Placed, toward: Point, gap = 0): Point {
  const c = center(placed);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return c;
  const halfW = placed.w / 2;
  const halfH = placed.h / 2;
  // 縁に届くまでの倍率。横と縦のうち先に当たるほうを採る。
  const tx = dx === 0 ? Infinity : halfW / Math.abs(dx);
  const ty = dy === 0 ? Infinity : halfH / Math.abs(dy);
  const t = Math.min(tx, ty);
  const edgeDistance = length * t + gap;
  return { x: c.x + (dx / length) * edgeDistance, y: c.y + (dy / length) * edgeDistance };
}

/** 矢印の先。辺の向き（どちらが依存する側か）を示す。 */
function arrowDefs(): SVGDefsElement {
  const defs = svgEl("defs");
  const marker = svgEl("marker", {
    id: "arrow",
    viewBox: "0 0 10 10",
    refX: 9,
    refY: 5,
    markerWidth: 6,
    markerHeight: 6,
    orient: "auto-start-reverse",
  });
  const path = svgEl("path", {
    d: "M 0 1 L 9 5 L 0 9 z",
    fill: "var(--vscode-descriptionForeground)",
    "fill-opacity": 0.75,
  });
  marker.append(path);
  defs.append(marker);
  return defs;
}

function render(): void {
  const scene = currentScene();
  // 焦点が消えて段が戻されていたら、位置を場面に合わせる。
  if (scene.depth !== state.position.depth || scene.focus !== state.position.focus) {
    state.position = { depth: scene.depth, focus: scene.focus };
    state.lens = withDepth(state.lens, scene.depth);
  }

  const mode = effectiveLayout(state.lens.depth, state.lens.layout);
  const layout = layoutScene(scene, mode, state.registry);
  const scale = buildColorScale(
    scene.nodes.map((n) => n.node).filter((n): n is GraphNode => n !== null),
    state.lens.colorBy,
    state.registry,
  );

  drawCrumbs(scene);
  drawDials(mode);
  drawSvg(scene, layout, scale);
  drawInspector(scene);
  drawLegend(scene, scale);
  drawSceneNotice(scene);

  emptyText.hidden = scene.nodes.length > 0;
  if (scene.nodes.length === 0) {
    emptyText.textContent = state.graph.nodes.length === 0
      ? state.strings.emptyGraph
      : state.strings.emptyFiltered;
  }
}

function drawCrumbs(scene: Scene): void {
  crumbs.replaceChildren();
  const steps: { label: string; depth: Depth }[] = [{ label: state.strings.breadcrumbRoot, depth: 0 }];
  if (scene.focus.domain) steps.push({ label: scene.focus.domain, depth: 1 });
  if (scene.focus.docId) steps.push({ label: scene.focus.docId, depth: 2 });
  if (scene.depth === 3) steps.push({ label: state.strings.breadcrumbCode, depth: 3 });

  steps.forEach((step, index) => {
    if (index > 0) {
      const sep = document.createElement("span");
      sep.className = "sep";
      sep.textContent = "›";
      crumbs.append(sep);
    }
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = step.label;
    const isLast = index === steps.length - 1;
    button.disabled = isLast;
    if (!isLast) {
      button.addEventListener("click", () => {
        // 一段ずつ上がる。段ごとに別の操作を持たせない。
        while (state.position.depth > step.depth) goUp();
      });
    }
    crumbs.append(button);
  });

  const hint = document.createElement("span");
  hint.className = "hint";
  hint.textContent = state.strings.hint;
  crumbs.append(hint);
}

function drawDials(mode: LayoutMode): void {
  colorBySelect.value = state.lens.colorBy;

  const allowed = layoutsFor(state.lens.depth);
  layoutSelect.replaceChildren(
    ...allowed.map((value) => optionEl(value, layoutLabel(value))),
  );
  layoutSelect.value = mode;

  fillFilterOptions(filterTypeSelect, distinctValues("type"), state.lens.filter.types[0] ?? "");
  fillFilterOptions(
    filterDomainSelect,
    distinctValues("domain"),
    state.lens.filter.domains[0] ?? "",
  );
  currentOnlyBox.checked = state.lens.filter.currentOnly;
  currentOnlyBox.disabled = state.registry === null;
  currentOnlyBox.title = state.registry === null ? state.strings.registryUnavailable : "";

  savedLensSelect.replaceChildren(
    optionEl("", state.strings.savedLensPlaceholder),
    ...state.savedLenses.map((s) => optionEl(s.name, s.name)),
  );
  // 選び直しのあとも、当てているレンズの名を保つ。保たないと、描き直すたびに
  // 選択が空へ戻り、削除の釦に永久に到達できない。
  //
  // ただし名前だけで保つと逆の嘘をつく。ダイヤルを一つでも回せば、それはもう
  // その名前のレンズではない。四つの値が今も一致するときだけ名を出す。
  // 深度は降りる・上がるでも動くので、ここで一括して見るのが漏れない。
  const held = state.savedLenses.find((s) => s.name === state.activeLensName);
  const active = held && sameLens(held.lens, state.lens) ? held.name : "";
  if (active === "") state.activeLensName = "";
  savedLensSelect.value = active;
  el<HTMLButtonElement>("deleteLens").disabled = active === "";
}

/** 列の見出しを訳す。`data` のときだけ上流の値をそのまま出す（ADR-007）。 */
function laneLabel(lane: { kind: string; label: string }): string {
  const s = state.strings;
  if (lane.kind === "data") return lane.label || s.noValue;
  if (lane.kind === "incoming") return s.dependedOnBy;
  if (lane.kind === "focus") return s.focus;
  if (lane.kind === "outgoing") return s.dependsOn;
  return s.boundRanges;
}

/** 器に静的に置いてある札を、届いた文字列で埋める（ADR-007）。 */
function applyStaticStrings(): void {
  const s = state.strings;
  el("lblColorBy").textContent = s.dialColor;
  el("lblLayout").textContent = s.dialLayout;
  el("lblFilterType").textContent = s.dialFilterType;
  el("lblFilterDomain").textContent = s.dialFilterDomain;
  el("lblCurrentOnly").textContent = s.dialCurrentOnly;
  el("lblSavedLens").textContent = s.dialLens;
  el("saveLens").textContent = s.save;
  el("deleteLens").textContent = s.remove;
  el("refresh").textContent = s.refresh;
  busy.textContent = s.busy;
  el("svgTitle").textContent = s.breadcrumbRoot;
  colorBySelect.replaceChildren(
    ...(["type", "status", "domain", "owner"] as const).map((k) =>
      optionEl(k, colorByLabel(k)),
    ),
  );
  colorBySelect.value = state.lens.colorBy;
}

function optionEl(value: string, label: string): HTMLOptionElement {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  return option;
}

/** 節点が実際に持つ値を集める。値の一覧を持たない（REQ-003）。 */
function distinctValues(key: "type" | "domain"): string[] {
  const found = new Set<string>();
  for (const node of state.graph.nodes) {
    const value = node[key];
    if (typeof value === "string" && value) found.add(value);
  }
  const known = key === "type" ? (state.registry?.types ?? []) : [];
  const ordered = known.filter((v) => found.has(v));
  const rest = [...found].filter((v) => !known.includes(v)).sort();
  return [...ordered, ...rest];
}

function fillFilterOptions(
  select: HTMLSelectElement,
  values: readonly string[],
  selected: string,
): void {
  select.replaceChildren(optionEl("", state.strings.all), ...values.map((v) => optionEl(v, v)));
  select.value = values.includes(selected) ? selected : "";
}

function drawSvg(scene: Scene, layout: Layout, scale: ReadonlyMap<string, string>): void {
  const title = svg.querySelector("title");
  svg.replaceChildren();
  if (title) svg.append(title);

  const root = svgEl("g", {
    transform: `translate(${view.tx} ${view.ty}) scale(${view.scale})`,
  });
  root.setAttribute("id", "viewport");
  svg.append(root);

  const placedByKey = new Map<string, Placed>(layout.nodes.map((p) => [p.key, p]));

  root.append(arrowDefs());

  // 辺を先に描く。節点の下へ回すため。
  const edgeLayer = svgEl("g");
  for (const edge of scene.edges) {
    const from = placedByKey.get(edge.src);
    const to = placedByKey.get(edge.dst);
    if (!from || !to || edge.src === edge.dst) continue;
    // 中心どうしを結ぶと線が箱を貫き、ラベルに重なる。矩形の縁で止める。
    const start = borderPoint(from, center(to));
    const end = borderPoint(to, center(from), ARROW_GAP);
    const line = svgEl("line", {
      class: "edge",
      x1: start.x, y1: start.y, x2: end.x, y2: end.y,
      "stroke-width": Math.min(1 + Math.log2(edge.weight + 1), 5),
      "marker-end": "url(#arrow)",
    });
    edgeLayer.append(line);
    if (edge.weight > 1) {
      const label = svgEl("text", {
        class: "edge-label",
        x: (start.x + end.x) / 2,
        y: (start.y + end.y) / 2 - 5,
        "text-anchor": "middle",
      });
      label.textContent = `${edge.weight} ${state.strings.edgeCount}`;
      edgeLayer.append(label);
    }
  }
  root.append(edgeLayer);

  // レーンの列見出し。
  for (const lane of layout.lanes) {
    const label = svgEl("text", { class: "lane-label", x: lane.x, y: 16 });
    label.textContent = laneLabel(lane);
    root.append(label);
  }

  const byKey = new Map<string, SceneNode>(scene.nodes.map((n) => [n.key, n]));
  for (const placed of layout.nodes) {
    const node = byKey.get(placed.key);
    if (!node) continue;
    root.append(drawNode(node, placed, scale));
  }

  fitIfUnset(layout);
  root.setAttribute("transform", `translate(${view.tx} ${view.ty}) scale(${view.scale})`);
}

function drawNode(
  node: SceneNode,
  placed: Placed,
  scale: ReadonlyMap<string, string>,
): SVGGElement {
  const group = svgEl("g", { class: `node${node.isFocus ? " focus" : ""}`, tabindex: 0 });
  group.dataset["key"] = node.key;

  // L3 の節点は上流の項を持たないので色の基準が効かない。
  // 指紋が食い違う範囲だけを別の色で示す（SPEC-003 色の節）。
  const stale = node.kind === "range" && node.isFocus;
  const fill =
    node.kind === "range"
      ? stale
        ? "var(--vscode-inputValidation-errorBorder)"
        : "var(--vscode-textLink-foreground)"
      : node.node
        ? colorOf(node.node, state.lens.colorBy, scale)
        : "var(--vscode-editorWidget-background)";

  const rect = svgEl("rect", {
    x: placed.x, y: placed.y, width: placed.w, height: placed.h,
    rx: 5,
    fill: node.kind === "domain" ? "var(--vscode-editorWidget-background)" : fill,
    "fill-opacity": node.kind === "domain" ? 1 : 0.22,
    stroke: node.kind === "domain" ? "var(--vscode-panel-border)" : fill,
  });
  group.append(rect);

  if (node.kind === "range") {
    // 範囲は左寄せで読む。ファイルのパスと行を分けて出す。
    const path = svgEl("text", {
      x: placed.x + 14, y: placed.y + 22,
      fill: "var(--vscode-foreground)",
    });
    path.textContent = truncate(node.label, 52);
    const lines = svgEl("text", {
      class: "sub",
      x: placed.x + 14, y: placed.y + 38,
      fill: "var(--vscode-descriptionForeground)",
    });
    const range = node.range;
    lines.textContent = range
      ? `${range.begin_line}–${range.end_line} · ${node.count} ${state.strings.lines}` +
        (stale ? ` · ${state.strings.staleHere}` : "")
      : "";
    const accessibleRange = svgEl("title");
    accessibleRange.textContent = `${node.label} ${lines.textContent}`;
    group.append(path, lines, accessibleRange);
    group.addEventListener("click", () => selectNode(node.key));
    group.addEventListener("dblclick", () => goDown(node.key));
    group.addEventListener("keydown", (event) => {
      if ((event as KeyboardEvent).key === "Enter") {
        event.preventDefault();
        goDown(node.key);
      }
    });
    return group;
  }

  const label = svgEl("text", {
    x: placed.x + placed.w / 2,
    y: placed.y + placed.h / 2 + (node.kind === "domain" ? -2 : 4),
    "text-anchor": "middle",
    fill: "var(--vscode-foreground)",
  });
  label.textContent = truncate(node.label, node.kind === "domain" ? 22 : 18);
  group.append(label);

  const sub = svgEl("text", {
    class: "sub",
    x: placed.x + placed.w / 2,
    y: placed.y + placed.h / 2 + 14,
    "text-anchor": "middle",
    fill: "var(--vscode-descriptionForeground)",
  });
  sub.textContent = node.kind === "domain"
    ? `${node.count} ${state.strings.docsCount}`
    : truncate(String(node.node?.title ?? node.node?.type ?? ""), 20);
  group.append(sub);

  const accessible = svgEl("title");
  accessible.textContent = node.kind === "domain"
    ? `${node.label} — ${node.count} ${state.strings.docsCount}`
    : `${node.label} — ${node.node?.type ?? ""} / ${node.node?.status ?? ""}`;
  group.append(accessible);

  group.addEventListener("click", () => selectNode(node.key));
  group.addEventListener("dblclick", () => goDown(node.key));
  group.addEventListener("keydown", (event) => {
    const key = (event as KeyboardEvent).key;
    if (key === "Enter") {
      event.preventDefault();
      goDown(node.key);
    }
  });
  return group;
}

/** 一度も動かしていなければ、全体が入る倍率へ合わせる。 */
let fitted = false;
function fitIfUnset(layout: Layout): void {
  if (fitted || layout.width === 0 || layout.height === 0) return;
  const box = canvas.getBoundingClientRect();
  if (box.width === 0 || box.height === 0) return;
  const margin = 32;
  const scale = Math.min(
    (box.width - margin * 2) / layout.width,
    (box.height - margin * 2) / layout.height,
    1.4,
  );
  view.scale = Math.max(0.2, scale);
  view.tx = (box.width - layout.width * view.scale) / 2;
  view.ty = (box.height - layout.height * view.scale) / 2;
  fitted = true;
}

function drawInspector(scene: Scene): void {
  // L3 では、焦点の文書そのものを示す（節点は範囲であり、上流の項を持たない）。
  const key = scene.depth === 3 ? scene.focus.docId : (state.selected ?? scene.focus.docId);
  const target = key ? scene.nodes.find((n) => n.key === key) : undefined;
  const node =
    target?.node ??
    (scene.depth === 3 && scene.focus.docId
      ? state.graph.nodes.find((n) => n.id === scene.focus.docId)
      : undefined);
  if (!node) {
    inspector.hidden = true;
    inspector.replaceChildren();
    return;
  }
  inspector.hidden = false;
  inspector.replaceChildren();

  const heading = document.createElement("h2");
  heading.textContent = node.id;
  inspector.append(heading);

  const path = document.createElement("p");
  path.className = "path";
  path.textContent = node.path;
  inspector.append(path);

  // 上流が返した項をそのまま並べる。読む項を決め打ちしない。
  const list = document.createElement("dl");
  for (const [field, value] of Object.entries(node)) {
    if (field === "id" || field === "path") continue;
    if (Array.isArray(value) && value.length === 0) continue;
    const dt = document.createElement("dt");
    dt.textContent = field;
    const dd = document.createElement("dd");
    dd.textContent = Array.isArray(value) ? value.join(", ") : String(value);
    list.append(dt, dd);
  }
  inspector.append(list);

  const incoming = scene.edges.filter((e) => e.dst === node.id).map((e) => e.src);
  const outgoing = scene.edges.filter((e) => e.src === node.id).map((e) => e.dst);
  appendIdList(state.strings.dependedOnBy, incoming);
  appendIdList(state.strings.dependsOn, outgoing);
  appendRangeList(node.id);

  // class 名に上流の語彙と同じ綴りを使わない。REQ-003 の走査が字面で見るためである。
  const openButton = document.createElement("button");
  openButton.type = "button";
  openButton.className = "open-doc";
  openButton.textContent = state.strings.openDocument;
  openButton.addEventListener("click", () => send({ kind: "openDocument", path: node.path }));
  inspector.append(openButton);
}

/** 文書に結ばれたコード範囲を並べる。無ければ何も出さない。 */
function appendRangeList(docId: string): void {
  const mine = rangesForDocument(state.ranges ?? [], docId);
  const heading = document.createElement("h3");
  heading.textContent = state.ranges === null
    ? state.strings.boundRanges
    // 約物は訳語の側に持たせる。実装に全角の（）を書くと、英語の表示に CJK の
    // 約物が混じる（ADR-007・実際に起きた欠陥）。
    : state.strings.boundRangesCount.replace("{0}", String(mine.length));
  inspector.append(heading);

  if (state.ranges === null) {
    const note = document.createElement("p");
    note.style.cssText = "margin:0;font-size:.88em;opacity:.75";
    note.textContent = state.strings.rangesUnavailable;
    inspector.append(note);
    return;
  }
  if (mine.length === 0) {
    const note = document.createElement("p");
    note.style.cssText = "margin:0;font-size:.88em;opacity:.75";
    note.textContent = state.strings.noBoundRanges;
    inspector.append(note);
    return;
  }

  if (state.staleIds.has(docId)) {
    const warn = document.createElement("p");
    warn.style.cssText =
      "margin:0 0 6px;font-size:.85em;color:var(--vscode-inputValidation-errorBorder)";
    warn.textContent = state.strings.staleHere;
    inspector.append(warn);
  }

  const list = document.createElement("ul");
  for (const range of mine) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `${range.path}:${range.begin_line}`;
    button.style.cssText =
      "background:none;border:none;padding:0;cursor:pointer;font:inherit;text-align:left;color:var(--vscode-textLink-foreground)";
    button.addEventListener("click", () =>
      send({
        kind: "openRange",
        path: range.path,
        beginLine: range.begin_line,
        endLine: range.end_line,
      }),
    );
    item.append(button);
    list.append(item);
  }
  inspector.append(list);
}

function appendIdList(title: string, ids: readonly string[]): void {
  if (ids.length === 0) return;
  const heading = document.createElement("h3");
  heading.textContent = title;
  const list = document.createElement("ul");
  for (const id of [...new Set(ids)].sort()) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = id;
    button.style.cssText =
      "background:none;border:none;padding:0;cursor:pointer;font:inherit;color:var(--vscode-textLink-foreground)";
    button.addEventListener("click", () => {
      state.selected = id;
      render();
    });
    item.append(button);
    list.append(item);
  }
  inspector.append(heading, list);
}

function drawLegend(scene: Scene, scale: ReadonlyMap<string, string>): void {
  legend.replaceChildren();
  if (scene.depth === 3) {
    const note = document.createElement("span");
    const stale = scene.nodes.some((n) => n.isFocus);
    // 判定を一度も取れていないときに「一致している」と言ってはならない。
    // 食い違いが挙がっていないことは、一致を確かめたことではない（ADR-008）。
    note.textContent = stale
      ? state.strings.legendL3Stale
      : state.auditAt
        ? state.strings.legendL3Clean
        : state.strings.legendL3Unknown;
    legend.append(note, auditStamp());
    return;
  }
  if (scene.depth === 0) {
    const note = document.createElement("span");
    note.textContent = state.strings.legendL0;
    legend.append(note, auditStamp());
    return;
  }
  const seen = new Set<string>();
  for (const node of scene.nodes) {
    if (!node.node) continue;
    const key = colorKeyOf(node.node, state.lens.colorBy);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const item = document.createElement("span");
    const swatch = document.createElement("i");
    swatch.style.background = scale.get(key) ?? "transparent";
    item.append(swatch, document.createTextNode(key));
    legend.append(item);
  }
  // 判定の時点はどの段でも出す。食い違いを断定しておいて、
  // それがいつの判定かを言わない段が在ってはならない（ADR-008）。
  legend.append(auditStamp());
}

/** 深度を戻した理由を訳す（ADR-007）。 */
function recoveredText(reason: RecoveredReason): string {
  const s = state.strings;
  if (reason === "domain-gone") return s.recoveredDomainGone;
  if (reason === "doc-gone") return s.recoveredDocGone;
  if (reason === "no-ranges") return s.noBoundRanges;
  return s.rangesUnavailableNote;
}

/**
 * 指紋の判定がいつのものかを示す札（ADR-008）。
 *
 * 速い拍では判定を取り直さないので、画面の食い違いの表示は前回のもののままである。
 * いつの判定かを出さないと、古い判定を新しい事実と取り違える。
 */
function auditStamp(): HTMLElement {
  const stamp = document.createElement("span");
  stamp.style.cssText = "opacity:.7";
  stamp.textContent = state.auditAt
    ? state.strings.auditAsOf.replace("{0}", new Date(state.auditAt).toLocaleString())
    : state.strings.auditNever;
  return stamp;
}

function drawSceneNotice(scene: Scene): void {
  const parts: string[] = [];
  if (scene.recovered) parts.push(recoveredText(scene.recovered));
  if (scene.danglingEdges > 0) {
    parts.push(`${state.strings.danglingEdges} (${scene.danglingEdges})`);
  }
  if (state.registry === null && state.graph.nodes.length > 0) {
    parts.push(state.strings.registryUnavailable);
  }
  if (state.ranges === null && state.graph.nodes.length > 0) {
    parts.push(state.strings.rangesUnavailableNote);
  }
  if (parts.length === 0) {
    sceneNotice.hidden = true;
    sceneNotice.replaceChildren();
    return;
  }
  sceneNotice.hidden = false;
  sceneNotice.replaceChildren(document.createTextNode(parts.join(" ")));
}

// --- 操作 ----------------------------------------------------------------

function selectNode(key: string): void {
  state.selected = key;
  render();
}

function goDown(key: string): void {
  const scene = currentScene();
  // L3 の節点はコード範囲であり、その先の段は無い。開くのは編集器の役目である。
  const target = scene.nodes.find((n) => n.key === key);
  if (target?.kind === "range" && target.range) {
    send({
      kind: "openRange",
      path: target.range.path,
      beginLine: target.range.begin_line,
      endLine: target.range.end_line,
    });
    return;
  }
  const next = descend(state.position, key, scene, sceneContext());
  if (!next) return;
  state.position = next;
  state.lens = withDepth(state.lens, next.depth);
  state.selected = next.focus.docId;
  fitted = false;
  persist();
  render();
}

function goUp(): void {
  const next = ascend(state.position);
  if (next === state.position) return;
  state.position = next;
  state.lens = withDepth(state.lens, next.depth);
  state.selected = next.focus.docId;
  fitted = false;
  persist();
  render();
}

function applyLens(lens: Lens, focus: Focus = state.position.focus): void {
  state.lens = lens;
  state.position = { depth: lens.depth, focus };
  persist();
  render();
}

/** 四つの値が等しいか。絞りは中身まで見る。 */
function sameLens(a: Lens, b: Lens): boolean {
  const sameList = (x: readonly string[], y: readonly string[]): boolean =>
    x.length === y.length && x.every((v, i) => v === y[i]);
  return (
    a.colorBy === b.colorBy &&
    a.layout === b.layout &&
    a.depth === b.depth &&
    a.filter.currentOnly === b.filter.currentOnly &&
    sameList(a.filter.domains, b.filter.domains) &&
    sameList(a.filter.types, b.filter.types)
  );
}

function persist(): void {
  // webview 自身の状態として持つ。画面を閉じて開き直すとここから戻る。
  vscode.setState({ lens: state.lens, position: state.position });
}

colorBySelect.addEventListener("change", () => {
  applyLens(withColorBy(state.lens, colorBySelect.value as ColorBy));
});
layoutSelect.addEventListener("change", () => {
  applyLens(withLayout(state.lens, layoutSelect.value as LayoutMode));
});
filterTypeSelect.addEventListener("change", () => {
  const value = filterTypeSelect.value;
  applyLens(
    withFilter(state.lens, { ...state.lens.filter, types: value ? [value] : [] }),
  );
});
filterDomainSelect.addEventListener("change", () => {
  const value = filterDomainSelect.value;
  applyLens(
    withFilter(state.lens, { ...state.lens.filter, domains: value ? [value] : [] }),
  );
});
currentOnlyBox.addEventListener("change", () => {
  applyLens(
    withFilter(state.lens, { ...state.lens.filter, currentOnly: currentOnlyBox.checked }),
  );
});
savedLensSelect.addEventListener("change", () => {
  const saved = state.savedLenses.find((s) => s.name === savedLensSelect.value);
  state.activeLensName = saved ? saved.name : "";
  el<HTMLButtonElement>("deleteLens").disabled = !saved;
  if (!saved) return;
  fitted = false;
  // 焦点も併せて戻す。焦点を今のままにすると、深度 1 以上を保存していても
  // 段だけが黙って落ちる（四つの値のうち深度だけが失われる）。
  // 焦点の指す文書やドメインが既に無ければ、場面の側が段を戻して理由を告げる。
  applyLens(saved.lens, saved.focus ?? NO_FOCUS);
});
el("saveLens").addEventListener("click", () => {
  // 名前は本体に訊いてもらう。webview の sandbox に `allow-modals` が無いので
  // `window.prompt` は必ず null を返す（実機で保存が無反応だった）。
  send({ kind: "requestSaveLens", lens: state.lens, focus: state.position.focus });
});
el("deleteLens").addEventListener("click", () => {
  const name = savedLensSelect.value;
  if (!name) return;
  state.activeLensName = "";
  send({ kind: "deleteLens", name });
});
el("refresh").addEventListener("click", () => send({ kind: "refresh" }));

canvas.addEventListener("keydown", (event) => {
  if (event.key === "Backspace") {
    event.preventDefault();
    goUp();
  }
});

// 平行移動と拡大。地図そのものの座標は動かさない。
let dragging: { x: number; y: number } | null = null;
svg.addEventListener("pointerdown", (event) => {
  if ((event.target as Element).closest(".node")) return;
  dragging = { x: event.clientX - view.tx, y: event.clientY - view.ty };
  svg.classList.add("dragging");
  svg.setPointerCapture(event.pointerId);
});
svg.addEventListener("pointermove", (event) => {
  if (!dragging) return;
  view.tx = event.clientX - dragging.x;
  view.ty = event.clientY - dragging.y;
  applyViewport();
});
const endDrag = (): void => {
  dragging = null;
  svg.classList.remove("dragging");
};
svg.addEventListener("pointerup", endDrag);
svg.addEventListener("pointercancel", endDrag);
svg.addEventListener("wheel", (event) => {
  event.preventDefault();
  const box = svg.getBoundingClientRect();
  const px = event.clientX - box.left;
  const py = event.clientY - box.top;
  const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
  const next = Math.min(4, Math.max(0.15, view.scale * factor));
  // 指した点を動かさずに拡大する。
  view.tx = px - ((px - view.tx) * next) / view.scale;
  view.ty = py - ((py - view.ty) * next) / view.scale;
  view.scale = next;
  applyViewport();
}, { passive: false });

function applyViewport(): void {
  const root = svg.querySelector("#viewport");
  root?.setAttribute("transform", `translate(${view.tx} ${view.ty}) scale(${view.scale})`);
}

// --- 本体との受け渡し ----------------------------------------------------

window.addEventListener("message", (event: MessageEvent<ToWebview>) => {
  const message = event.data;
  if (message.kind === "snapshot") {
    state.graph = message.graph;
    state.registry = message.registry;
    state.docsRoot = message.docsRoot;
    state.savedLenses = message.savedLenses;
    state.ranges = message.ranges;
    state.staleIds = new Set(message.staleIds);
    state.strings = tolerantStrings(message.strings);
    state.auditAt = message.auditAt;
    applyStaticStrings();
    render();
    return;
  }
  if (message.kind === "savedLenses") {
    state.savedLenses = message.savedLenses;
    // 保存した直後はその名を選んでおく。選ばないと、保存できたことが画面に出ず、
    // 消すにも一度選び直さねばならない。
    if (message.justSaved) state.activeLensName = message.justSaved;
    render();
    return;
  }
  if (message.kind === "strings") {
    state.strings = tolerantStrings(message.strings);
    applyStaticStrings();
    render();
    return;
  }
  if (message.kind === "busy") {
    busy.hidden = !message.busy;
    return;
  }
  if (message.kind === "notice") {
    // 中身の無い通知は「消せ」の意味である。隠さないと、取得が成功するたびに
    // 空の帯が地図の上に残る。
    const empty = !message.text && !message.detail;
    notice.hidden = empty;
    notice.classList.toggle("error", !empty && message.tone === "error");
    notice.replaceChildren(document.createTextNode(message.text));
    if (message.detail) {
      const pre = document.createElement("pre");
      pre.textContent = message.detail;
      notice.append(pre);
    }
    return;
  }
  if (message.kind === "reveal") {
    const found = state.graph.nodes.find((n) => n.id === message.docId);
    if (!found) return;
    fitted = false;
    state.selected = found.id;
    applyLens(withDepth(state.lens, 2), { domain: found.domain, docId: found.id });
  }
});

// 画面を閉じて開き直したときのために、前回の値を取り戻す。
const restored = vscode.getState() as { lens?: Lens; position?: Position } | undefined;
if (restored?.lens) state.lens = restored.lens;
if (restored?.position) state.position = restored.position;

send({ kind: "ready" });
render();
// doctrine:end SPEC-002
