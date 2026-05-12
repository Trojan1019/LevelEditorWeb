import { cloneLevel } from "./levelClone";
import { normalizeLevelConfig, type LevelConfigData } from "./levelTypes";

/** 允许从外部 JSON 片段合并进当前关卡的字段（有则覆盖，无则保留原值）。 */
const MERGE_KEYS = [
  "Seed",
  "TitleKey",
  "DescriptionKey",
  "TotalCards",
  "TargetScore",
  "WinConditionMode",
  "IsSingleDeck",
  "PoolSuits",
  "PoolRanks",
  "SpecialWild",
  "SpecialMultiplier",
  "SpecialSuit",
  "ItemStorage",
  "ItemShuffle",
  "ItemAddWild",
  "BoardLayout",
  "Objectives",
  "Id",
] as const satisfies readonly (keyof LevelConfigData)[];

export type MergeLevelResult = { ok: true; data: LevelConfigData } | { ok: false; message: string };

/**
 * 将 JSON 对象中出现的关卡字段合并到当前关卡（用于粘贴片段、旧版本多出字段等）。
 * 仅处理白名单字段；合并后再走 normalize。
 */
export function mergeLevelFromJsonFragment(current: LevelConfigData, raw: unknown): MergeLevelResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, message: "JSON 顶层必须是对象。" };
  }
  const p = raw as Record<string, unknown>;
  const base = cloneLevel(current);
  const o: Record<string, unknown> = { ...base };
  let count = 0;
  for (const k of MERGE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(p, k) && p[k] !== undefined) {
      o[k] = p[k];
      count++;
    }
  }
  if (count === 0) {
    return {
      ok: false,
      message: "未找到可合并字段。支持例如：Seed、PoolSuits、PoolRanks、BoardLayout、Objectives、TotalCards 等。",
    };
  }
  const data = normalizeLevelConfig(o);
  if (!data) {
    return { ok: false, message: "合并后校验失败，请检查 JSON 类型与取值。" };
  }
  return { ok: true, data };
}
