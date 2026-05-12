import { useCallback, useMemo, useState } from "react";
import { computeVisibleRatios } from "../board/boardClickability";
import { SOURCE_CARD_HEIGHT, SOURCE_CARD_WIDTH } from "../board/boardConstants";
import { LevelWinConditionMode, RANK_MAX, RANK_MIN, SUIT_CODES } from "../domain/enums";
import type { LevelConfigData, LevelBoardSlotData } from "../domain/levelTypes";
import { createGridSlots } from "../board/boardLayoutFactory";

type HandType =
  | "HighCard"
  | "Pair"
  | "TwoPair"
  | "ThreeOfAKind"
  | "Straight"
  | "Flush"
  | "FullHouse"
  | "FourOfAKind"
  | "StraightFlush"
  | "RoyalFlush";

const HAND_MULTIPLIER: Record<HandType, number> = {
  HighCard: 1,
  Pair: 2,
  TwoPair: 2,
  ThreeOfAKind: 3,
  Straight: 4,
  Flush: 5,
  FullHouse: 6,
  FourOfAKind: 7,
  StraightFlush: 8,
  RoyalFlush: 9,
};

type PreviewCard = {
  id: string;
  x: number;
  y: number;
  layer: number;
  kind: "normal" | "jokerWild" | "jokerMultiplier" | "jokerSuit";
  suit: string;
  rank: number;
  isFixed: boolean;
  removed: boolean;
};

type RoundInfo = {
  handType: HandType;
  sum: number;
  multiplier: number;
  score: number;
};

interface Props {
  level: LevelConfigData;
  onClose: () => void;
}

type EliminateRange = "all" | "clickable" | "locked";

function rankLabel(rank: number): string {
  if (rank <= 10) {
    return String(rank);
  }
  if (rank === 11) {
    return "J";
  }
  if (rank === 12) {
    return "Q";
  }
  if (rank === 13) {
    return "K";
  }
  return "A";
}

