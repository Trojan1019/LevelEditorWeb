import { MIN_CLICKABLE_VISIBLE_AREA_RATIO, OCCLUSION_HEIGHT, OCCLUSION_WIDTH } from "./boardConstants";
import type { LevelBoardSlotData } from "../domain/levelTypes";

interface Rect {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
}

interface VirtualCard {
  id: string;
  GridX: number;
  GridY: number;
  Layer: number;
  StackOrder: number;
  IsRemoved: boolean;
}

function getCardOcclusionRect(card: VirtualCard): Rect {
  return {
    xMin: card.GridX - OCCLUSION_WIDTH * 0.5,
    yMin: card.GridY - OCCLUSION_HEIGHT * 0.5,
    xMax: card.GridX + OCCLUSION_WIDTH * 0.5,
    yMax: card.GridY + OCCLUSION_HEIGHT * 0.5,
  };
}

function getIntersection(a: Rect, b: Rect): Rect {
  const xMin = Math.max(a.xMin, b.xMin);
  const yMin = Math.max(a.yMin, b.yMin);
  const xMax = Math.min(a.xMax, b.xMax);
  const yMax = Math.min(a.yMax, b.yMax);
  if (xMax <= xMin || yMax <= yMin) {
    return { xMin: 0, yMin: 0, xMax: 0, yMax: 0 };
  }
  return { xMin, yMin, xMax, yMax };
}

function calculateMergedIntervalLength(intervals: { x: number; y: number }[]): number {
  if (intervals.length === 0) {
    return 0;
  }
  const sorted = [...intervals].sort((a, b) => a.x - b.x);
  let total = 0;
  let currentStart = sorted[0].x;
  let currentEnd = sorted[0].y;
  for (let i = 1; i < sorted.length; i++) {
    const interval = sorted[i];
    if (interval.x <= currentEnd) {
      currentEnd = Math.max(currentEnd, interval.y);
    } else {
      total += currentEnd - currentStart;
      currentStart = interval.x;
      currentEnd = interval.y;
    }
  }
  total += currentEnd - currentStart;
  return total;
}

function calculateUnionArea(rects: Rect[]): number {
  if (rects.length === 0) {
    return 0;
  }
  const xEdges: number[] = [];
  for (const r of rects) {
    xEdges.push(r.xMin, r.xMax);
  }
  xEdges.sort((a, b) => a - b);
  let area = 0;
  for (let edgeIndex = 0; edgeIndex < xEdges.length - 1; edgeIndex++) {
    const xMin = xEdges[edgeIndex];
    const xMax = xEdges[edgeIndex + 1];
    const width = xMax - xMin;
    if (width <= 0) {
      continue;
    }
    const sliceCenterX = (xMin + xMax) * 0.5;
    const yIntervals: { x: number; y: number }[] = [];
    for (const rect of rects) {
      if (sliceCenterX > rect.xMin && sliceCenterX < rect.xMax) {
        yIntervals.push({ x: rect.yMin, y: rect.yMax });
      }
    }
    area += width * calculateMergedIntervalLength(yIntervals);
  }
  return area;
}

function isCardAbove(other: VirtualCard, target: VirtualCard): boolean {
  if (other.Layer !== target.Layer) {
    return other.Layer > target.Layer;
  }
  return other.StackOrder > target.StackOrder;
}

/** Returns visible area ratio [0,1] per slot index; mirrors BoardService.UpdateClickability */
export function computeVisibleRatios(slots: LevelBoardSlotData[]): { ratio: number; clickable: boolean }[] {
  const cards: VirtualCard[] = slots.map((s, i) => ({
    id: `slot-${i}`,
    GridX: s.X,
    GridY: s.Y,
    Layer: s.Layer,
    StackOrder: i,
    IsRemoved: false,
  }));
  const activeCards = cards.filter((c) => !c.IsRemoved);
  const ratios: { ratio: number; clickable: boolean }[] = [];

  for (let i = 0; i < cards.length; i++) {
    const target = cards[i];
    if (target.IsRemoved) {
      ratios.push({ ratio: 0, clickable: false });
      continue;
    }
    const targetRect = getCardOcclusionRect(target);
    const coveredRects: Rect[] = [];
    for (const other of activeCards) {
      if (other.id === target.id || !isCardAbove(other, target)) {
        continue;
      }
      const overlap = getIntersection(targetRect, getCardOcclusionRect(other));
      const w = overlap.xMax - overlap.xMin;
      const h = overlap.yMax - overlap.yMin;
      if (w > 0 && h > 0) {
        coveredRects.push(overlap);
      }
    }
    const tw = targetRect.xMax - targetRect.xMin;
    const th = targetRect.yMax - targetRect.yMin;
    const ta = tw * th;
    const coveredArea = calculateUnionArea(coveredRects);
    const visibleAreaRatio = ta <= 0 ? 0 : 1 - Math.min(1, Math.max(0, coveredArea / ta));
    ratios.push({
      ratio: visibleAreaRatio,
      clickable: visibleAreaRatio >= MIN_CLICKABLE_VISIBLE_AREA_RATIO,
    });
  }
  return ratios;
}
