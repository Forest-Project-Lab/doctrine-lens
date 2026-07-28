// 利用者に見える文字列を一箇所に集める（ADR-007）。
//
// 原文は英語で書く。日本語は l10n/bundle.l10n.ja.json が持つ。
// webview は翻訳の仕組みを持たないので、ここで訳した一式を渡す（ADR-007）。
import * as vscode from "vscode";

const t = vscode.l10n.t;

/** 取得ができない理由ごとの案内。読み手が次に何をすればよいかまで書く。 */
export const messages = {
  noWorkspace: (): string => t("No folder is open."),

  noTree: (): string => t("No doctrine tree here."),
  noTreeDetail: (): string =>
    t(
      "Lay down doctrine_docs/ and the map appears. Run /doctrine:docs-system-init in a Claude Code session, or run the doctrine plugin's scaffold.py.",
    ),

  docsRootRejected: (value: string): string =>
    t("The doctrineLens.docsRoot setting ({0}) does not point at a usable tree.", value),
  docsRootRejectedDetail: (): string =>
    t(
      "It must stay inside the workspace folder and end in doctrine_docs, or a docs directory that has a _system subdirectory.",
    ),

  noPlugin: (): string => t("The doctrine plugin was not found."),
  noPluginDetail: (): string =>
    "claude plugin marketplace add https://github.com/Forest-Project-Lab/doctrine.git\n" +
    "claude plugin install doctrine@forest-project-lab --scope project",

  spawnFailed: (): string =>
    t("Cannot start python. Check the doctrineLens.pythonPath setting."),
  exitNonZero: (): string => t("The doctrine CLI failed."),
  badJson: (): string => t("The doctrine CLI returned output that is not JSON."),
  timedOut: (): string =>
    t("The doctrine CLI did not finish in time. Raise the doctrineLens.timeoutMs setting."),
  keptPrevious: (): string => t("Showing the map from the last successful fetch."),

  partial: (what: string): string =>
    t("Could not fetch {0}. The map is still available.", what),
  partialRegistry: (): string => t("the registry"),
  partialRanges: (): string => t("code ranges"),
  partialFindings: (): string => t("audit findings"),

  noRangesFor: (docId: string): string =>
    t("{0} has no code ranges bound to it.", docId),
  noRangesYet: (): string => t("Code ranges have not been fetched yet."),
  notBound: (): string => t("This position is not bound to any document."),
  notInTree: (): string =>
    t("This document is not in the doctrine tree, or has no id in its frontmatter."),
  notInGraph: (docId: string): string => t("{0} is not in the doctrine tree.", docId),
  cannotOpen: (path: string): string => t("Cannot open {0}.", path),
  missingFile: (path: string): string =>
    t("{0} was not found. It may disappear when the map is refreshed.", path),

  staleWarning: (docId: string): string =>
    t(
      "The recorded fingerprint for {0} and the current code disagree. Check the change, then re-record the fingerprint.",
      docId,
    ),
  staleHowTo: (): string => t("How to re-record"),
  staleHowToDetail: (): string =>
    t(
      "Run the doctrine plugin's trace-index.py to list the ranges and their fingerprints, then rewrite the implementation-fingerprint section of the spec.",
    ),

  pickRangeTitle: (docId: string): string => t("Code ranges bound to {0}", docId),
  pickRangePlaceholder: (): string => t("Choose where to jump"),
  pickFolderTitle: (): string => t("Which doctrine tree should the map show?"),
  lineRange: (begin: number, end: number): string =>
    t("lines {0}–{1}", String(begin), String(end)),

  statusBusy: (): string => t("Doctrine Lens: fetching…"),
  statusReady: (docs: number, label: string): string =>
    t("Doctrine Lens: {0} docs · {1}", String(docs), label),
  statusStale: (count: number): string => t("{0} stale", String(count)),
  statusUnavailable: (): string => t("Doctrine Lens: unavailable"),
  auditAsOf: (time: string): string => t("Fingerprint verdict as of {0}", time),
  auditNever: (): string => t("Fingerprint verdict not fetched yet"),

  lensPromptName: (): string => t("Name for this lens"),

  notInGraphShort: (): string => t("not in the tree"),
  staleShort: (): string => t("fingerprint mismatch"),
  showOnMap: (): string => t("Show on map"),
} as const;

/**
 * webview へ渡す文字列の一式（ADR-007）。
 *
 * webview は翻訳の仕組みを持たない。ここで訳し終えたものだけを渡す。
 * 鍵を足したら webview 側の型も足す。片方だけでは型検査が落ちる。
 */
