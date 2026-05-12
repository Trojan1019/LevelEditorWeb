import { HAND_TYPES, LevelWinConditionMode, RANK_MAX, RANK_MIN, SUIT_CODES, isValidHandType } from "./enums";
import type { LevelConfigData } from "./levelTypes";
import type { HandTypeString } from "./enums";

const SUIT_SET = new Set<string>(SUIT_CODES);

export interface PoolMultiset {
  /** 参与统计的实体牌总张数（可重复：多槽同面则计数>1） */
  totalCards: number;
  rankCounts: Map<number, number>;
  suitCounts: Map<string, number>;
  /** suit -> rank -> 张数 */
  grid: Map<string, Map<number, number>>;
}

export function buildPoolMultiset(level: LevelConfigData): PoolMultiset {
  const rankCounts = new Map<number, number>();
  const suitCounts = new Map<string, number>();
  const grid = new Map<string, Map<number, number>>();
  let total = 0;

  const suits = level.PoolSuits.map(String).filter((s) => SUIT_SET.has(s));
  const ranks = [...new Set(level.PoolRanks.map((r) => Math.trunc(r)))].filter((r) => r >= RANK_MIN && r <= RANK_MAX).sort((a, b) => a - b);

  for (const suit of suits) {
    if (!grid.has(suit)) {
      grid.set(suit, new Map());
    }
    for (const rank of ranks) {
      total += 1;
      rankCounts.set(rank, (rankCounts.get(rank) ?? 0) + 1);
      suitCounts.set(suit, (suitCounts.get(suit) ?? 0) + 1);
      grid.get(suit)!.set(rank, 1);
    }
  }

  return { totalCards: total, rankCounts, suitCounts, grid };
}

/** 棋盘上已固定花色+点数的槽位（预览里看得见的牌），按面计数 */
export function buildMultisetFromBoardLayout(level: LevelConfigData): PoolMultiset {
  const rankCounts = new Map<number, number>();
  const suitCounts = new Map<string, number>();
  const grid = new Map<string, Map<number, number>>();
  let total = 0;

  for (const slot of level.BoardLayout ?? []) {
    const suit = String(slot.Suit);
    const rank = Math.trunc(slot.Rank);
    if (!SUIT_SET.has(suit) || rank < RANK_MIN || rank > RANK_MAX) {
      continue;
    }
    if (!grid.has(suit)) {
      grid.set(suit, new Map());
    }
    const row = grid.get(suit)!;
    row.set(rank, (row.get(rank) ?? 0) + 1);
    rankCounts.set(rank, (rankCounts.get(rank) ?? 0) + 1);
    suitCounts.set(suit, (suitCounts.get(suit) ?? 0) + 1);
    total += 1;
  }

  return { totalCards: total, rankCounts, suitCounts, grid };
}

/** 按秩：可组成的不相交「对子」数量上界（每张牌至多参与一个对子） */
export function countDisjointPairs(rankCounts: Map<number, number>): number {
  let s = 0;
  for (const c of rankCounts.values()) {
    s += Math.floor(c / 2);
  }
  return s;
}

/** 按花色：每花色 floor(n/5) 相加，作为「同花五张」次数的上界（不相交） */
export function countFlushFiveUpperBound(suitCounts: Map<string, number>): number {
  let s = 0;
  for (const c of suitCounts.values()) {
    s += Math.floor(c / 5);
  }
  return s;
}

/** 点数池排序后的连续 5 张窗口；返回每个窗口内各秩张数的最小值（该窗口下同花顺/顺子「套数」上界之一） */
export function straightWindowStats(rankCounts: Map<number, number>, poolRanksSorted: number[]): { windows: number; bestMinInWindow: number } {
  if (poolRanksSorted.length < 5) {
    return { windows: 0, bestMinInWindow: 0 };
  }
  let windows = 0;
  let bestMin = 0;
  for (let i = 0; i <= poolRanksSorted.length - 5; i++) {
    const slice = poolRanksSorted.slice(i, i + 5);
    let ok = true;
    for (let k = 1; k < 5; k++) {
      if (slice[k] !== slice[k - 1] + 1) {
        ok = false;
        break;
      }
    }
    if (!ok) {
      continue;
    }
    windows += 1;
    let m = Infinity;
    for (const r of slice) {
      m = Math.min(m, rankCounts.get(r) ?? 0);
    }
    if (m !== Infinity) {
      bestMin = Math.max(bestMin, m);
    }
  }
  return { windows, bestMinInWindow: bestMin };
}

export interface PoolSummary extends PoolMultiset {
  ranksSorted: number[];
  suitsInOrder: string[];
  disjointPairs: number;
  flushFiveUpperBound: number;
  /** 连续五档点数里「最亏那一档有几张」的最佳情况上界，用于展示「顺子最多几条」 */
  straightBottleneck: number;
}

