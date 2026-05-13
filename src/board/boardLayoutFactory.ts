import { SNAP_ORIGIN_X, SNAP_ORIGIN_Y, SOURCE_CARD_WIDTH } from "./boardConstants";
import type { LevelBoardSlotData } from "../domain/levelTypes";

/** Mirrors LevelBoardLayoutEditor.AppendGridSlots */
export function appendGridSlots(slots: LevelBoardSlotData[], totalCards: number): void {
  const targetCount = Math.max(0, totalCards);
  while (slots.length < targetCount) {
    const index = slots.length;
    const layer = Math.floor(index / 16);
    const layerIndex = index % 16;
    const column = layerIndex % 4;
    const row = Math.floor(layerIndex / 4);
    const offsetX = layer % 2 === 0 ? 0 : SOURCE_CARD_WIDTH * 0.5;
    const offsetY = layer % 2 === 0 ? 0 : 19;
    slots.push({
      X: Math.round((column - 1.5) * SOURCE_CARD_WIDTH + offsetX),
      Y: Math.round(SNAP_ORIGIN_Y - row * 38 - offsetY),
      Layer: layer,
      Suit: "N",
      Rank: 0,
    });
  }
}

export function createGridSlots(totalCards: number): LevelBoardSlotData[] {
  const slots: LevelBoardSlotData[] = [];
  appendGridSlots(slots, totalCards);
  return slots;
}

export function snapToInt(value: number, step: number, origin: number): number {
  if (step <= 0) {
    return Math.round(value);
  }
  return Math.round((value - origin) / step) * step + origin;
}

export function compareSlotForDisplay(a: LevelBoardSlotData, b: LevelBoardSlotData): number {
  const lc = a.Layer - b.Layer;
  if (lc !== 0) {
    return lc;
  }
  const yc = a.Y - b.Y;
  if (yc !== 0) {
    return yc;
  }
  return a.X - b.X;
}

export function sortSlotsByLayer(slots: LevelBoardSlotData[]): void {
  slots.sort(compareSlotForDisplay);
}
