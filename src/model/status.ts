// doctrine:begin SPEC-001
// 状態の帯に何を出すか。
//
// 編集器の型を使わない。切り出してあるのは、この判断に自動の門を効かせるためである。
// 六巡目まで、帯の中身はどの門も見ておらず、件数の条件を反転させても全件が緑だった。
//
// 表示の文字列はここに持たない。何を出すかの符号だけを返し、訳は描き手に委ねる（ADR-007）。

/** 帯が出す種類。 */
export type StatusKind = "unavailable" | "failed" | "ready";

/** 帯に何を出すか。 */
export interface StatusPlan {
  readonly kind: StatusKind;
  /** 文書の数。`ready` のときだけ意味を持つ。 */
  readonly docs: number;
  /** 指紋が食い違っている文書の数。0 なら出さない。 */
  /** 食い違いの件数。**取れていなければ `null`。** 0 と断定しない。 */
  readonly stale: number | null;
  /** 押したときに走る命令。無ければ `null`。 */
  readonly command: string | null;
  /** 警告の色を当てるか。 */
  readonly warn: boolean;
}

/** 帯の中身を決める材料。 */
export interface StatusInput {
  readonly unavailable: boolean;
  readonly failed: boolean;
  readonly docs: number;
  /** 食い違いの件数。**取れていなければ `null`。** */
  readonly staleCount: number | null;
  /** 統治木を持つ作業フォルダの数。二つ以上なら押すと切り替えになる（ADR-006）。 */
  readonly candidateCount: number;
}

export function planStatus(input: StatusInput): StatusPlan {
  if (input.unavailable) {
    return { kind: "unavailable", docs: 0, stale: null, command: null, warn: false };
  }
  if (input.failed) {
    return {
      kind: "failed",
      docs: 0,
      stale: null,
      command: "doctrineLens.refresh",
      warn: true,
    };
  }
  return {
    kind: "ready",
    docs: input.docs,
    // 数は session が保つ値から取る。`snapshot.findings` は速い拍で null になるため、
    // そこから数えると保存のたびに 0 へ落ちる（ADR-008・実際に起きた欠陥）。
    // 取れていなければ数を出さない。0 と書くと「食い違い無し」になる（ADR-023）。
    stale: input.staleCount === null ? null : input.staleCount > 0 ? input.staleCount : 0,
    command:
      input.candidateCount > 1 ? "doctrineLens.selectWorkspaceFolder" : "doctrineLens.open",
    warn: false,
  };
}
// doctrine:end SPEC-001
