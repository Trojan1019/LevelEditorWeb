import { BOARD_SUIT_CODES, LevelWinConditionMode, RANK_MAX, RANK_MIN, SUIT_CODES, isValidHandType } from "../domain/enums";
import type { LevelConfigData, LevelFileSummary } from "../domain/levelTypes";

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

  const specialTotal = level.SpecialWild + level.SpecialMultiplier + level.SpecialSuit;
  if (level.TotalCards > 0 && specialTotal > level.TotalCards) {
    messages.push({ severity: "error", message: "特殊牌总数不能超过 TotalCards。" });
  }

  const layout = level.BoardLayout ?? [];
  if (layout.length > 0) {
    if (layout.length !== level.TotalCards) {
      messages.push({
        severity: "warning",
        message: "BoardLayout 槽位数量与 TotalCards 不一致，运行时会回退到旧的自动布局。",
      });
    }

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
      if (Math.abs(slot.X) > 300 || Math.abs(slot.Y) > 300) {
        messages.push({
          severity: "warning",
          message: `BoardLayout[${i}] 坐标偏离中心较远，请确认是否仍在棋盘可视区域内。`,
        });
      }
    }

    const keyCounts = new Map<string, number>();
    for (const slot of layout) {
      if (!slot) {
        continue;
      }
      const k = `${slot.Layer}:${slot.X}:${slot.Y}`;
      keyCounts.set(k, (keyCounts.get(k) ?? 0) + 1);
    }
    for (const [k, c] of keyCounts) {
      if (c > 1) {
        messages.push({
          severity: "warning",
          message: `BoardLayout 存在同层同坐标重复槽位：${k}。`,
        });
      }
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
  }

  if (messages.length === 0) {
    messages.push({ severity: "info", message: "当前关卡配置校验通过。" });
  }

  return messages;
}

export function countBySeverity(messages: ValidationMessage[], severity: ValidationSeverity): number {
  return messages.filter((m) => m.severity === severity).length;
}
