import { RANK_MAX, RANK_MIN, SUIT_CODES } from "../domain/enums";
import type { LevelConfigData } from "../domain/levelTypes";
import { computeBoardPreviewSummary, rankLabel } from "../domain/poolStats";

const allRanks = Array.from({ length: RANK_MAX - RANK_MIN + 1 }, (_, i) => RANK_MIN + i);

interface Props {
  level: LevelConfigData;
}

export function PoolStatsPanel({ level }: Props) {
  const summary = computeBoardPreviewSummary(level);

  if (!summary) {
    return (
      <div className="panel" style={{ fontSize: 13, color: "var(--muted)" }}>
        预览统计：棋盘上还没有「固定花色 + 固定点数」的牌（槽位为 N/0 或未布全），无法按预览计数。请先在棋盘里为槽位指定牌面，或完成随机发牌后再看此表。
      </div>
    );
  }

  const { totalCards, grid } = summary;

  return (
    <div className="panel" style={{ fontSize: 13 }}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>预览牌面：每种花色 × 点数（张数，没有则空）</div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", fontSize: 12, minWidth: 420 }}>
          <thead>
            <tr style={{ color: "var(--muted)" }}>
              <th style={{ padding: "4px 8px", textAlign: "left", borderBottom: "1px solid var(--border)" }}>花色</th>
              {allRanks.map((r) => (
                <th key={r} style={{ padding: "4px 6px", borderBottom: "1px solid var(--border)", fontWeight: 500 }}>
                  {rankLabel(r)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SUIT_CODES.map((suit) => (
              <tr key={suit}>
                <td style={{ padding: "4px 8px", borderBottom: "1px solid var(--border)", color: "var(--muted)" }}>{suit}</td>
                {allRanks.map((rank) => {
                  const n = grid.get(suit)?.get(rank) ?? 0;
                  const cell = n > 0 ? String(n) : "";
                  return (
                    <td
                      key={rank}
                      style={{
                        padding: "4px 6px",
                        textAlign: "center",
                        borderBottom: "1px solid var(--border)",
                        color: n > 0 ? "var(--text)" : "var(--muted)",
                        minWidth: 28,
                      }}
                    >
                      {cell}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 8, fontSize: 11, color: "var(--muted)" }}>
        当前棋盘预览里已出现的牌共 <strong>{totalCards}</strong> 张（未固定槽位不计入）。
        与上方花色池/点数池勾选<strong>无关</strong>，只反映当前槽位上的牌；未扣局内打出。右侧「目标可达」在校验时优先按预览牌判断，预览无固定牌时才会按花色池配置估算。
      </div>
    </div>
  );
}
