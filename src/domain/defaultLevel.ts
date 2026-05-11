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
    WinConditionMode: LevelWinConditionMode.ScoreOnly,
    PoolSuits: ["H"],
    PoolRanks: [2, 3, 4, 5, 6, 7, 8],
    SpecialWild: 0,
    SpecialMultiplier: 0,
    SpecialSuit: 0,
    ItemStorage: 1,
    ItemShuffle: 0,
    ItemAddWild: 0,
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
