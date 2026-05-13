import type { LevelBoardSlotData, LevelConfigData, LevelObjectiveData, RandomEliminationRule } from "./levelTypes";

/**
 * Fingerprint version: bump when serialization rules change (all prior fingerprints effectively reset).
 */
const FINGERPRINT_VERSION = "LevelEditorWeb.levelFp.v1";

/**
 * Product rule — excluded from {@link computeLevelFingerprint}:
 * - TitleKey, DescriptionKey: localization / display copy only; changing them must not reshuffle preview or editor board RNG.
 * - Seed: user-controlled randomness knob; mixed separately via {@link mixEffectiveSeed}.
 */
export const LEVEL_FINGERPRINT_EXCLUDED_FROM_HASH = ["TitleKey", "DescriptionKey", "Seed"] as const;

function fnv1a32String(s: string, h0 = 2166136261): number {
  let h = h0 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = (seed >>> 0) || 0x9e3779b9;
  return () => {
    let t = (a += 0x6d2b79f5) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function serializeRule(r: RandomEliminationRule): string {
  const layers = [...(r.Layers ?? [])].map((n) => String(n >>> 0)).join(",");
  return [
    r.Enabled ? 1 : 0,
    r.Trigger,
    r.RemoveCount >>> 0,
    r.Range,
    layers,
    r.ExcludeFixedCards ? 1 : 0,
    r.ExcludeJokers ? 1 : 0,
  ].join(":");
}

function serializeObjective(o: LevelObjectiveData): string {
  return [o.HandType, o.Count >>> 0, o.Reward >>> 0].join(":");
}

function serializeSlot(s: LevelBoardSlotData): string {
  const sp = typeof s.Special === "string" && s.Special ? s.Special : "";
  return [s.X >>> 0, s.Y >>> 0, s.Layer >>> 0, String(s.Suit), s.Rank >>> 0, sp].join(",");
}

/** Stable string of all gameplay-relevant fields (excludes Seed, TitleKey, DescriptionKey). */
export function serializeLevelForFingerprint(level: LevelConfigData): string {
  const parts: string[] = [FINGERPRINT_VERSION];
  parts.push(`Id:${level.Id >>> 0}`);
  parts.push(`TotalCards:${level.TotalCards >>> 0}`);
  parts.push(`TargetScore:${level.TargetScore >>> 0}`);
  parts.push(`WinConditionMode:${level.WinConditionMode >>> 0}`);
  parts.push(`IsSingleDeck:${level.IsSingleDeck ? 1 : 0}`);
  parts.push(`PoolSuits:${level.PoolSuits.map(String).join(",")}`);
  parts.push(`PoolRanks:${level.PoolRanks.map((n) => n >>> 0).join(",")}`);
  parts.push(`SpecialWild:${level.SpecialWild >>> 0}`);
  parts.push(`SpecialMultiplier:${level.SpecialMultiplier >>> 0}`);
  parts.push(`SpecialSuit:${level.SpecialSuit >>> 0}`);
  parts.push(`ItemStorage:${level.ItemStorage >>> 0}`);
  parts.push(`ItemShuffle:${level.ItemShuffle >>> 0}`);
  parts.push(`ItemAddWild:${level.ItemAddWild >>> 0}`);
  parts.push(`RandomEliminationRules:${level.RandomEliminationRules.map(serializeRule).join("|")}`);
  parts.push(`Objectives:${level.Objectives.map(serializeObjective).join("|")}`);
  parts.push(`BoardLayout:${level.BoardLayout.map(serializeSlot).join("|")}`);
  return parts.join("\x1f");
}

/** 32-bit fingerprint of level content (Seed / title keys excluded per product rules). */
export function computeLevelFingerprint(level: LevelConfigData): number {
  return fnv1a32String(serializeLevelForFingerprint(level));
}

/**
 * Mix user Seed, level fingerprint, and a versioned feature salt into one PRNG seed.
 */
export function mixEffectiveSeed(seed: number, fingerprint: number, salt: string): number {
  let h = 2166136261 >>> 0;
  h ^= seed >>> 0;
  h = Math.imul(h, 16777619);
  h ^= fingerprint >>> 0;
  h = Math.imul(h, 16777619);
  for (let i = 0; i < salt.length; i++) {
    h ^= salt.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Optional integer tags (round index, score, rule slot, shuffle count, …). */
export function createDeterministicRngFromParts(
  seed: number,
  fingerprint: number,
  salt: string,
  extras: readonly number[] = [],
): () => number {
  let h = mixEffectiveSeed(seed, fingerprint, salt);
  for (const x of extras) {
    h = (Math.imul(h ^ (x >>> 0), 0x27d4eb2d) >>> 0) ^ (h >>> 16);
  }
  return mulberry32(h);
}
