import type { LevelWinConditionMode } from "./enums";
import type { BoardSuitCode, SuitCode } from "./enums";

/** Matches TrojanGame.Gameplay.LevelBoardSlotData */
export interface LevelBoardSlotData {
  X: number;
  Y: number;
  Layer: number;
  Suit: BoardSuitCode | string;
  Rank: number;
}

/** Matches TrojanGame.Gameplay.LevelObjectiveData */
export interface LevelObjectiveData {
  HandType: string;
  Count: number;
  Reward: number;
}

/** Matches TrojanGame.Gameplay.LevelConfigData — PascalCase for Unity JsonUtility */
export interface LevelConfigData {
  Id: number;
  TitleKey: string;
  DescriptionKey: string;
  TotalCards: number;
  TargetScore: number;
  WinConditionMode: LevelWinConditionMode;
  IsSingleDeck: boolean;
  PoolSuits: SuitCode[] | string[];
  PoolRanks: number[];
  SpecialWild: number;
  SpecialMultiplier: number;
  SpecialSuit: number;
  ItemStorage: number;
  ItemShuffle: number;
  ItemAddWild: number;
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
  return {
    Id: id,
    TitleKey: typeof o.TitleKey === "string" ? o.TitleKey : "",
    DescriptionKey: typeof o.DescriptionKey === "string" ? o.DescriptionKey : "",
    TotalCards: coerceInt(o.TotalCards, 0),
    TargetScore: coerceInt(o.TargetScore, 0),
    WinConditionMode: coerceInt(o.WinConditionMode, 0) as LevelConfigData["WinConditionMode"],
    IsSingleDeck: coerceBool(o.IsSingleDeck, true),
    PoolSuits: Array.isArray(o.PoolSuits) ? (o.PoolSuits as string[]) : [],
    PoolRanks: Array.isArray(o.PoolRanks) ? (o.PoolRanks as number[]).map((n) => coerceInt(n, 0)) : [],
    SpecialWild: coerceInt(o.SpecialWild, 0),
    SpecialMultiplier: coerceInt(o.SpecialMultiplier, 0),
    SpecialSuit: coerceInt(o.SpecialSuit, 0),
    ItemStorage: coerceInt(o.ItemStorage, 0),
    ItemShuffle: coerceInt(o.ItemShuffle, 0),
    ItemAddWild: coerceInt(o.ItemAddWild, 0),
    BoardLayout: normalizeBoardSlots(o.BoardLayout),
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

function normalizeBoardSlots(v: unknown): LevelBoardSlotData[] {
  if (!Array.isArray(v)) {
    return [];
  }
  return v
    .filter((s) => s && typeof s === "object")
    .map((s) => {
      const r = s as Record<string, unknown>;
      const suit = typeof r.Suit === "string" && r.Suit.trim() !== "" ? r.Suit : "N";
      return {
        X: coerceInt(r.X, 0),
        Y: coerceInt(r.Y, 0),
        Layer: coerceInt(r.Layer, 0),
        Suit: suit,
        Rank: coerceInt(r.Rank, 0),
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
