// 利用者に見える文字列を一箇所に集める（ADR-007）。
//
// 原文は英語で書く。日本語は l10n/bundle.l10n.ja.json が持つ。
// webview は翻訳の仕組みを持たないので、ここで訳した一式を渡す（ADR-007）。
import * as vscode from "vscode";

import type { ViewStrings } from "./model/view.js";

const t = vscode.l10n.t;

/** 取得ができない理由ごとの案内。読み手が次に何をすればよいかまで書く。 */
export const messages = {
  noWorkspace: (): string => t("No folder is open."),

  noTree: (): string => t("No doctrine tree here."),
  noTreeDetail: (): string =>
    t(
      "Lay down doctrine_docs/ — run /doctrine:docs-system-init in a Claude Code session, or the doctrine plugin's scaffold.py. The list picks it up within a few seconds; if it does not, run \"Doctrine Lens: Refresh\".",
    ),

  docsRootRejected: (value: string): string =>
    t("The doctrineLens.docsRoot setting ({0}) does not point at a usable tree.", value),
  docsRootRejectedDetail: (): string =>
    t(
      "It must stay inside the workspace folder and end in doctrine_docs, or a docs directory that has a _system subdirectory.",
    ),

  pluginPathRejected: (value: string): string =>
    t(
      "The doctrineLens.pluginPath setting ({0}) does not point at the doctrine plugin. Point it at the directory that contains scripts/docs-audit.py — inside a clone that is the plugin/ subdirectory.",
      value,
    ),

  noPlugin: (): string => t("The doctrine plugin was not found."),
  noPluginDetail: (): string =>
    "claude plugin marketplace add https://github.com/Forest-Project-Lab/doctrine.git\n" +
    "claude plugin install doctrine@forest-project-lab --scope project",

  badSetting: (): string =>
    t("A Doctrine Lens setting is not usable. Check doctrineLens.pythonPath: it must be an absolute path, a \"~/\" path, or a bare command name."),

  spawnFailed: (): string =>
    t("Cannot start python. Check the doctrineLens.pythonPath setting."),
  exitNonZero: (): string => t("The doctrine CLI failed."),
  badJson: (): string => t("The doctrine CLI returned output that is not JSON."),
  timedOut: (): string =>
    t("The doctrine CLI did not finish in time. Raise the doctrineLens.timeoutMs setting."),
  keptPrevious: (): string => t("Showing the list from the last successful fetch."),

  partial: (what: string): string =>
    t("Could not fetch {0}. The list is still available.", what),
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
    t("{0} was not found. It may disappear when the list is refreshed.", path),

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
  onlyTree: (path: string): string =>
    t("There is only one doctrine tree, so there is nothing to choose: {0}", path),

  pickFolderTitle: (): string => t("Which doctrine tree should this read?"),
  lineRange: (begin: number, end: number): string =>
    t("lines {0}–{1}", String(begin), String(end)),

  statusBusy: (): string => t("Doctrine Lens: fetching…"),
  statusReady: (docs: number, label: string): string =>
    t("Doctrine Lens: {0} docs · {1}", String(docs), label),
  statusStale: (count: number): string => t("{0} stale", String(count)),
  statusUnavailable: (): string => t("Doctrine Lens: unavailable"),
  auditAsOf: (time: string): string => t("Fingerprint verdict as of {0}", time),
  auditNever: (): string => t("Fingerprint verdict not fetched yet"),

  notInGraphShort: (): string => t("not in the tree"),
  staleShort: (): string => t("fingerprint mismatch"),
  partialOrphans: (): string => t("what is missing"),
  partialTitles: (): string => t("document titles"),
  partialGlossary: (): string => t("the glossary"),
  showOnMap: (): string => t("Show what this changes"),
} as const;

/**
 * 明細を組み立てるための文言（ADR-007）。
 *
 * `src/model/view.ts` が受け取り、差し込みを済ませてから webview へ渡す。
 * webview は翻訳の仕組みを持たず、判断も持たない。
 */
export function viewStrings(): ViewStrings {
  return {
    summaryCounts: t("{0} documents to fix · {1} code ranges", "{0}", "{1}"),
    summarySymbols: t("× {0} · + {1} · ? {2} · ! {3} · ~ {4}", "{0}", "{1}", "{2}", "{3}", "{4}"),
    summaryFacts: t(
      "already broken {0} · missing {1} · no code range {2}",
      "{0}", "{1}", "{2}",
    ),
    summaryFactNotCurrent: t("not current {0}", "{0}"),
    summaryFactsNote: t(" (a row shows only its heaviest symbol)"),
    summaryCycles: t("{0} cycles ({1} documents)", "{0}", "{1}"),
    waveHeading: t("Wave {0}", "{0}"),
    waveCount: t("{0} documents", "{0}"),
    waveFirstNote: t("nothing else has to be fixed first"),
    waveLaterNote: t("something in wave {0} has to be fixed first", "{0}"),
    reasonAlsoDirect: t("It also has {0} directly.", "{0}"),
    reasonDirect: t("Has {0} in depends_on. Its premise changes.", "{0}"),
    reasonThrough: t("Depends on {1} through {0}.", "{0}", "{1}"),
    reasonImpacted: t("{0} declares that it impacts this.", "{0}"),
    rangeLabel: t("{0}:{1}-{2}", "{0}", "{1}", "{2}"),
    noOrigin: t(
      "No origin. This screen only answers \"what happens if I change what I have open\". Open a file that carries a doctrine marker, or a .md inside the tree. What is open now is {0}.",
      "{0}",
    ),
    noOriginNoFile: t(
      "No origin. This screen only answers \"what happens if I change what I have open\". Open a file that carries a doctrine marker, or a .md inside the tree.",
    ),
    footPremises: t(
      "{0} documents the origin relies on are not listed — this screen only walks forward",
      "{0}",
    ),
    footHidden: t("{0} documents reach the origin in neither direction and are not listed", "{0}"),
    footElsewhere: t(
      "{0} documents that do not reach the origin carry findings — open one to see them",
      "{0}",
    ),
    footUnattached: t(
      "{0} findings are outside this screen's question (they belong to no document)",
      "{0}",
    ),
    originFindingsNote: t("Upstream says this document itself is broken:"),
    footAudit: t("Upstream docs-audit ran {1} checks at {0}", "{0}", "{1}"),
    footAuditNever: t("Upstream docs-audit has not run yet"),
    footNoTitles: t("Some titles could not be read; those rows show the id instead"),
    footBehind: t("The number on the right of a row is how many others it settles once fixed"),
    rowSucceeds: t("succeeded by {0}", "{0}"),
    cycleNote: t("{0} cycles: those documents have no wave until the cycle is broken", "{0}"),
    legendBroken: t("× broken"),
    legendMissing: t("+ missing"),
    legendNowhere: t("? nowhere to fix"),
    legendFix: t("! fix"),
    legendReview: t("~ review"),
  };
}

/** webview の器に静的に置く札。数が少ないので型を分けない。 */
export function shellStrings(): ShellStrings {
  return {
    title: t("Consequence"),
    refresh: t("Refresh"),
    busy: t("Fetching…"),
    follow: t("Follows the cursor"),
  };
}

export interface ShellStrings {
  title: string;
  refresh: string;
  busy: string;
  follow: string;
}
