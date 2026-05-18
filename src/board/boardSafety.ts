import type { LevelBoardSlotData } from "../domain/levelTypes";

export interface RuntimePoint {
  x: number;
  y: number;
}

export interface SourcePoint {
  x: number;
  y: number;
}

export interface BoardProjection {
  centerX: number;
  centerY: number;
  fitScale: number;
}

export const BOARD_SAFETY_CONFIG = {
  runtimeBoardHalfWidth: 6.2,
  runtimeBoardHalfHeight: 6.0,
  runtimeSourceBoardStepX: 42,
  runtimeSourceBoardStepY: 38,
  runtimeTargetBoardStepX: 1.45,
  runtimeTargetBoardStepY: 1.18,
  runtimeBoardCardSize: { x: 1, y: 1.57 },
  hardArea: [
    { x: -5.4, y: 4.8 },
    { x: 5.4, y: 4.8 },
    { x: 5.4, y: -4.8 },
    { x: -5.4, y: -4.8 },
  ] as RuntimePoint[],
  softInset: 0.4,
  minRecommendedFitScale: 0.85,
};

export function calculateBoardProjection(slots: LevelBoardSlotData[]): BoardProjection {
  const valid = slots.filter(Boolean);
  if (valid.length === 0) {
    return { centerX: 0, centerY: 0, fitScale: 1 };
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const slot of valid) {
    minX = Math.min(minX, slot.X);
    maxX = Math.max(maxX, slot.X);
    minY = Math.min(minY, slot.Y);
    maxY = Math.max(maxY, slot.Y);
  }

  const rangeX = Math.max(1, maxX - minX);
  const rangeY = Math.max(1, maxY - minY);
  const boardWidth =
    (rangeX / BOARD_SAFETY_CONFIG.runtimeSourceBoardStepX) * BOARD_SAFETY_CONFIG.runtimeTargetBoardStepX;
  const boardHeight =
    (rangeY / BOARD_SAFETY_CONFIG.runtimeSourceBoardStepY) * BOARD_SAFETY_CONFIG.runtimeTargetBoardStepY;
  const fitScale = Math.min(
    1,
    (BOARD_SAFETY_CONFIG.runtimeBoardHalfWidth * 2) /
      Math.max(BOARD_SAFETY_CONFIG.runtimeTargetBoardStepX, boardWidth),
    (BOARD_SAFETY_CONFIG.runtimeBoardHalfHeight * 2) /
      Math.max(BOARD_SAFETY_CONFIG.runtimeTargetBoardStepY, boardHeight),
  );

  return {
    centerX: (minX + maxX) * 0.5,
    centerY: (minY + maxY) * 0.5,
    fitScale,
  };
}

export function projectSlotToRuntime(slot: LevelBoardSlotData, projection: BoardProjection): RuntimePoint {
  return {
    x:
      ((slot.X - projection.centerX) / BOARD_SAFETY_CONFIG.runtimeSourceBoardStepX) *
      BOARD_SAFETY_CONFIG.runtimeTargetBoardStepX *
      projection.fitScale,
    y:
      ((slot.Y - projection.centerY) / BOARD_SAFETY_CONFIG.runtimeSourceBoardStepY) *
      BOARD_SAFETY_CONFIG.runtimeTargetBoardStepY *
      projection.fitScale,
  };
}

export function runtimePointToSource(point: RuntimePoint, projection: BoardProjection): SourcePoint {
  const scaleX = BOARD_SAFETY_CONFIG.runtimeTargetBoardStepX * Math.max(0.0001, projection.fitScale);
  const scaleY = BOARD_SAFETY_CONFIG.runtimeTargetBoardStepY * Math.max(0.0001, projection.fitScale);
  return {
    x: (point.x / scaleX) * BOARD_SAFETY_CONFIG.runtimeSourceBoardStepX + projection.centerX,
    y: (point.y / scaleY) * BOARD_SAFETY_CONFIG.runtimeSourceBoardStepY + projection.centerY,
  };
}

