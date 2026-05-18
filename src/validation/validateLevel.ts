import { BOARD_SUIT_CODES, LevelWinConditionMode, RANK_MAX, RANK_MIN, SUIT_CODES, isValidHandType } from "../domain/enums";
import { buildMultisetFromBoardLayout, buildPoolMultiset, objectiveReachabilityMessages } from "../domain/poolStats";
import type { LevelConfigData, LevelFileSummary } from "../domain/levelTypes";
import { validateBoardSafety } from "../board/boardSafety";

export type ValidationSeverity = "error" | "warning" | "info";

export interface ValidationMessage {
  severity: ValidationSeverity;
  message: string;
}

const validSuitCodes = new Set<string>(SUIT_CODES);
const validBoardSuitCodes = new Set<string>(BOARD_SUIT_CODES);

/**
 * Mirrors TrojanGame.Editor.LevelEditorValidator.Validate
 * @param allLevels — summaries used for duplicate Id check (include current file)
 */
export function validateLevel(level: LevelConfigData | null, allLevels: LevelFileSummary[]): ValidationMessage[] {
  const messages: ValidationMessage[] = [];

  if (!level) {
    messages.push({ severity: "error", message: "当前关卡数据为空，无法保存。" });
    return messages;
  }

  if (level.Id <= 0) {
    messages.push({ severity: "error", message: "关卡 Id 必须大于 0。" });
  }

  const duplicateCount = allLevels.filter((item) => item.levelId === level.Id).length;
  if (duplicateCount > 1) {
    messages.push({ severity: "error", message: `关卡 Id ${level.Id} 与其他 JSON 重复。` });
  }

  if (level.TotalCards < 5) {
    messages.push({
      severity: "warning",
      message: "TotalCards 小于 5，可能无法完成一次标准收集结算。",
    });
  }

  const needsScoreTarget =
    level.WinConditionMode === LevelWinConditionMode.ScoreOnly ||
    level.WinConditionMode === LevelWinConditionMode.ScoreAndObjectives ||
    level.WinConditionMode === LevelWinConditionMode.ScoreOrObjectives;
  const needsObjectiveTarget =
    level.WinConditionMode === LevelWinConditionMode.ObjectivesOnly ||
    level.WinConditionMode === LevelWinConditionMode.ScoreAndObjectives ||
    level.WinConditionMode === LevelWinConditionMode.ScoreOrObjectives;

  if (needsScoreTarget && level.TargetScore <= 0) {
    messages.push({
      severity: "error",
      message: "当前胜利条件需要分数目标，TargetScore 必须大于 0。",
    });
  } else if (!needsScoreTarget && level.TargetScore > 0) {
    messages.push({
      severity: "info",
      message: "当前胜利条件不要求分数，但 TargetScore 仍会用于界面展示和调试参考。",
    });
  }

  if (needsScoreTarget) {
    messages.push({ severity: "info", message: "分数判定固定为“达到或超过 TargetScore 即达标”。" });
  }

  if (!level.PoolSuits || level.PoolSuits.length === 0) {
    messages.push({ severity: "error", message: "PoolSuits 不能为空。" });
  } else if (level.PoolSuits.some((code) => !code || String(code).trim() === "" || !validSuitCodes.has(String(code)))) {
    messages.push({ severity: "error", message: "PoolSuits 只能使用 H / D / C / S。" });
  }

  if (!level.PoolRanks || level.PoolRanks.length === 0) {
    messages.push({ severity: "error", message: "PoolRanks 不能为空。" });
  } else if (level.PoolRanks.some((rank) => rank < RANK_MIN || rank > RANK_MAX)) {
    messages.push({ severity: "error", message: "PoolRanks 只能配置 2 到 14(A)。" });
  }

  if (level.SpecialWild < 0 || level.SpecialMultiplier < 0 || level.SpecialSuit < 0) {
    messages.push({ severity: "error", message: "特殊牌数量不能为负数。" });
  }

  if (level.ItemStorage < 0 || level.ItemShuffle < 0 || level.ItemAddWild < 0) {
    messages.push({ severity: "error", message: "道具初始次数不能为负数。" });
  }

  // Random elimination rules sanity
  const rules = level.RandomEliminationRules ?? [];
  for (let i = 0; i < rules.length; i++) {
    const r = rules[i];
    if (!r) continue;
    if (r.RemoveCount < 0) {
      messages.push({ severity: "error", message: `RandomEliminationRules[${i}] 的 RemoveCount 不能为负数。` });
    }
    if (r.Range === "Layers" && (!r.Layers || r.Layers.length === 0)) {
      messages.push({ severity: "warning", message: `RandomEliminationRules[${i}] 的 Range=Layers 但未配置 Layers，等同于不消除。` });
    }
  }

  const specialTotal = level.SpecialWild + level.SpecialMultiplier + level.SpecialSuit;
  if (level.TotalCards > 0 && specialTotal > level.TotalCards) {
    messages.push({ severity: "error", message: "特殊牌总数不能超过 TotalCards。" });
  }

  const layout = level.BoardLayout ?? [];
  if (layout.length > 0) {
    for (let i = 0; i < layout.length; i++) {
      const slot = layout[i];
      if (!slot) {
        messages.push({ severity: "error", message: `BoardLayout[${i}] 为空。` });
        continue;
      }
      if (slot.Layer < 0) {
        messages.push({ severity: "error", message: `BoardLayout[${i}] 的 Layer 不能为负数。` });
      }
      if (!validBoardSuitCodes.has(slot.Suit)) {
        messages.push({ severity: "error", message: `BoardLayout[${i}] 的 Suit 只能使用 N / H / D / C / S。` });
      } else if (slot.Suit === "N" && slot.Rank !== 0) {
        messages.push({ severity: "error", message: `BoardLayout[${i}] 的 Suit 为 N 时 Rank 必须为 0。` });
      } else if (slot.Suit !== "N" && (slot.Rank < RANK_MIN || slot.Rank > RANK_MAX)) {
        messages.push({ severity: "error", message: `BoardLayout[${i}] 固定牌 Rank 必须在 2 到 14(A) 之间。` });
      }
    }

    messages.push(...validateBoardSafety(layout, level.BOARD_SAFE_AREA));

    const keyCounts = new Map<string, number>();
    const fixedCardCounts = new Map<string, number>();
    for (const slot of layout) {
      if (!slot) {
        continue;
      }
      const k = `${slot.Layer}:${slot.X}:${slot.Y}`;
      keyCounts.set(k, (keyCounts.get(k) ?? 0) + 1);
      if (level.IsSingleDeck && slot.Suit !== "N" && slot.Rank >= RANK_MIN && slot.Rank <= RANK_MAX) {
        const cardKey = `${slot.Suit}${slot.Rank}`;
        fixedCardCounts.set(cardKey, (fixedCardCounts.get(cardKey) ?? 0) + 1);
      }
    }
    for (const [k, c] of keyCounts) {
      if (c > 1) {
        messages.push({
          severity: "warning",
          message: `BoardLayout 存在同层同坐标重复槽位：${k}。`,
        });
      }
    }
    for (const [cardKey, c] of fixedCardCounts) {
      if (c > 1) {
        messages.push({
          severity: "error",
          message: `IsSingleDeck 为 true 时，固定牌 ${cardKey} 只能使用一次。`,
        });
      }
    }

    const specialCounts = { Wild: 0, Multiplier: 0, Suit: 0 };
    for (const slot of layout) {
      const sp = typeof slot?.Special === "string" ? slot.Special : "";
      if (sp === "Wild") specialCounts.Wild++;
      else if (sp === "Multiplier") specialCounts.Multiplier++;
      else if (sp === "SuitH" || sp === "SuitD" || sp === "SuitC" || sp === "SuitS") specialCounts.Suit++;
    }
    if (specialCounts.Wild > level.SpecialWild) {
      messages.push({ severity: "error", message: `BoardLayout 中手动放置的万能小丑数量为 ${specialCounts.Wild}，超过 SpecialWild=${level.SpecialWild}。` });
    }
    if (specialCounts.Multiplier > level.SpecialMultiplier) {
      messages.push({
        severity: "error",
        message: `BoardLayout 中手动放置的倍率小丑数量为 ${specialCounts.Multiplier}，超过 SpecialMultiplier=${level.SpecialMultiplier}。`,
      });
    }
    if (specialCounts.Suit > level.SpecialSuit) {
      messages.push({ severity: "error", message: `BoardLayout 中手动放置的变化小丑数量为 ${specialCounts.Suit}，超过 SpecialSuit=${level.SpecialSuit}。` });
    }
  } else {
    messages.push({
      severity: "info",
      message: "BoardLayout 为空，运行时会使用自动棋盘布局。",
    });
  }

  const objectives = level.Objectives ?? [];
  if (objectives.length === 0) {
    messages.push({
      severity: needsObjectiveTarget ? "error" : "info",
      message: needsObjectiveTarget ? "当前胜利条件需要特殊目标，Objectives 不能为空。" : "当前关卡没有配置特殊目标。",
    });
  } else {
    for (let i = 0; i < objectives.length; i++) {
      const objective = objectives[i];
      if (!objective) {
        messages.push({ severity: "error", message: `Objectives[${i}] 为空。` });
        continue;
      }
      if (!isValidHandType(objective.HandType)) {
        messages.push({
          severity: "error",
          message: `Objectives[${i}] 的 HandType 非法：${objective.HandType}`,
        });
      }
      if (objective.Count <= 0) {
        messages.push({
          severity: "warning",
          message: `Objectives[${i}] 的 Count 小于等于 0。`,
        });
      }
      if (objective.Reward < 0) {
        messages.push({
          severity: "error",
          message: `Objectives[${i}] 的 Reward 不能为负数。`,
        });
      }
    }

    const boardMultiset = buildMultisetFromBoardLayout(level);
    const poolOkForStats =
      level.PoolSuits.length > 0 &&
      level.PoolRanks.length > 0 &&
      level.PoolSuits.every((code) => code && String(code).trim() !== "" && validSuitCodes.has(String(code))) &&
      level.PoolRanks.every((rank) => rank >= RANK_MIN && rank <= RANK_MAX);
    const multiset =
      boardMultiset.totalCards > 0 ? boardMultiset : poolOkForStats ? buildPoolMultiset(level) : null;
    if (multiset && multiset.totalCards > 0) {
      const sourceLabel = boardMultiset.totalCards > 0 ? "棋盘预览" : "花色池配置";
      for (const msg of objectiveReachabilityMessages(level, multiset, sourceLabel)) {
        messages.push(msg);
      }
    }
  }

  // Obvious unreachable: score upper bound (very coarse) for strong block publishing.
  if (needsScoreTarget && level.TargetScore > 0) {
    const rounds = Math.floor(Math.max(0, level.TotalCards) / 5);
    const maxSum = 60; // 10..A
    const maxMul = 9 + Math.max(0, level.SpecialMultiplier); // multiplier joker can add +1 each (upper bound)
    const scoreUpperBound = rounds * maxSum * maxMul;
    if (scoreUpperBound > 0 && level.TargetScore > scoreUpperBound) {
      messages.push({
        severity: "error",
        message: `TargetScore=${level.TargetScore} 明显不可达：按极粗上界，最多约 ${scoreUpperBound}（${rounds} 次结算 × 最高点数和 ${maxSum} × 最高倍率约 ${maxMul}）。`,
      });
    }
  }

  if (messages.length === 0) {
    messages.push({ severity: "info", message: "当前关卡配置校验通过。" });
  }

  return messages;
}

export function countBySeverity(messages: ValidationMessage[], severity: ValidationSeverity): number {
  return messages.filter((m) => m.severity === severity).length;
}
