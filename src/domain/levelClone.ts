import type { LevelConfigData } from "./levelTypes";
import { normalizeLevelConfig } from "./levelTypes";

export function cloneLevel(source: LevelConfigData): LevelConfigData {
  const json = JSON.stringify(source);
  const parsed = normalizeLevelConfig(JSON.parse(json));
  if (!parsed) {
    throw new Error("cloneLevel: failed to round-trip");
  }
  return parsed;
}
