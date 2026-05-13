import { RANK_MAX, RANK_MIN, SUIT_CODES } from "./enums";
import { mixEffectiveSeed } from "./levelFingerprint";
import type { LevelBoardSlotData } from "./levelTypes";

/**
 * Versioned salts for deterministic board randomization (no replacement within
 * the Cartesian product of pool suits × pool ranks).
 */
const SALT_BOARD_SLOT_SUITS = "LevelEditorWeb.boardSlotRandom.v2.suitsUnique";
const SALT_BOARD_SLOT_RANKS = "LevelEditorWeb.boardSlotRandom.v2.ranksUnique";
const SALT_BOARD_BOTH_DECK = "LevelEditorWeb.boardSlotRandom.v2.bothDeckShuffle";

export type BoardRandomResult =
  | { ok: true; layout: LevelBoardSlotData[] }
  | { ok: false; message: string };

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    let t = (a += 0x6d2b79f5) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createRng(seed: number, levelFingerprint: number, salt: string): () => number {
  return mulberry32(mixEffectiveSeed(seed, levelFingerprint, salt));
}

function pickIndex(rnd: () => number, len: number): number {
  if (len <= 0) {
    return 0;
  }
  return Math.min(len - 1, Math.floor(rnd() * len));
}

function shuffleInPlace<T>(arr: T[], rnd: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function shuffleIndices(n: number, rnd: () => number): number[] {
  const arr = Array.from({ length: n }, (_, i) => i);
  shuffleInPlace(arr, rnd);
  return arr;
}

const SUIT_SET = new Set<string>(SUIT_CODES);

function filterPoolSuits(poolSuits: readonly string[]): string[] {
  return poolSuits.filter((s) => SUIT_SET.has(s));
}

function filterPoolRanks(poolRanks: readonly number[]): number[] {
  return [...poolRanks].filter((r) => r >= RANK_MIN && r <= RANK_MAX).sort((a, b) => a - b);
}

/** 花色池 × 点数池 的全部不重复实体牌（最多 52 张）。 */
export function buildCartesianDeck(
  poolSuits: readonly string[],
  poolRanks: readonly number[],
): { suit: string; rank: number }[] {
  const suits = filterPoolSuits(poolSuits);
  const ranks = filterPoolRanks(poolRanks);
  const deck: { suit: string; rank: number }[] = [];
  for (const suit of suits) {
    for (const rank of ranks) {
      deck.push({ suit, rank });
    }
  }
  return deck;
}

/**
 * 随机槽位花色与点数：从牌堆无放回依次发到各槽位（槽位顺序不变），保证不出现重复实体牌。
 */
export function randomizeBoardLayoutSlotSuitsAndRanks(
  seed: number,
  levelFingerprint: number,
  layout: LevelBoardSlotData[],
  poolSuits: readonly string[],
  poolRanks: readonly number[],
): BoardRandomResult {
  if (layout.length === 0) {
    return { ok: false, message: "没有棋盘槽位。" };
  }
  const deck = buildCartesianDeck(poolSuits, poolRanks);
  if (deck.length === 0) {
    return { ok: false, message: "花色池或点数池为空，无法发牌。" };
  }
  if (layout.length > deck.length) {
    return {
      ok: false,
      message: `槽位数（${layout.length}）超过不重复可用牌数（${deck.length}）。请减少槽位或扩大花色/点数池（全池最多 52 张）。`,
    };
  }
  const rnd = createRng(seed, levelFingerprint, SALT_BOARD_BOTH_DECK);
  const pile = [...deck];
  shuffleInPlace(pile, rnd);
  const next = layout.map((slot, i) => ({
    ...slot,
    Suit: pile[i].suit,
    Rank: pile[i].rank,
  }));
  return { ok: true, layout: next };
}

/**
 * 只随机花色：保持各槽 Rank，在花色池内为每张牌选花色，且全体 (Suit,Rank) 不重复。
 * 未固定槽位（Suit 为 N 且 Rank 为 0）保持不变。
 */
export function randomizeBoardLayoutSlotSuits(
  seed: number,
  levelFingerprint: number,
  layout: LevelBoardSlotData[],
  poolSuits: readonly string[],
): BoardRandomResult {
  const suits = filterPoolSuits(poolSuits);
  if (layout.length === 0) {
    return { ok: false, message: "没有棋盘槽位。" };
  }
  if (suits.length === 0) {
    return { ok: false, message: "花色池为空。" };
  }
  const rnd = createRng(seed, levelFingerprint, SALT_BOARD_SLOT_SUITS);
  const order = shuffleIndices(layout.length, rnd);
  const used = new Set<string>();
  const next = layout.map((s) => ({ ...s }));

  for (const idx of order) {
    const slot = layout[idx];
    if (slot.Suit === "N" && slot.Rank === 0) {
      continue;
    }
    const r = slot.Rank;
    if (r < RANK_MIN || r > RANK_MAX) {
      continue;
    }
    const available = suits.filter((s) => !used.has(`${s}${r}`));
    if (available.length === 0) {
      return {
        ok: false,
        message:
          "无法在「每张实体牌只用一次」规则下为所有槽位分配花色（例如：相同点数的槽位数多于花色池中的花色数）。可调大花色池或减少同点重复。",
      };
    }
    const pick = available[pickIndex(rnd, available.length)];
    used.add(`${pick}${r}`);
    next[idx] = { ...next[idx], Suit: pick };
  }
  return { ok: true, layout: next };
}

/**
 * 只随机点数：保持各槽 Suit（须为 H/D/C/S），在点数池内选 Rank，且全体 (Suit,Rank) 不重复。
 * Suit 为 N 的槽位跳过。
 */
export function randomizeBoardLayoutSlotRanks(
  seed: number,
  levelFingerprint: number,
  layout: LevelBoardSlotData[],
  poolRanks: readonly number[],
): BoardRandomResult {
  const ranks = filterPoolRanks(poolRanks);
  if (layout.length === 0) {
    return { ok: false, message: "没有棋盘槽位。" };
  }
  if (ranks.length === 0) {
    return { ok: false, message: "点数池为空。" };
  }
  const rnd = createRng(seed, levelFingerprint, SALT_BOARD_SLOT_RANKS);
  const order = shuffleIndices(layout.length, rnd);
  const used = new Set<string>();
  const next = layout.map((s) => ({ ...s }));

  for (const idx of order) {
    const slot = layout[idx];
    const suit = slot.Suit;
    if (!SUIT_SET.has(suit)) {
      continue;
    }
    const available = ranks.filter((r) => !used.has(`${suit}${r}`));
    if (available.length === 0) {
      return {
        ok: false,
        message:
          "无法在「每张实体牌只用一次」规则下为所有槽位分配点数（例如：相同花色的槽位数多于点数池中的点数种数）。可调大点数池或减少同花槽位。",
      };
    }
    const pick = available[pickIndex(rnd, available.length)];
    used.add(`${suit}${pick}`);
    next[idx] = { ...next[idx], Rank: pick };
  }
  return { ok: true, layout: next };
}

export function generateUniqueLevelSeed(): number {
  const buf = new Uint32Array(2);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(buf);
  } else {
    buf[0] = (Math.random() * 0xffffffff) >>> 0;
    buf[1] = (Date.now() & 0xffffffff) >>> 0;
  }
  let s = (buf[0] ^ buf[1] ^ (Math.imul(buf[0], buf[1]) >>> 0)) >>> 0;
  if (s === 0) {
    s = 0x9e3779b9;
  }
  return s;
}
