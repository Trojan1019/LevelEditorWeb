import type { LevelWinConditionMode } from "./enums";
import type { BoardSuitCode, SuitCode } from "./enums";

/** Matches TrojanGame.Gameplay.LevelBoardSlotData */
export interface LevelBoardSlotData {
  X: number;
  Y: number;
  Layer: number;
  Suit: BoardSuitCode | string;
  Rank: number;
  /** Special card replacement for this slot (editor-only; runtime may ignore). */
  Special?: "" | "Wild" | "Multiplier" | "SuitH" | "SuitD" | "SuitC" | "SuitS";
}

/** Matches TrojanGame.Gameplay.LevelObjectiveData */
export interface LevelObjectiveData {
  HandType: string;
  Count: number;
  Reward: number;
}

export type RandomEliminationTrigger = "OnHighCard" | "OnPairStreak2";
export type RandomEliminationRange = "All" | "Clickable" | "Locked" | "Layers";

export interface RandomEliminationRule {
  Enabled: boolean;
  Trigger: RandomEliminationTrigger;
  RemoveCount: number;
  Range: RandomEliminationRange;
  Layers: number[];
  ExcludeFixedCards: boolean;
  ExcludeJokers: boolean;
}

export interface BoardSafeAreaConfig {
  Left: number;
  Right: number;
  Top: number;
  Bottom: number;
  SoftInset: number;
}

/** Mirrors Unity BoardLayoutSafetyConfig.asset defaults. */
export const DEFAULT_BOARD_SAFE_AREA: BoardSafeAreaConfig = {
  Left: -4.2,
  Right: 4.2,
  Top: 3.8,
  Bottom: -3.8,
  SoftInset: 0.4,
};

/** Matches TrojanGame.Gameplay.LevelConfigData — PascalCase for Unity JsonUtility */
export interface LevelConfigData {
  Id: number;
  TitleKey: string;
  DescriptionKey: string;
  TotalCards: number;
  TargetScore: number;
  WinConditionMode: LevelWinConditionMode;
  IsSingleDeck: boolean;
  /** Deterministic pool randomization; 0 = never set by random buttons */
  Seed: number;
  PoolSuits: SuitCode[] | string[];
  PoolRanks: number[];
  SpecialWild: number;
  SpecialMultiplier: number;
  SpecialSuit: number;
  ItemStorage: number;
  ItemShuffle: number;
  ItemAddWild: number;
  RandomEliminationRules: RandomEliminationRule[];
  BOARD_SAFE_AREA: BoardSafeAreaConfig;
  BoardLayout: LevelBoardSlotData[];
  Objectives: LevelObjectiveData[];
}

/** Filename-derived id for duplicate checks (mirrors LevelEditorStorage.LevelFileInfo.LevelId) */
export interface LevelFileSummary {
  fileName: string;
  levelId: number;
}

export function parseLevelIdFromFileName(fileName: string): number {
  const digits = fileName.replace(/\D/g, "");
  const n = parseInt(digits, 10);
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}

export function levelFileNameForId(id: number): string {
  return `level_${id}.json`;
}

/** Normalize parsed JSON so arrays are never undefined */
export function normalizeLevelConfig(raw: unknown): LevelConfigData | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const o = raw as Record<string, unknown>;
  const id = typeof o.Id === "number" ? o.Id : Number(o.Id);
  if (!Number.isFinite(id)) {
    return null;
  }
  const boardLayout = normalizeBoardSlots(o.BoardLayout);
  return {
    Id: id,
    TitleKey: typeof o.TitleKey === "string" ? o.TitleKey : "",
    DescriptionKey: typeof o.DescriptionKey === "string" ? o.DescriptionKey : "",
    TotalCards: boardLayout.length > 0 ? boardLayout.length : coerceInt(o.TotalCards, 0),
    TargetScore: coerceInt(o.TargetScore, 0),
    WinConditionMode: coerceInt(o.WinConditionMode, 0) as LevelConfigData["WinConditionMode"],
    IsSingleDeck: coerceBool(o.IsSingleDeck, true),
    Seed: coerceInt(o.Seed, 0),
    PoolSuits: Array.isArray(o.PoolSuits) ? (o.PoolSuits as string[]) : [],
    PoolRanks: Array.isArray(o.PoolRanks) ? (o.PoolRanks as number[]).map((n) => coerceInt(n, 0)) : [],
    SpecialWild: coerceInt(o.SpecialWild, 0),
    SpecialMultiplier: coerceInt(o.SpecialMultiplier, 0),
    SpecialSuit: coerceInt(o.SpecialSuit, 0),
    ItemStorage: coerceInt(o.ItemStorage, 0),
    ItemShuffle: coerceInt(o.ItemShuffle, 0),
    ItemAddWild: coerceInt(o.ItemAddWild, 0),
    RandomEliminationRules: normalizeRandomEliminationRules(o.RandomEliminationRules),
    BOARD_SAFE_AREA: normalizeBoardSafeArea(o.BOARD_SAFE_AREA),
    BoardLayout: boardLayout,
    Objectives: normalizeObjectives(o.Objectives),
  };
}