export function computePoolSummary(level: LevelConfigData): PoolSummary | null {
  const m = buildPoolMultiset(level);
  if (m.totalCards === 0) {
    return null;
  }
  const ranksSorted = [...m.rankCounts.keys()].sort((a, b) => a - b);
  const st = straightWindowStats(m.rankCounts, ranksSorted);
  const suitsInOrder = SUIT_CODES.filter((s) => m.suitCounts.has(s));
  return {
    ...m,
    ranksSorted,
    suitsInOrder,
    disjointPairs: countDisjointPairs(m.rankCounts),
    flushFiveUpperBound: countFlushFiveUpperBound(m.suitCounts),
    straightBottleneck: st.bestMinInWindow,
  };
}

/** 预览/棋盘：仅统计 BoardLayout 里已固定的普通牌 */
export function computeBoardPreviewSummary(level: LevelConfigData): PoolSummary | null {
  const m = buildMultisetFromBoardLayout(level);
  if (m.totalCards === 0) {
    return null;
  }
  const ranksSorted = [...m.rankCounts.keys()].sort((a, b) => a - b);
  const st = straightWindowStats(m.rankCounts, ranksSorted);
  const suitsInOrder = SUIT_CODES.filter((s) => m.suitCounts.has(s));
  return {
    ...m,
    ranksSorted,
    suitsInOrder,
    disjointPairs: countDisjointPairs(m.rankCounts),
    flushFiveUpperBound: countFlushFiveUpperBound(m.suitCounts),
    straightBottleneck: st.bestMinInWindow,
  };
}

export function rankLabel(r: number): string {
  if (r <= 10) {
    return String(r);
  }
  if (r === 11) {
    return "J";
  }
  if (r === 12) {
    return "Q";
  }
  if (r === 13) {
    return "K";
  }
  return "A";
}

function maxStraightFlushUpperBound(m: PoolMultiset): number {
  const ranksSorted = [...m.rankCounts.keys()].sort((a, b) => a - b);
  let maxSf = 0;
  for (const suit of SUIT_CODES) {
    const row = m.grid.get(suit);
    if (!row) {
      continue;
    }
    for (let i0 = 0; i0 <= ranksSorted.length - 5; i0++) {
      const slice = ranksSorted.slice(i0, i0 + 5);
      let consec = true;
      for (let k = 1; k < 5; k++) {
        if (slice[k] !== slice[k - 1] + 1) {
          consec = false;
          break;
        }
      }
      if (!consec) {
        continue;
      }
      let mn = Infinity;
      for (const r of slice) {
        mn = Math.min(mn, row.get(r) ?? 0);
      }
      if (mn !== Infinity) {
        maxSf = Math.max(maxSf, mn);
      }
    }
  }
  return maxSf;
}

function maxRoyalFlushUpperBound(m: PoolMultiset): number {
  let total = 0;
  for (const suit of SUIT_CODES) {
    const row = m.grid.get(suit);
    if (!row) {
      continue;
    }
    const n = Math.min(row.get(10) ?? 0, row.get(11) ?? 0, row.get(12) ?? 0, row.get(13) ?? 0, row.get(14) ?? 0);
    total += n;
  }
  return total;
}

export function computeHandTypeUpperBounds(m: PoolMultiset): Record<HandTypeString, number> {
  const ranksSorted = [...m.rankCounts.keys()].sort((a, b) => a - b);
  const { windows: straightWindows, bestMinInWindow } = straightWindowStats(m.rankCounts, ranksSorted);
  const pairs = countDisjointPairs(m.rankCounts);
  const triples = [...m.rankCounts.values()].reduce((a, c) => a + Math.floor(c / 3), 0);
  const quads = [...m.rankCounts.values()].reduce((a, c) => a + Math.floor(c / 4), 0);
  const flushes = countFlushFiveUpperBound(m.suitCounts);
  const straightFlush = maxStraightFlushUpperBound(m);
  const royalFlush = maxRoyalFlushUpperBound(m);

  const out = Object.fromEntries(HAND_TYPES.map((h) => [h, 0])) as Record<HandTypeString, number>;
  out.HighCard = Math.floor(m.totalCards / 5);
  out.Pair = pairs;
  out.TwoPair = Math.floor(pairs / 2);
  out.ThreeOfAKind = triples;
  out.Straight = straightWindows > 0 ? bestMinInWindow : 0;
  out.Flush = flushes;
  out.FullHouse = Math.min(triples, pairs);
  out.FourOfAKind = quads;
  out.StraightFlush = straightFlush;
  out.RoyalFlush = royalFlush;
  return out;
}

