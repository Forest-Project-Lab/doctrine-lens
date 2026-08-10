// 実測 overlay の候補にするアンカーを選ぶ。**条件はここだけが持つ。**
//
// なぜ一本化するか: 同じ条件を生成側と検める側の二箇所に書くと、片方だけ緩めても
// 落ちない。緩めた側が「候補 0 件」と言い、もう片方が「候補が在るのに測っていない」
// と言えなくなる —— 被覆の穴が、被覆を検める規則の中に開く。
//
// 条件そのものを緩めないこと。`authority` は鮮度判定の権威であり(台帳 v3.2-10)、
// doctrine 以外のアンカーを doctrine の CLI で測ると、**第二の権威を作ることになる**。
import { OVERLAY_CANDIDATE } from "../gold-model/spec.mjs";

/** この模型のうち、宣言済み CLI で測れるアンカー。 */
export const overlayCandidates = (model) =>
  (model.anchors ?? []).filter(
    (a) => a.authority === OVERLAY_CANDIDATE.authority && a.target_kind === OVERLAY_CANDIDATE.target_kind,
  );