function coerceInt(v: unknown, fallback: number): number {
  if (typeof v === "number" && Number.isFinite(v)) {
    return Math.trunc(v);
  }
  if (typeof v === "string" && v.trim() !== "") {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

function coerceNumber(v: unknown, fallback: number): number {
  if (typeof v === "number" && Number.isFinite(v)) {
    return v;
  }
  if (typeof v === "string" && v.trim() !== "") {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

function normalizeBoardSafeArea(v: unknown): BoardSafeAreaConfig {
  const source = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const left = coerceNumber(source.Left, DEFAULT_BOARD_SAFE_AREA.Left);
  const right = coerceNumber(source.Right, DEFAULT_BOARD_SAFE_AREA.Right);
  const top = coerceNumber(source.Top, DEFAULT_BOARD_SAFE_AREA.Top);
  const bottom = coerceNumber(source.Bottom, DEFAULT_BOARD_SAFE_AREA.Bottom);
  return {
    Left: Math.min(left, right),
    Right: Math.max(left, right),
    Top: Math.max(top, bottom),
    Bottom: Math.min(top, bottom),
    SoftInset: Math.max(0, coerceNumber(source.SoftInset, DEFAULT_BOARD_SAFE_AREA.SoftInset)),
  };
}

function normalizeBoardSlots(v: unknown): LevelBoardSlotData[] {
  if (!Array.isArray(v)) {
    return [];
  }
  return v
    .filter((s) => s && typeof s === "object")
    .map((s) => {
      const r = s as Record<string, unknown>;
      const suit = typeof r.Suit === "string" && r.Suit.trim() !== "" ? r.Suit : "N";
      const specialRaw = typeof r.Special === "string" ? r.Special : "";
      const special =
        specialRaw === "Wild" ||
        specialRaw === "Multiplier" ||
        specialRaw === "SuitH" ||
        specialRaw === "SuitD" ||
        specialRaw === "SuitC" ||
        specialRaw === "SuitS"
          ? (specialRaw as NonNullable<LevelBoardSlotData["Special"]>)
          : "";
      return {
        X: coerceInt(r.X, 0),
        Y: coerceInt(r.Y, 0),
        Layer: coerceInt(r.Layer, 0),
        Suit: suit,
        Rank: coerceInt(r.Rank, 0),
        Special: special,
      };
    });
}

function coerceBool(v: unknown, fallback: boolean): boolean {
  if (typeof v === "boolean") {
    return v;
  }
  if (typeof v === "number") {
    return v !== 0;
  }
  if (typeof v === "string") {
    const normalized = v.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") {
      return true;
    }
    if (normalized === "false" || normalized === "0") {
      return false;
    }
  }
  return fallback;
}

function normalizeObjectives(v: unknown): LevelObjectiveData[] {
  if (!Array.isArray(v)) {
    return [];
  }
  return v
    .filter((s) => s && typeof s === "object")
    .map((s) => {
      const r = s as Record<string, unknown>;
      return {
        HandType: typeof r.HandType === "string" ? r.HandType : "",
        Count: coerceInt(r.Count, 0),
        Reward: coerceInt(r.Reward, 0),
      };
    });
}

function normalizeRandomEliminationRules(v: unknown): RandomEliminationRule[] {
  if (!Array.isArray(v)) {
    return [];
  }
  return v
    .filter((s) => s && typeof s === "object")
    .map((s) => {
      const r = s as Record<string, unknown>;
      const triggerRaw = typeof r.Trigger === "string" ? r.Trigger : "OnHighCard";
      const trigger: RandomEliminationTrigger = triggerRaw === "OnPairStreak2" ? "OnPairStreak2" : "OnHighCard";
      const rangeRaw = typeof r.Range === "string" ? r.Range : "All";
      const range: RandomEliminationRange =
        rangeRaw === "Clickable" || rangeRaw === "Locked" || rangeRaw === "Layers" ? (rangeRaw as RandomEliminationRange) : "All";
      const layers = Array.isArray(r.Layers) ? (r.Layers as unknown[]).map((n) => coerceInt(n, 0)).filter((n) => Number.isFinite(n) && n >= 0) : [];
      return {
        Enabled: coerceBool(r.Enabled, true),
        Trigger: trigger,
        RemoveCount: Math.max(0, coerceInt(r.RemoveCount, 0)),
        Range: range,
        Layers: layers,
        ExcludeFixedCards: coerceBool(r.ExcludeFixedCards, true),
        ExcludeJokers: coerceBool(r.ExcludeJokers, false),
      };
    });
}
