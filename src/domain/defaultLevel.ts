import { LevelWinConditionMode } from "./enums";
import type { LevelConfigData } from "./levelTypes";

/** Mirrors LevelEditorStorage.CreateDefaultLevel */
export function createDefaultLevel(levelId: number): LevelConfigData {
  return {
    Id: levelId,
    TitleKey: "",
    DescriptionKey: "",
    TotalCards: 25,
    TargetScore: 300,
    TargetScoreRecommended: 300,
    TargetScoreMin: 200,
    TargetScoreMax: 500,
    AllowOverScoreWin: true,
    WinConditionMode: LevelWinConditionMode.ScoreOnly,
    StrictBlockOnUnreachable: true,
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
