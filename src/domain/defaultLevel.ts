import { LevelWinConditionMode } from "./enums";
import { DEFAULT_BOARD_SAFE_AREA, type LevelConfigData } from "./levelTypes";

/** Mirrors LevelEditorStorage.CreateDefaultLevel */
export function createDefaultLevel(levelId: number): LevelConfigData {
  return {
    Id: levelId,
    TitleKey: "",
    DescriptionKey: "",
    TotalCards: 25,
    TargetScore: 300,
    WinConditionMode: LevelWinConditionMode.ScoreOnly,
    IsSingleDeck: true,
    Seed: 0,
    PoolSuits: ["H"],
    PoolRanks: [2, 3, 4, 5, 6, 7, 8],
    SpecialWild: 0,
    SpecialMultiplier: 0,
    SpecialSuit: 0,
    ItemStorage: 1,
    ItemShuffle: 0,
    ItemAddWild: 0,
    BOARD_SAFE_AREA: { ...DEFAULT_BOARD_SAFE_AREA },
    RandomEliminationRules: [
      { Enabled: true, Trigger: "OnHighCard", RemoveCount: 3, Range: "All", Layers: [], ExcludeFixedCards: true, ExcludeJokers: false },
      { Enabled: true, Trigger: "OnPairStreak2", RemoveCount: 3, Range: "All", Layers: [], ExcludeFixedCards: true, ExcludeJokers: false },
    ],
    BoardLayout: [],
    Objectives: [
      {
        HandType: "Flush",
        Count: 1,
        Reward: 50,
      },
    ],
  };
}