export function createInsetQuad(quad: RuntimePoint[], inset: number): RuntimePoint[] {
  const center = {
    x: quad.reduce((sum, p) => sum + p.x, 0) / quad.length,
    y: quad.reduce((sum, p) => sum + p.y, 0) / quad.length,
  };
  return quad.map((p) => moveToward(p, center, inset));
}

export function getRuntimeCardCorners(center: RuntimePoint): RuntimePoint[] {
  const halfW = BOARD_SAFETY_CONFIG.runtimeBoardCardSize.x * 0.5;
  const halfH = BOARD_SAFETY_CONFIG.runtimeBoardCardSize.y * 0.5;
  return [
    { x: center.x - halfW, y: center.y + halfH },
    { x: center.x + halfW, y: center.y + halfH },
    { x: center.x + halfW, y: center.y - halfH },
    { x: center.x - halfW, y: center.y - halfH },
  ];
}

export function isPointInQuad(point: RuntimePoint, quad: RuntimePoint[]): boolean {
  if (quad.length < 3) {
    return false;
  }

  let hasPositive = false;
  let hasNegative = false;
  for (let i = 0; i < quad.length; i++) {
    const a = quad[i];
    const b = quad[(i + 1) % quad.length];
    const cross = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
    if (cross > 0.00001) {
      hasPositive = true;
    } else if (cross < -0.00001) {
      hasNegative = true;
    }
    if (hasPositive && hasNegative) {
      return false;
    }
  }
  return true;
}

export function arePointsInsideQuad(points: RuntimePoint[], quad: RuntimePoint[]): boolean {
  return points.every((point) => isPointInQuad(point, quad));
}

export function getBoardSafetyState(slots: LevelBoardSlotData[]) {
  const projection = calculateBoardProjection(slots);
  const hardArea = BOARD_SAFETY_CONFIG.hardArea;
  const softArea = createInsetQuad(hardArea, BOARD_SAFETY_CONFIG.softInset);
  const slotStates = slots.map((slot) => {
    const corners = getRuntimeCardCorners(projectSlotToRuntime(slot, projection));
    return {
      hardInside: arePointsInsideQuad(corners, hardArea),
      softInside: arePointsInsideQuad(corners, softArea),
    };
  });

  return {
    projection,
    hardArea,
    softArea,
    hardAreaSource: hardArea.map((p) => runtimePointToSource(p, projection)),
    softAreaSource: softArea.map((p) => runtimePointToSource(p, projection)),
    slotStates,
    hasHardViolations: slotStates.some((s) => !s.hardInside),
    hasSoftWarnings: slotStates.some((s) => s.hardInside && !s.softInside),
  };
}

export function validateBoardSafety(slots: LevelBoardSlotData[]): { severity: "error" | "warning"; message: string }[] {
  if (slots.length === 0) {
    return [];
  }

  const state = getBoardSafetyState(slots);
  const messages: { severity: "error" | "warning"; message: string }[] = [];
  if (state.projection.fitScale < BOARD_SAFETY_CONFIG.minRecommendedFitScale) {
    messages.push({
      severity: "warning",
      message: `BoardLayout 运行时会被明显压缩，当前 FitScale=${state.projection.fitScale.toFixed(2)}，建议不低于 ${BOARD_SAFETY_CONFIG.minRecommendedFitScale.toFixed(2)}。`,
    });
  }

  state.slotStates.forEach((slotState, index) => {
    if (!slotState.hardInside) {
      messages.push({
        severity: "error",
        message: `BoardLayout[${index}] 超出棋盘硬安全区，请调整槽位。`,
      });
    } else if (!slotState.softInside) {
      messages.push({
        severity: "warning",
        message: `BoardLayout[${index}] 靠近棋盘软安全区边界，可能与 UI 或屏幕边缘过近。`,
      });
    }
  });

  return messages;
}

function moveToward(from: RuntimePoint, to: RuntimePoint, distance: number): RuntimePoint {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len <= 0.0001) {
    return { ...from };
  }
  const step = Math.min(distance, len);
  return {
    x: from.x + (dx / len) * step,
    y: from.y + (dy / len) * step,
  };
}