/** 牌型目标相对给定牌集合的必要条件（不满足则不可能完成）；多目标叠加未做全局运筹，仅逐条检查 */
export function objectiveReachabilityMessages(
  level: LevelConfigData,
  m: PoolMultiset,
  sourceLabel: "棋盘预览" | "花色池配置" = "棋盘预览",
): { severity: "error" | "warning"; message: string }[] {
  const out: { severity: "error" | "warning"; message: string }[] = [];
  const { rankCounts, suitCounts, totalCards } = m;
  const ranksSorted = [...rankCounts.keys()].sort((a, b) => a - b);
  const { windows: straightWinCount, bestMinInWindow } = straightWindowStats(rankCounts, ranksSorted);
  const pairs = countDisjointPairs(rankCounts);
  const flushes = countFlushFiveUpperBound(suitCounts);
  const upper = computeHandTypeUpperBounds(m);
  const triples = upper.ThreeOfAKind;
  const quads = upper.FourOfAKind;

  const needsObjective =
    level.WinConditionMode === LevelWinConditionMode.ObjectivesOnly ||
    level.WinConditionMode === LevelWinConditionMode.ScoreAndObjectives ||
    level.WinConditionMode === LevelWinConditionMode.ScoreOrObjectives;
  const strict = !!level.StrictBlockOnUnreachable;

  for (let i = 0; i < (level.Objectives ?? []).length; i++) {
    const o = level.Objectives[i];
    if (!o || o.Count <= 0) {
      continue;
    }
    const c = o.Count;
    if (!isValidHandType(o.HandType)) {
      continue;
    }
    const ht = o.HandType;
    const tag = `目标[${i + 1}] ${ht}×${c}`;

    switch (ht) {
      case "HighCard":
        if (totalCards < 1) {
          out.push({ severity: "error", message: `${tag}：${sourceLabel}中无可用普通牌。` });
        }
        break;
      case "Pair":
        if (pairs < c) {
          out.push({
            severity: needsObjective || strict ? "error" : "warning",
            message: `${tag}：${sourceLabel}中理论最多约 ${pairs} 个对子（按秩计不相交上界），不足以完成 ${c} 次。`,
          });
        }
        break;
      case "TwoPair":
        if (pairs < 2 * c) {
          out.push({
            severity: needsObjective || strict ? "error" : "warning",
            message: `${tag}：两对至少需要约 ${2 * c} 个「对子位」，当前上界约 ${pairs}。`,
          });
        }
        break;
      case "ThreeOfAKind":
        if (triples < c) {
          out.push({
            severity: needsObjective || strict ? "error" : "warning",
            message: `${tag}：三条次数上界约 ${triples}，不足以 ${c} 次。`,
          });
        }
        break;
      case "Straight":
        if (straightWinCount === 0) {
          out.push({
            severity: needsObjective || strict ? "error" : "warning",
            message: `${tag}：${sourceLabel}中无连续 5 个秩，无法组成顺子。`,
          });
        } else if (bestMinInWindow < c) {
          out.push({
            severity: "warning",
            message: `${tag}：最佳连续五秩窗口内各秩张数最小值约 ${bestMinInWindow}，可能不足以稳定完成 ${c} 条顺子（未计牌面消耗与多目标抢牌）。`,
          });
        }
        break;
      case "Flush":
        if (flushes < c) {
          out.push({
            severity: needsObjective || strict ? "error" : "warning",
            message: `${tag}：同花五张次数上界约 ${flushes}（各花色 floor(n/5) 之和），不足以 ${c} 次。`,
          });
        }
        break;
      case "FullHouse":
        if (triples < c || pairs < c) {
          out.push({
            severity: "warning",
            message: `${tag}：葫芦需同时满足「三条×${c}」与「对子资源」；当前三条上界 ${triples}、对子上界 ${pairs}，请人工核对是否可达（本条为宽松必要条件）。`,
          });
        }
        break;
      case "FourOfAKind":
        if (quads < c) {
          out.push({
            severity: needsObjective || strict ? "error" : "warning",
            message: `${tag}：四条次数上界约 ${quads}，不足以 ${c} 次。`,
          });
        }
        break;
      case "StraightFlush":
      case "RoyalFlush": {
        const royal = ht === "RoyalFlush";
        const maxSf = royal ? upper.RoyalFlush : upper.StraightFlush;
        if (maxSf < c) {
          out.push({
            severity: needsObjective || strict ? "error" : "warning",
            message: `${tag}：在当前牌集合下，同花顺可完成次数上界约 ${maxSf}（${royal ? "仅 10–A 同花" : "某花色连续五秩"}），不足以 ${c} 次。`,
          });
        }
        break;
      }
      default:
        break;
    }
  }

  return out;
}
