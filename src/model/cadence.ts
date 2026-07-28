// doctrine:begin SPEC-001
// 二つの拍のあいだで、指紋の判定をどう引き継ぐか（ADR-008・SPEC-001 受入基準 10）。
//
// 速い拍（登録簿・グラフ・範囲）は監査を走らせない。走らせない回に判定を
// 捨てると、保存するたびに食い違いの数が 0 へ落ちて見える。実際に起きた。
// 逆に、失敗した回や走らせなかった回に時刻だけ進めると、古い判定へ新しい時刻が
// 付き、帯が「いま確かめた」と嘘をつく。引き継ぎの規則をここに一つだけ置く。
//
// ここは編集器の機能を使わない純粋な関数である（IMPL-001）。

/** 引き継ぐもの。判定そのものと、それを取った時刻。 */
export interface AuditCarry {
  /** 判定を取った時刻。一度も取れていなければ `null`。 */
  readonly auditAt: Date | null;
  /** 指紋が食い違っている文書の id。 */
  readonly staleIds: ReadonlySet<string>;
}

/** この回の取得がどうだったか。 */
export interface AuditRound {
  /** この回に監査を求めたか。速い拍では偽。 */
  readonly withAudit: boolean;
  /** この回の取得が失敗したか。失敗した回は前回の結果がそのまま返る。 */
  readonly failed: boolean;
  /**
   * この回に実際に返った判定。返らなければ `null`。
   *
   * 「食い違いが一つも無い」は空の集合であり、`null` ではない。
   * 二つを混ぜると、判定を取れていないことと、取れて綺麗だったことが
   * 区別できなくなる。
   */
  readonly staleIds: ReadonlySet<string> | null;
}

export const NO_AUDIT: AuditCarry = { auditAt: null, staleIds: new Set() };

/**
 * この回のあとに保つべき判定と時刻を返す。
 *
 * 進めてよいのは「この回に監査を求め、この回の取得が成功し、判定が実際に
 * 返った」ときだけである。それ以外は前回をそのまま返す。
 */
export function carryAudit(
  previous: AuditCarry,
  round: AuditRound,
  now: () => Date = () => new Date(),
): AuditCarry {
  const audited = round.withAudit && !round.failed && round.staleIds !== null;
  if (!audited || round.staleIds === null) return previous;
  return { auditAt: now(), staleIds: round.staleIds };
}
// doctrine:end SPEC-001