function publicAssetPath(path: string): string {
  if (typeof window !== "undefined" && window.location.protocol === "file:") {
    const normalizedPath = window.location.pathname.replace(/\\/g, "/").toLowerCase();
    if (!normalizedPath.includes("/docs/")) {
      return `./docs/${path}`;
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const base = (import.meta as any).env?.BASE_URL ?? "./";
  return `${base}${path}`;
}

const SUIT_FILE_PREFIX: Record<string, string> = { H: "hearts", D: "diamonds", C: "clubs", S: "spades" };
function cardSpriteHref(card: PreviewCard): string | null {
  if (card.kind === "jokerWild") return publicAssetPath("sprites/cards/wild.png");
  if (card.kind === "jokerMultiplier") return publicAssetPath("sprites/cards/multiplier.png");
  if (card.kind === "jokerSuit") return publicAssetPath("sprites/cards/suit.png");
  if (card.kind !== "normal" || card.rank < RANK_MIN || card.rank > RANK_MAX) return null;
  const prefix = SUIT_FILE_PREFIX[card.suit];
  if (!prefix) return null;
  const rank =
    card.rank <= 10 ? String(card.rank) : card.rank === 11 ? "j" : card.rank === 12 ? "q" : card.rank === 13 ? "k" : "a";
  return publicAssetPath(`sprites/cards/${prefix}_${rank}.png`);
}

function buildDeck(level: LevelConfigData): Array<{ suit: string; rank: number }> {
  const suits = [...new Set(level.PoolSuits.map(String))].filter((s) => ["H", "D", "C", "S"].includes(s));
  const ranks = [...new Set(level.PoolRanks.map((r) => Math.trunc(r)))].filter((r) => r >= RANK_MIN && r <= RANK_MAX);
  const deck: Array<{ suit: string; rank: number }> = [];
  for (const s of suits) {
    for (const r of ranks) {
      deck.push({ suit: s, rank: r });
    }
  }
  return deck;
}

function makeRng(seed: number): () => number {
  let a = (seed >>> 0) || 0x9e3779b9;
  return () => {
    let t = (a += 0x6d2b79f5) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickRandom<T>(arr: T[], rnd: () => number): T {
  const i = Math.floor(rnd() * arr.length);
  return arr[Math.max(0, Math.min(arr.length - 1, i))];
}

function buildInitialCards(level: LevelConfigData): PreviewCard[] {
  const rnd = makeRng(level.Seed);
  const layout = level.BoardLayout.length > 0 ? level.BoardLayout : createGridSlots(level.TotalCards);
  const deck = buildDeck(level);
  const fixedUsed = new Set<string>();
  for (const s of layout) {
    if (s.Suit !== "N" && s.Rank >= RANK_MIN && s.Rank <= RANK_MAX) {
      fixedUsed.add(`${s.Suit}${s.Rank}`);
    }
  }
  let available = deck.filter((c) => !fixedUsed.has(`${c.suit}${c.rank}`));
  const cards: PreviewCard[] = [];
  for (let i = 0; i < layout.length; i++) {
    const s = layout[i];
    let suit = s.Suit;
    let rank = s.Rank;
    if (!(suit !== "N" && rank >= RANK_MIN && rank <= RANK_MAX)) {
      if (available.length === 0 && deck.length > 0) {
        // Non-single-deck fallback allows reuse.
        const c = pickRandom(deck, rnd);
        suit = c.suit;
        rank = c.rank;
      } else if (available.length > 0) {
        const idx = Math.floor(rnd() * available.length);
        const c = available[Math.max(0, Math.min(available.length - 1, idx))];
        suit = c.suit;
        rank = c.rank;
        if (level.IsSingleDeck) {
          available.splice(Math.max(0, Math.min(available.length - 1, idx)), 1);
        }
      } else {
        suit = "H";
        rank = 2;
      }
    }
    cards.push({
      id: `c${i}`,
      x: s.X,
      y: s.Y,
      layer: s.Layer,
      kind: "normal",
      suit,
      rank,
      isFixed: s.Suit !== "N" && s.Rank >= RANK_MIN && s.Rank <= RANK_MAX,
      removed: false,
    });
  }
  // Apply manual special placement from BoardLayout.Special (replaces that slot's card).
  for (let i = 0; i < layout.length && i < cards.length; i++) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sp = (layout[i] as any)?.Special as string | undefined;
    if (!sp) continue;
    if (sp === "Wild") cards[i] = { ...cards[i], kind: "jokerWild", suit: "N", rank: 0 };
    else if (sp === "Multiplier") cards[i] = { ...cards[i], kind: "jokerMultiplier", suit: "N", rank: 0 };
    else if (sp === "SuitH") cards[i] = { ...cards[i], kind: "jokerSuit", suit: "H", rank: 0 };
    else if (sp === "SuitD") cards[i] = { ...cards[i], kind: "jokerSuit", suit: "D", rank: 0 };
    else if (sp === "SuitC") cards[i] = { ...cards[i], kind: "jokerSuit", suit: "C", rank: 0 };
    else if (sp === "SuitS") cards[i] = { ...cards[i], kind: "jokerSuit", suit: "S", rank: 0 };
  }
  // Replace some normals with jokers at start (deterministic).
  const candidates = cards.filter((c) => c.kind === "normal");
  const replacePick = (n: number): PreviewCard[] => {
    const pool = [...candidates];
    const out: PreviewCard[] = [];
    for (let i = 0; i < n && pool.length > 0; i++) {
      const idx = Math.floor(rnd() * pool.length);
      out.push(pool.splice(Math.max(0, Math.min(pool.length - 1, idx)), 1)[0]);
    }
    return out;
  };
  const placedWild = layout.filter((s) => (s as any)?.Special === "Wild").length;
  const placedMult = layout.filter((s) => (s as any)?.Special === "Multiplier").length;
  const placedSuit = layout.filter((s) => typeof (s as any)?.Special === "string" && String((s as any).Special).startsWith("Suit")).length;
  const needWild = Math.max(0, level.SpecialWild - placedWild);
  const needMult = Math.max(0, level.SpecialMultiplier - placedMult);
  const needSuit = Math.max(0, level.SpecialSuit - placedSuit);

  for (const c of replacePick(needWild)) {
    const idx = cards.findIndex((x) => x.id === c.id);
    if (idx >= 0) cards[idx] = { ...cards[idx], kind: "jokerWild", suit: "N", rank: 0 };
  }
  for (const c of replacePick(needMult)) {
    const idx = cards.findIndex((x) => x.id === c.id);
    if (idx >= 0) cards[idx] = { ...cards[idx], kind: "jokerMultiplier", suit: "N", rank: 0 };
  }
  for (const c of replacePick(needSuit)) {
    const idx = cards.findIndex((x) => x.id === c.id);
    if (idx >= 0) {
      const suit = pickRandom([...SUIT_CODES], rnd);
      cards[idx] = { ...cards[idx], kind: "jokerSuit", suit, rank: 0 };
    }
  }
  return cards;
}

function evaluateHandWithJokers(cards: PreviewCard[]): { handType: HandType; sum: number; multiplierBonus: number } {
  const jokersMult = cards.filter((c) => c.kind === "jokerMultiplier").length;
  const suitJokers = cards
    .filter((c) => c.kind === "jokerSuit")
    .map((c) => c.suit)
    .filter((s) => ["H", "D", "C", "S"].includes(s));
  const forcedSuits = suitJokers.length ? Array.from(new Set(suitJokers)) : [null];
  const fixed = cards.filter((c) => c.kind === "normal").map((c) => ({ suit: c.suit, rank: c.rank }));
  const jokerCount = cards.length - fixed.length;

  const bestForContext = (forcedSuit: string | null): { handType: HandType; sum: number } => {
    const fixedSuits = forcedSuit ? fixed.map(() => forcedSuit) : fixed.map((c) => c.suit);
    const fixedRanks = fixed.map((c) => c.rank);
    const fixedRankCounts = new Map<number, number>();
    for (const r of fixedRanks) fixedRankCounts.set(r, (fixedRankCounts.get(r) ?? 0) + 1);

    const allSameSuitPossible = forcedSuit ? true : new Set(fixedSuits.filter((s) => s && s !== "N")).size <= 1;
    const fixedDuplicates = [...fixedRankCounts.values()].some((c) => c > 1);

    const tryRoyal = (): { ok: boolean; sum: number } => {
      if (!allSameSuitPossible) return { ok: false, sum: 0 };
      const need = [10, 11, 12, 13, 14];
      let missing = 0;
      for (const r of need) if (!fixedRankCounts.has(r)) missing++;
      if (missing > jokerCount) return { ok: false, sum: 0 };
      return { ok: true, sum: 60 };
    };

    const bestStraightSum = (): number => {
      if (fixedDuplicates) return 0;
      const fixedSet = new Set(fixedRanks);
      let best = 0;
      for (let start = 2; start <= 10; start++) {
        const seq = [start, start + 1, start + 2, start + 3, start + 4];
        let ok = true;
        for (const r of fixedSet) if (!seq.includes(r)) ok = false;
        if (!ok) continue;
        const missing = seq.filter((r) => !fixedSet.has(r)).length;
        if (missing > jokerCount) continue;
        const sum = seq.reduce((a, b) => a + b, 0);
        best = Math.max(best, sum);
      }
      return best;
    };

    const bestStraightFlushSum = (): number => (allSameSuitPossible ? bestStraightSum() : 0);

    const bestOfAKind = (n: 2 | 3 | 4): { ok: boolean; sum: number } => {
      let best = 0;
      for (let r = 14; r >= 2; r--) {
        const have = fixedRankCounts.get(r) ?? 0;
        const need = Math.max(0, n - have);
        if (need > jokerCount) continue;
        const leftJokers = jokerCount - need;
        const kickers = fixedRanks.filter((fr) => fr !== r).sort((a, b) => b - a);
        while (kickers.length < 5 - n && leftJokers - (5 - n - kickers.length) >= 0) kickers.push(14);
        const kickerSum = kickers.slice(0, 5 - n).reduce((a, b) => a + b, 0);
        best = Math.max(best, n * r + kickerSum);
      }
      return { ok: best > 0, sum: best };
    };

    const bestFullHouse = (): { ok: boolean; sum: number } => {
      let best = 0;
      for (let triple = 14; triple >= 2; triple--) {
        for (let pair = 14; pair >= 2; pair--) {
          if (pair === triple) continue;
          const haveT = fixedRankCounts.get(triple) ?? 0;
          const haveP = fixedRankCounts.get(pair) ?? 0;
          const need = Math.max(0, 3 - haveT) + Math.max(0, 2 - haveP);
          if (need > jokerCount) continue;
          best = Math.max(best, triple * 3 + pair * 2);
        }
      }
      return { ok: best > 0, sum: best };
    };

    const bestFlush = (): { ok: boolean; sum: number } => {
      if (!allSameSuitPossible) return { ok: false, sum: 0 };
      const ranks = [...fixedRanks].sort((a, b) => b - a);
      const need = Math.max(0, 5 - ranks.length);
      if (need > jokerCount) return { ok: false, sum: 0 };
      while (ranks.length < 5) ranks.push(14);
      return { ok: true, sum: ranks.slice(0, 5).reduce((a, b) => a + b, 0) };
    };

    const bestTwoPair = (): { ok: boolean; sum: number } => {
      let best = 0;
      for (let a = 14; a >= 2; a--) {
        for (let b = a - 1; b >= 2; b--) {
          const haveA = fixedRankCounts.get(a) ?? 0;
          const haveB = fixedRankCounts.get(b) ?? 0;
          const need = Math.max(0, 2 - haveA) + Math.max(0, 2 - haveB);
          if (need > jokerCount) continue;
          const left = jokerCount - need;
          const kickers = fixedRanks.filter((r) => r !== a && r !== b).sort((x, y) => y - x);
          const kicker = kickers[0] ?? (left > 0 ? 14 : 2);
          best = Math.max(best, a * 2 + b * 2 + kicker);
        }
      }
      return { ok: best > 0, sum: best };
    };

    const bestPair = (): { ok: boolean; sum: number } => {
      let best = 0;
      for (let r = 14; r >= 2; r--) {
        const have = fixedRankCounts.get(r) ?? 0;
        const need = Math.max(0, 2 - have);
        if (need > jokerCount) continue;
        const left = jokerCount - need;
        const rest = fixedRanks.filter((x) => x !== r).sort((a, b) => b - a);
        while (rest.length < 3 && left - (3 - rest.length) >= 0) rest.push(14);
        best = Math.max(best, r * 2 + rest.slice(0, 3).reduce((a, b) => a + b, 0));
      }
      return { ok: best > 0, sum: best };
    };

    const high = (): { sum: number } => {
      const r = [...fixedRanks].sort((a, b) => b - a);
      const need = Math.max(0, 5 - r.length);
      if (need <= jokerCount) while (r.length < 5) r.push(14);
      return { sum: r.slice(0, 5).reduce((a, b) => a + b, 0) };
    };

    const rf = tryRoyal();
    if (rf.ok) return { handType: "RoyalFlush", sum: rf.sum };
    const sfSum = bestStraightFlushSum();
    if (sfSum > 0) return { handType: "StraightFlush", sum: sfSum };
    const fk = bestOfAKind(4);
    if (fk.ok) return { handType: "FourOfAKind", sum: fk.sum };
    const fh = bestFullHouse();
    if (fh.ok) return { handType: "FullHouse", sum: fh.sum };
    const fl = bestFlush();
    if (fl.ok) return { handType: "Flush", sum: fl.sum };
    const stSum = bestStraightSum();
    if (stSum > 0) return { handType: "Straight", sum: stSum };
    const tk = bestOfAKind(3);
    if (tk.ok) return { handType: "ThreeOfAKind", sum: tk.sum };
    const tp = bestTwoPair();
    if (tp.ok) return { handType: "TwoPair", sum: tp.sum };
    const pr = bestPair();
    if (pr.ok) return { handType: "Pair", sum: pr.sum };
    return { handType: "HighCard", sum: high().sum };
  };

  let best: { handType: HandType; sum: number; mult: number } | null = null;
  for (const forced of forcedSuits) {
    const r = bestForContext(forced);
    const mult = HAND_MULTIPLIER[r.handType] + jokersMult;
    const score = r.sum * mult;
    if (!best) {
      best = { ...r, mult };
      continue;
    }
    const bestScore = best.sum * best.mult;
    if (score > bestScore || (score === bestScore && r.sum > best.sum)) {
      best = { ...r, mult };
    }
  }
  return { handType: best!.handType, sum: best!.sum, multiplierBonus: jokersMult };
}

function computeBounds(cards: PreviewCard[]): { minX: number; maxX: number; minY: number; maxY: number } {
  if (!cards.length) {
    return { minX: -100, maxX: 100, minY: -100, maxY: 100 };
  }
  const hw = SOURCE_CARD_WIDTH / 2;
  const hh = SOURCE_CARD_HEIGHT / 2;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const c of cards) {
    minX = Math.min(minX, c.x - hw);
    maxX = Math.max(maxX, c.x + hw);
    minY = Math.min(minY, c.y - hh);
    maxY = Math.max(maxY, c.y + hh);
  }
  const pad = 40;
  return { minX: minX - pad, maxX: maxX + pad, minY: minY - pad, maxY: maxY + pad };
}

export function LevelPreviewPage({ level, onClose }: Props) {
  const [initialCards] = useState<PreviewCard[]>(() => buildInitialCards(level));
  const [cards, setCards] = useState<PreviewCard[]>(() => buildInitialCards(level));
  const [handIds, setHandIds] = useState<string[]>([]);
  const [rounds, setRounds] = useState<RoundInfo[]>([]);
  const [score, setScore] = useState(0);
  const [lastHandType, setLastHandType] = useState<HandType | null>(null);
  const [status, setStatus] = useState<"running" | "win" | "fail">("running");
  const [eliminateRange, setEliminateRange] = useState<EliminateRange>("all");
  const [objectiveCounts, setObjectiveCounts] = useState<Record<string, number>>({});
  const [itemStorageLeft, setItemStorageLeft] = useState(() => Math.max(0, level.ItemStorage));
  const [itemShuffleLeft, setItemShuffleLeft] = useState(() => Math.max(0, level.ItemShuffle));
  const [itemAddWildLeft, setItemAddWildLeft] = useState(() => Math.max(0, level.ItemAddWild));
  const [storedCard, setStoredCard] = useState<PreviewCard | null>(null);
  const [storageMode, setStorageMode] = useState<"idle" | "pick">("idle");
  const [shuffleCount, setShuffleCount] = useState(0);
  const [addWildCount, setAddWildCount] = useState(0);

  const activeCards = useMemo(() => cards.filter((c) => !c.removed), [cards]);
  const activeCardsForDraw = useMemo(
    () =>
      [...activeCards].sort((a, b) => {
        if (a.layer !== b.layer) {
          return a.layer - b.layer;
        }
        const ai = Number.parseInt(a.id.replace(/\D+/g, ""), 10);
        const bi = Number.parseInt(b.id.replace(/\D+/g, ""), 10);
        const ao = Number.isFinite(ai) ? ai : 1_000_000;
        const bo = Number.isFinite(bi) ? bi : 1_000_000;
        return ao - bo;
      }),
    [activeCards],
  );
  const visibleRatios = useMemo(
    () => computeVisibleRatios(activeCards.map((c) => ({ X: c.x, Y: c.y, Layer: c.layer, Suit: "N", Rank: 0 } as LevelBoardSlotData))),
    [activeCards],
  );
  const clickable = useMemo(() => new Set(activeCards.filter((_, i) => visibleRatios[i]?.clickable).map((c) => c.id)), [activeCards, visibleRatios]);

  const handCards = useMemo(() => handIds.map((id) => cards.find((c) => c.id === id)).filter(Boolean) as PreviewCard[], [handIds, cards]);
  const vb = useMemo(() => {
    const b = computeBounds(initialCards);
    const w = Math.max(160, b.maxX - b.minX);
    const h = Math.max(160, b.maxY - b.minY);
    return `${b.minX} ${b.minY} ${w} ${h}`;
  }, [initialCards]);

  const remaining = activeCards.length;

  const onRestart = useCallback(() => {
    setCards(initialCards.map((c) => ({ ...c })));
    setHandIds([]);
    setRounds([]);
    setScore(0);
    setLastHandType(null);
    setStatus("running");
    setObjectiveCounts({});
    setEliminateRange("all");
    setItemStorageLeft(Math.max(0, level.ItemStorage));
    setItemShuffleLeft(Math.max(0, level.ItemShuffle));
    setItemAddWildLeft(Math.max(0, level.ItemAddWild));
    setStoredCard(null);
    setStorageMode("idle");
    setShuffleCount(0);
    setAddWildCount(0);
  }, [initialCards, level.ItemAddWild, level.ItemShuffle, level.ItemStorage]);

  const canUseItems = status === "running";
  const onUseStorage = useCallback(() => {
    if (!canUseItems) return;
    if (itemStorageLeft <= 0) return;
    if (storedCard) return;
    setStorageMode((m) => (m === "pick" ? "idle" : "pick"));
  }, [canUseItems, itemStorageLeft, storedCard]);

  const onReleaseStored = useCallback(() => {
    if (!canUseItems) return;
    if (!storedCard) return;
    if (handIds.length >= 5) return;
    setHandIds((h) => [...h, storedCard.id]);
    setStoredCard(null);
  }, [canUseItems, storedCard, handIds.length]);

  const onUseShuffle = useCallback(() => {
    if (!canUseItems) return;
    if (itemShuffleLeft <= 0) return;
    setItemShuffleLeft((n) => Math.max(0, n - 1));
    const nextCount = shuffleCount + 1;
    setShuffleCount(nextCount);
    const rnd = makeRng((level.Seed ^ 0x5147_2026 ^ nextCount) >>> 0);
    const remain = cards.filter((c) => !c.removed);
    const positions = remain.map((c) => ({ x: c.x, y: c.y, layer: c.layer }));
    for (let i = positions.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const tmp = positions[i];
      positions[i] = positions[j];
      positions[j] = tmp;
    }
    const updatedRemain = remain.map((c, i) => ({ ...c, x: positions[i].x, y: positions[i].y, layer: positions[i].layer }));
    const remainById = new Map(updatedRemain.map((c) => [c.id, c]));
    setCards((prev) => prev.map((c) => remainById.get(c.id) ?? c));
  }, [canUseItems, itemShuffleLeft, level.Seed, shuffleCount, cards]);

  const onUseAddWild = useCallback(() => {
    if (!canUseItems) return;
    if (itemAddWildLeft <= 0) return;
    if (handIds.length >= 5) return;
    setItemAddWildLeft((n) => Math.max(0, n - 1));
    const nextCount = addWildCount + 1;
    setAddWildCount(nextCount);
    const id = `bonusWild_${nextCount}`;
    const bonus: PreviewCard = { id, x: 0, y: 0, layer: 0, kind: "jokerWild", suit: "N", rank: 0, isFixed: false, removed: true };
    setCards((prev) => [...prev, bonus]);
    setHandIds((h) => [...h, id]);
  }, [canUseItems, itemAddWildLeft, handIds.length, addWildCount]);

  const objectives = useMemo(
    () => level.Objectives.filter((o) => o && o.Count > 0 && typeof o.HandType === "string"),
    [level.Objectives],
  );
  const needsObjectives =
    level.WinConditionMode === LevelWinConditionMode.ObjectivesOnly ||
    level.WinConditionMode === LevelWinConditionMode.ScoreAndObjectives ||
    level.WinConditionMode === LevelWinConditionMode.ScoreOrObjectives;
  const needsScore =
    level.WinConditionMode === LevelWinConditionMode.ScoreOnly ||
    level.WinConditionMode === LevelWinConditionMode.ScoreAndObjectives ||
    level.WinConditionMode === LevelWinConditionMode.ScoreOrObjectives;
  const isObjectivesMet = (counts: Record<string, number>) => objectives.every((o) => (counts[o.HandType] ?? 0) >= o.Count);

  const settleRound = (nextCards: PreviewCard[], picked: PreviewCard[]) => {
    const evalRes = evaluateHandWithJokers(picked);
    const mul = HAND_MULTIPLIER[evalRes.handType] + evalRes.multiplierBonus;
    const gained = evalRes.sum * mul;
    let total = score + gained;
    let after = [...nextCards];

    const pairStreakTrigger = evalRes.handType === "Pair" && lastHandType === "Pair";
    const eliminationRules = (level.RandomEliminationRules ?? []).filter((r) => r && r.Enabled && r.RemoveCount > 0);
    const shouldTrigger = (ruleTrigger: string): boolean => {
      if (ruleTrigger === "OnHighCard") return evalRes.handType === "HighCard";
      if (ruleTrigger === "OnPairStreak2") return pairStreakTrigger;
      return false;
    };
    const applyElimination = (removeCount: number, ruleRange: string, layers: number[], excludeFixed: boolean, excludeJokers: boolean, salt: number) => {
      const rnd = makeRng((level.Seed ^ (rounds.length + 1) ^ total ^ salt) >>> 0);
      const candidatesAll = after.filter((c) => !c.removed);
      let candidates = candidatesAll;
      if (ruleRange === "Clickable") candidates = candidates.filter((c) => clickable.has(c.id));
      else if (ruleRange === "Locked") candidates = candidates.filter((c) => !clickable.has(c.id));
      else if (ruleRange === "Layers") candidates = candidates.filter((c) => layers.includes(c.layer));
      if (excludeFixed) candidates = candidates.filter((c) => !c.isFixed);
      if (excludeJokers) candidates = candidates.filter((c) => c.kind === "normal");
      let removeN = Math.min(removeCount, candidates.length);
      while (removeN > 0 && candidates.length > 0) {
        const idx = Math.floor(rnd() * candidates.length);
        const c = candidates.splice(idx, 1)[0];
        after = after.map((x) => (x.id === c.id ? { ...x, removed: true } : x));
        removeN--;
      }
    };

    // Back-compat: if no rules configured, keep old behavior but use preview dropdown.
    if (eliminationRules.length === 0) {
      if (evalRes.handType === "HighCard" || pairStreakTrigger) {
        const rnd = makeRng((level.Seed ^ (rounds.length + 1) ^ total ^ 0x53a9) >>> 0);
        const candidatesAll = after.filter((c) => !c.removed);
        const candidates =
          eliminateRange === "all"
            ? candidatesAll
            : eliminateRange === "clickable"
              ? candidatesAll.filter((c) => clickable.has(c.id))
              : candidatesAll.filter((c) => !clickable.has(c.id));
        let removeN = Math.min(3, candidates.length);
        while (removeN > 0 && candidates.length > 0) {
          const idx = Math.floor(rnd() * candidates.length);
          const c = candidates.splice(idx, 1)[0];
          after = after.map((x) => (x.id === c.id ? { ...x, removed: true } : x));
          removeN--;
        }
      }
    } else {
      let applied = false;
      for (let i = 0; i < eliminationRules.length; i++) {
        const r = eliminationRules[i];
        if (!shouldTrigger(r.Trigger)) continue;
        applyElimination(r.RemoveCount, r.Range, r.Layers ?? [], !!r.ExcludeFixedCards, !!r.ExcludeJokers, 0x7000 + i * 31);
        applied = true;
      }
      // If multiple rules triggered, they stack (matches "系统"预期).
      void applied;
    }

    const remainAfter = after.filter((c) => !c.removed).length;
    let nextStatus: "running" | "win" | "fail" = "running";
    const nextObjCounts = { ...objectiveCounts, [evalRes.handType]: (objectiveCounts[evalRes.handType] ?? 0) + 1 };
    setObjectiveCounts(nextObjCounts);
    const scoreMet = !needsScore || total >= level.TargetScore;
    const objMet = !needsObjectives || isObjectivesMet(nextObjCounts);
    const winMode = level.WinConditionMode;
    const win =
      winMode === LevelWinConditionMode.ScoreOnly
        ? scoreMet
        : winMode === LevelWinConditionMode.ObjectivesOnly
          ? objMet
          : winMode === LevelWinConditionMode.ScoreAndObjectives
            ? scoreMet && objMet
            : scoreMet || objMet;
    if (win) {
      nextStatus = "win";
    } else if (remainAfter < 5) {
      nextStatus = "fail";
    }

    setCards(after);
    setRounds((r) => [...r, { handType: evalRes.handType, sum: evalRes.sum, multiplier: mul, score: gained }]);
    setScore(total);
    setLastHandType(evalRes.handType);
    setHandIds([]);
    setStatus(nextStatus);
  };

  const onPick = (id: string) => {
    if (status !== "running") {
      return;
    }
    if (!clickable.has(id)) {
      return;
    }
    if (handIds.includes(id)) {
      return;
    }
    const picked = cards.find((c) => c.id === id);
    if (!picked) {
      return;
    }
    if (storageMode === "pick") {
      if (storedCard) {
        setStorageMode("idle");
        return;
      }
      setItemStorageLeft((n) => Math.max(0, n - 1));
      setStoredCard({ ...picked, removed: true });
      setCards((prev) => prev.map((c) => (c.id === id ? { ...c, removed: true } : c)));
      setStorageMode("idle");
      return;
    }
    const nextCards = cards.map((c) => (c.id === id ? { ...c, removed: true } : c));
    const nextHand = [...handIds, id];
    if (nextHand.length < 5) {
      setCards(nextCards);
      setHandIds(nextHand);
      const remainOnBoard = nextCards.filter((c) => !c.removed).length;
      const availableForNextSettlement = remainOnBoard + nextHand.length;
      if (availableForNextSettlement < 5) {
        const needsObjectives =
          level.WinConditionMode === LevelWinConditionMode.ObjectivesOnly ||
          level.WinConditionMode === LevelWinConditionMode.ScoreAndObjectives ||
          level.WinConditionMode === LevelWinConditionMode.ScoreOrObjectives;
        const needsScore =
          level.WinConditionMode === LevelWinConditionMode.ScoreOnly ||
          level.WinConditionMode === LevelWinConditionMode.ScoreAndObjectives ||
          level.WinConditionMode === LevelWinConditionMode.ScoreOrObjectives;
        const objectives = level.Objectives.filter((o) => o && o.Count > 0 && typeof o.HandType === "string");
        const isObjectivesMet = (counts: Record<string, number>) => objectives.every((o) => (counts[o.HandType] ?? 0) >= o.Count);
        const scoreMet = !needsScore || score >= level.TargetScore;
        const objMet = !needsObjectives || isObjectivesMet(objectiveCounts);
        const winMode = level.WinConditionMode;
        const win =
          winMode === LevelWinConditionMode.ScoreOnly
            ? scoreMet
            : winMode === LevelWinConditionMode.ObjectivesOnly
              ? objMet
              : winMode === LevelWinConditionMode.ScoreAndObjectives
                ? scoreMet && objMet
                : scoreMet || objMet;
        if (!win) setStatus("fail");
      }
      return;
    }
    const pickedCards = nextHand.map((pid) => (pid === id ? picked : cards.find((c) => c.id === pid)!));
    settleRound(nextCards, pickedCards);
  };

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "var(--bg)" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 12, padding: 10, borderBottom: "1px solid var(--border)" }}>
        <button type="button" onClick={onClose}>
          返回编辑器
        </button>
        <strong>关卡预览模式</strong>
        <button type="button" onClick={onRestart}>
          重玩
        </button>
        <span>得分：{score}</span>
        <span>目标：{level.TargetScore}</span>
        <span>剩余牌：{remaining}</span>
        <button
          type="button"
          onClick={onUseStorage}
          disabled={!canUseItems || itemStorageLeft <= 0 || !!storedCard}
          title={storedCard ? "收容栏已占用" : storageMode === "pick" ? "点击一张可点击牌块进行收容" : "进入“选择一张牌暂存”模式"}
        >
          收容（{itemStorageLeft}）
        </button>
        <button type="button" onClick={onUseShuffle} disabled={!canUseItems || itemShuffleLeft <= 0} title="重排剩余牌块在模板中的位置">
          洗牌（{itemShuffleLeft}）
        </button>
        <button
          type="button"
          onClick={onUseAddWild}
          disabled={!canUseItems || itemAddWildLeft <= 0 || handIds.length >= 5}
          title="向收集栏下一个空位加入一张万能小丑"
        >
          万能小丑（{itemAddWildLeft}）
        </button>
        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
          随机消除范围
          <select value={eliminateRange} onChange={(e) => setEliminateRange(e.target.value as EliminateRange)}>
            <option value="all">全牌面</option>
            <option value="clickable">仅可点击</option>
            <option value="locked">仅不可点击</option>
          </select>
        </label>
        <span style={{ color: status === "win" ? "var(--ok)" : status === "fail" ? "var(--error)" : "var(--muted)" }}>
          {status === "running" ? "进行中" : status === "win" ? "已通关" : "失败"}
        </span>
      </header>
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <main style={{ flex: 1, padding: 10, minHeight: 0 }}>
          <div style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden", background: "#0a0d12", height: "100%" }}>
            <svg width="100%" height="100%" viewBox={vb}>
              {activeCardsForDraw.map((c) => {
                const rx = c.x - SOURCE_CARD_WIDTH / 2;
                const ry = c.y - SOURCE_CARD_HEIGHT / 2;
                const can = clickable.has(c.id);
                const href = cardSpriteHref(c);
                return (
                  <g key={c.id} transform={`translate(${rx},${ry})`} onClick={() => onPick(c.id)} style={{ cursor: can ? "pointer" : "default" }}>
                    <rect
                      width={SOURCE_CARD_WIDTH}
                      height={SOURCE_CARD_HEIGHT}
                      rx={4}
                      fill={can ? "#4b6fb8" : "#2b3448"}
                      stroke={can ? "var(--accent)" : "#444"}
                    />
                    {href ? (
                      <image
                        href={href}
                        width={SOURCE_CARD_WIDTH}
                        height={SOURCE_CARD_HEIGHT}
                        preserveAspectRatio="xMidYMid meet"
                        opacity={can ? 1 : 0.55}
                      />
                    ) : (
                      <text x={6} y={16} fontSize={11} fill="#fff">
                        {c.kind === "normal" ? `${c.suit}${rankLabel(c.rank)}` : c.kind}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>
        </main>
        <aside style={{ width: 340, borderLeft: "1px solid var(--border)", padding: 10, display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="panel">
            <div style={{ marginBottom: 6, fontWeight: 600 }}>收集栏（5）</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6 }}>
              {Array.from({ length: 5 }, (_, i) => {
                const c = handCards[i];
                return (
                  <div key={i} style={{ border: "1px solid var(--border)", borderRadius: 6, minHeight: 44, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {c ? (
                      (() => {
                        const href = cardSpriteHref(c);
                        return href ? <img src={href} alt="" style={{ width: 38, height: 60, objectFit: "contain" }} /> : `${c.suit}${rankLabel(c.rank)}`;
                      })()
                    ) : (
                      "-"
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          <div className="panel">
            <div style={{ marginBottom: 6, fontWeight: 600 }}>收容栏（点击打出）</div>
            <button
              type="button"
              onClick={onReleaseStored}
              disabled={!storedCard || handIds.length >= 5 || status !== "running"}
              style={{
                width: "100%",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: 8,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                background: "transparent",
              }}
              title={!storedCard ? "暂无收容牌" : handIds.length >= 5 ? "收集栏已满" : "点击将该牌打出到收集栏"}
            >
              {storedCard ? (
                (() => {
                  const href = cardSpriteHref(storedCard);
                  return href ? <img src={href} alt="" style={{ width: 38, height: 60, objectFit: "contain" }} /> : "已收容";
                })()
              ) : (
                <span style={{ color: "var(--muted)" }}>空</span>
              )}
            </button>
            {storageMode === "pick" ? (
              <div style={{ marginTop: 6, fontSize: 12, color: "var(--accent)" }}>已进入收容模式：点击一张“可点击”牌块进行暂存</div>
            ) : null}
          </div>
          {objectives.length ? (
            <div className="panel">
              <div style={{ marginBottom: 6, fontWeight: 600 }}>特殊目标进度</div>
              <div style={{ display: "grid", gap: 4, fontSize: 12 }}>
                {objectives.map((o, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                    <span>{o.HandType}</span>
                    <span>
                      {(objectiveCounts[o.HandType] ?? 0)}/{o.Count}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          <div className="panel" style={{ overflow: "auto", flex: 1 }}>
            <div style={{ marginBottom: 6, fontWeight: 600 }}>结算记录</div>
            {rounds.length === 0 ? (
              <div style={{ color: "var(--muted)" }}>暂无</div>
            ) : (
              rounds.map((r, i) => (
                <div key={i} style={{ fontSize: 12, borderBottom: "1px solid var(--border)", padding: "6px 0" }}>
                  R{i + 1}: {r.handType} | {r.sum} x {r.multiplier} = <strong>{r.score}</strong>
                </div>
              ))
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
