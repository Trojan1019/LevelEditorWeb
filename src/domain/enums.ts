/** Mirrors TrojanGame.Gameplay.LevelWinConditionMode */
export enum LevelWinConditionMode {
  ScoreOnly = 0,
  ObjectivesOnly = 1,
  ScoreAndObjectives = 2,
  ScoreOrObjectives = 3,
}

/** Mirrors TrojanGame.Gameplay.HandType — JsonUtility serializes enum name as string */
export const HAND_TYPES = [
  "HighCard",
  "Pair",
  "TwoPair",
  "ThreeOfAKind",
  "Straight",
  "Flush",
  "FullHouse",
  "FourOfAKind",
  "StraightFlush",
  "RoyalFlush",
] as const;

export type HandTypeString = (typeof HAND_TYPES)[number];

export function isValidHandType(s: string): s is HandTypeString {
  return (HAND_TYPES as readonly string[]).includes(s);
}

export const SUIT_CODES = ["H", "D", "C", "S"] as const;
export type SuitCode = (typeof SUIT_CODES)[number];

export const RANK_MIN = 2;
export const RANK_MAX = 14;