export function webviewStrings(): WebviewStrings {
  return {
    breadcrumbRoot: t("Context map"),
    breadcrumbCode: t("Code ranges"),
    hint: t("Double-click to go deeper · Backspace to go up"),
    refresh: t("Refresh"),
    busy: t("Fetching…"),
    dialColor: t("Color"),
    dialLayout: t("Layout"),
    dialFilterType: t("Filter by type"),
    dialFilterDomain: t("Filter by domain"),
    dialCurrentOnly: t("Current only"),
    dialLens: t("Lens"),
    save: t("Save"),
    remove: t("Remove"),
    all: t("All"),
    savedLensPlaceholder: t("(saved lenses)"),
    colorType: t("Type"),
    colorStatus: t("Status"),
    colorDomain: t("Domain"),
    colorOwner: t("Owner"),
    layoutMap: t("Map"),
    layoutLane: t("Lanes"),
    layoutDetail: t("Detail"),
    layoutList: t("List"),
    emptyGraph: t("The doctrine tree has no documents."),
    emptyFiltered: t("No node passes the filter.\nThe filter is left as you set it."),
    noValue: t("(no value)"),
    docsCount: t("docs"),
    dependedOnBy: t("Depended on by"),
    dependsOn: t("Depends on"),
    focus: t("Focus"),
    boundRanges: t("Bound code ranges"),
    boundRangesCount: t("Bound code ranges ({0})", "{0}"),
    noBoundRanges: t("No code range is bound to this document."),
    rangesUnavailable: t("Code ranges have not been fetched."),
    staleHere: t("The recorded fingerprint and the current code disagree."),
    openDocument: t("Open document"),
    legendL0: t("Nodes are domains. Lines are cross-domain dependencies; the number is how many were collapsed."),
    legendL3Clean: t("Double-click to open the line in the editor. Fingerprints match the record."),
    // 「指紋を記録し直す」のは統治仕様の `## 実装の指紋` の節を直すことである。
    // ここで npm の命令を案内すると、この拡張機能を入れただけの利用者の手元に
    // 存在しない命令を指す（利用者の側に Node は要らない）。
    legendL3Stale: t("Fingerprints disagree. Review the change, then update the fingerprint section of the governing specification."),
    legendL3Unknown: t("Double-click to open the line in the editor. The fingerprint verdict has not been fetched yet."),
    lines: t("lines"),
    edgeCount: t("edges"),
    recoveredDomainGone: t("The focused domain is gone from the graph."),
    recoveredDocGone: t("The focused document is gone from the graph."),
    danglingEdges: t("Some edges were not drawn because one end is missing from the graph."),
    registryUnavailable: t("The registry could not be read, so the current-only filter and lane order are off."),
    rangesUnavailableNote: t("Code ranges could not be fetched, so L3 is unavailable."),
    auditAsOf: t("Fingerprint verdict as of {0}", "{0}"),
    auditNever: t("Fingerprint verdict not fetched yet"),
  };
}

/** webview が受け取る文字列の型。`webviewStrings` と対で保つ。 */
export interface WebviewStrings {
  breadcrumbRoot: string;
  breadcrumbCode: string;
  hint: string;
  refresh: string;
  busy: string;
  dialColor: string;
  dialLayout: string;
  dialFilterType: string;
  dialFilterDomain: string;
  dialCurrentOnly: string;
  dialLens: string;
  save: string;
  remove: string;
  all: string;
  savedLensPlaceholder: string;
  colorType: string;
  colorStatus: string;
  colorDomain: string;
  colorOwner: string;
  layoutMap: string;
  layoutLane: string;
  layoutDetail: string;
  layoutList: string;
  emptyGraph: string;
  emptyFiltered: string;
  noValue: string;
  docsCount: string;
  dependedOnBy: string;
  dependsOn: string;
  focus: string;
  boundRanges: string;
  /** `{0}` を数で置き換えて使う。約物を実装に持たないための書式（ADR-007）。 */
  boundRangesCount: string;
  noBoundRanges: string;
  rangesUnavailable: string;
  staleHere: string;
  openDocument: string;
  legendL0: string;
  legendL3Clean: string;
  legendL3Stale: string;
  legendL3Unknown: string;
  lines: string;
  edgeCount: string;
  recoveredDomainGone: string;
  recoveredDocGone: string;
  danglingEdges: string;
  registryUnavailable: string;
  rangesUnavailableNote: string;
  auditAsOf: string;
  auditNever: string;
}
