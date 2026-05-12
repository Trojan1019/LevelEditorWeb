import { HAND_TYPES } from "../domain/enums";
import type { HandTypeString } from "../domain/enums";
import type { PoolMultiset } from "../domain/poolStats";
import { computeHandTypeUpperBounds } from "../domain/poolStats";

const HAND_TYPE_LABELS: Record<HandTypeString, string> = {
  HighCard: "高牌",
  Pair: "一对",
  TwoPair: "两对",
  ThreeOfAKind: "三条",
  Straight: "顺子",
  Flush: "同花",
  FullHouse: "葫芦",
  FourOfAKind: "四条",
  StraightFlush: "同花顺",
  RoyalFlush: "皇家同花顺",
};

interface Props {
  multiset: PoolMultiset | null;
  sourceLabel: string;
}

export function HandTypeUpperBoundsPanel({ multiset, sourceLabel }: Props) {
  if (!multiset || multiset.totalCards === 0) {
    return (
      <div className="panel" style={{ fontSize: 13, color: "var(--muted)" }}>
        牌型上界：当前没有可统计的牌。
      </div>
    );
  }

  const upper = computeHandTypeUpperBounds(multiset);
  return (
    <div className="panel" style={{ fontSize: 13 }}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>所有牌型上界</div>
      <div style={{ color: "var(--muted)", fontSize: 12, marginBottom: 8 }}>统计来源：{sourceLabel}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 6 }}>
        {HAND_TYPES.map((h) => (
          <div key={h} style={{ display: "flex", justifyContent: "space-between", gap: 8, borderBottom: "1px solid var(--border)", paddingBottom: 4 }}>
            <span>{HAND_TYPE_LABELS[h]}</span>
            <strong>{upper[h]}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}
