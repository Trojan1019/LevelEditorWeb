import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { computeVisibleRatios } from "../board/boardClickability";
import {
  DEFAULT_SNAP_STEP_X,
  DEFAULT_SNAP_STEP_Y,
  SNAP_ORIGIN_X,
  SNAP_ORIGIN_Y,
  SOURCE_CARD_HEIGHT,
  SOURCE_CARD_WIDTH,
} from "../board/boardConstants";
import { appendGridSlots, createGridSlots, snapToInt, sortSlotsByLayer } from "../board/boardLayoutFactory";
import type { LevelBoardSlotData } from "../domain/levelTypes";
import { BOARD_SUIT_CODES, RANK_MAX, RANK_MIN, type BoardSuitCode } from "../domain/enums";

interface Props {
  totalCards: number;
  boardLayout: LevelBoardSlotData[];
  onChange: (next: LevelBoardSlotData[]) => void;
  onTotalCardsChange: (n: number) => void;
  focusSlotIndex?: number | null;
  onFocusSlotConsumed?: () => void;
}

const SNAP_X_STORAGE_KEY = "joker.levelEditor.snapX";
const SNAP_Y_STORAGE_KEY = "joker.levelEditor.snapY";
const SUIT_FILE_PREFIX: Record<string, string> = {
  H: "hearts",
  D: "diamonds",
  C: "clubs",
  S: "spades",
};

function loadSnap(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    const n = raw == null ? NaN : parseFloat(raw);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  } catch {
    return fallback;
  }
}

function saveSnap(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // ignore
  }
}

function layoutBounds(slots: LevelBoardSlotData[]): { minX: number; maxX: number; minY: number; maxY: number } {
  if (slots.length === 0) {
    return { minX: -80, maxX: 80, minY: -80, maxY: 80 };
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const hw = SOURCE_CARD_WIDTH / 2;
  const hh = SOURCE_CARD_HEIGHT / 2;
  for (const s of slots) {
    minX = Math.min(minX, s.X - hw);
    maxX = Math.max(maxX, s.X + hw);
    minY = Math.min(minY, s.Y - hh);
    maxY = Math.max(maxY, s.Y + hh);
  }
  const pad = 40;
  return { minX: minX - pad, maxX: maxX + pad, minY: minY - pad, maxY: maxY + pad };
}

function rankLabel(rank: number): string {
  if (rank === 0) {
    return "0";
  }
  if (rank <= 10) {
    return String(rank);
  }
  return rank === 11 ? "J" : rank === 12 ? "Q" : rank === 13 ? "K" : "A";
}

function slotFaceLabel(slot: LevelBoardSlotData): string {
  if (slot.Suit === "N") {
    return "N";
  }
  return `${slot.Suit}${rankLabel(slot.Rank)}`;
}

function publicAssetPath(path: string): string {
  if (typeof window !== "undefined" && window.location.protocol === "file:") {
    const normalizedPath = window.location.pathname.replace(/\\/g, "/").toLowerCase();
    if (!normalizedPath.includes("/docs/")) {
      return `./docs/${path}`;
    }
  }
  return `${import.meta.env.BASE_URL}${path}`;
}

function cardSpriteHref(slot: LevelBoardSlotData): string | null {
  if (slot.Suit === "N" || slot.Rank < RANK_MIN || slot.Rank > RANK_MAX) {
    return null;
  }
  const prefix = SUIT_FILE_PREFIX[slot.Suit];
  if (!prefix) {
    return null;
  }
  const rank = slot.Rank <= 10 ? String(slot.Rank) : slot.Rank === 11 ? "j" : slot.Rank === 12 ? "q" : slot.Rank === 13 ? "k" : "a";
  return publicAssetPath(`sprites/cards/${prefix}_${rank}.png`);
}

export function BoardEditor({
  totalCards,
  boardLayout,
  onChange,
  onTotalCardsChange,
  focusSlotIndex,
  onFocusSlotConsumed,
}: Props) {
  const [selected, setSelected] = useState<number>(-1);
  const [pickerIndex, setPickerIndex] = useState<number>(-1);
  const [snapX, setSnapX] = useState(() => loadSnap(SNAP_X_STORAGE_KEY, DEFAULT_SNAP_STEP_X));
  const [snapY, setSnapY] = useState(() => loadSnap(SNAP_Y_STORAGE_KEY, DEFAULT_SNAP_STEP_Y));
  const dragRef = useRef<{
    index: number;
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
    svg: SVGSVGElement;
  } | null>(null);

  const layoutStatus =
    boardLayout.length === 0
      ? { text: "空布局 → 运行时自动布局", cls: "warn" as const }
      : boardLayout.length === totalCards
        ? { text: "显式布局生效", cls: "ok" as const }
        : boardLayout.length < totalCards
          ? { text: `少槽位 (${boardLayout.length} / ${totalCards})`, cls: "warn" as const }
          : { text: `多槽位 (${boardLayout.length} / ${totalCards})`, cls: "warn" as const };

  const clickInfo = useMemo(() => {
    if (boardLayout.length !== totalCards || boardLayout.length === 0) {
      return null;
    }
    return computeVisibleRatios(boardLayout);
  }, [boardLayout, totalCards]);

  const hasFixedBoardCards = useMemo(
    () => boardLayout.some((slot) => slot.Suit !== "N" && slot.Rank >= RANK_MIN && slot.Rank <= RANK_MAX),
    [boardLayout],
  );

  const vb = useMemo(() => {
    const b = layoutBounds(boardLayout);
    const w = b.maxX - b.minX;
    const h = b.maxY - b.minY;
    return { x: b.minX, y: b.minY, w: Math.max(w, 120), h: Math.max(h, 120) };
  }, [boardLayout]);

  const updateSlot = useCallback(
    (i: number, patch: Partial<LevelBoardSlotData>) => {
      const next = boardLayout.map((s, idx) => (idx === i ? { ...s, ...patch } : { ...s }));
      onChange(next);
    },
    [boardLayout, onChange],
  );

  useEffect(() => {
    if (focusSlotIndex == null || focusSlotIndex < 0 || focusSlotIndex >= boardLayout.length) {
      return;
    }
    setSelected(focusSlotIndex);
    onFocusSlotConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot focus from validation panel
  }, [focusSlotIndex, boardLayout.length]);

  useEffect(() => {
    saveSnap(SNAP_X_STORAGE_KEY, snapX);
  }, [snapX]);

  useEffect(() => {
    saveSnap(SNAP_Y_STORAGE_KEY, snapY);
  }, [snapY]);

  const onPointerDownSlot = (e: React.PointerEvent, index: number) => {
    (e.currentTarget as SVGGElement).setPointerCapture(e.pointerId);
    setSelected(index);
    const svg = (e.currentTarget as SVGGElement).ownerSVGElement;
    if (!svg) {
      return;
    }
    const s = boardLayout[index];
    dragRef.current = {
      index,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startX: s.X,
      startY: s.Y,
      svg,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) {
      return;
    }
    const svg = d.svg;
    const ctm = svg.getScreenCTM();
    if (!ctm) {
      return;
    }
    const inv = ctm.inverse();
    const p0 = new DOMPoint(d.startClientX, d.startClientY).matrixTransform(inv);
    const p1 = new DOMPoint(e.clientX, e.clientY).matrixTransform(inv);
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const nx = snapToInt(d.startX + dx, snapX, SNAP_ORIGIN_X);
    const ny = snapToInt(d.startY + dy, snapY, SNAP_ORIGIN_Y);
    updateSlot(d.index, { X: nx, Y: ny });
  };

  const onPointerUp = () => {
    dragRef.current = null;
  };

  const selectedSlot = selected >= 0 && selected < boardLayout.length ? boardLayout[selected] : null;
  const pickerSlot = pickerIndex >= 0 && pickerIndex < boardLayout.length ? boardLayout[pickerIndex] : null;

  return (
    <div className="panel" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <span className={`layout-status ${layoutStatus.cls}`}>{layoutStatus.text}</span>
        {hasFixedBoardCards ? <span className="layout-status ok">固定牌面模式</span> : null}
        <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
          吸附 X
          <input type="number" value={snapX} onChange={(e) => setSnapX(Math.max(1, parseFloat(e.target.value) || 1))} />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
          吸附 Y
          <input type="number" value={snapY} onChange={(e) => setSnapY(Math.max(1, parseFloat(e.target.value) || 1))} />
        </label>
        <button
          type="button"
          onClick={() => {
            setSnapX(DEFAULT_SNAP_STEP_X);
            setSnapY(DEFAULT_SNAP_STEP_Y);
          }}
        >
          恢复默认吸附
        </button>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        <button
          type="button"
          onClick={() => {
            const next = [...boardLayout, { X: 0, Y: 0, Layer: 0, Suit: "N" as const, Rank: 0 }];
            onChange(next);
            setSelected(next.length - 1);
          }}
        >
          添加槽位
        </button>
        <button type="button" onClick={() => onChange(createGridSlots(totalCards))}>
          默认矩阵
        </button>
        <button
          type="button"
          onClick={() => {
            const next = [...boardLayout];
            appendGridSlots(next, totalCards);
            onChange(next);
          }}
        >
          补齐到总牌数（TotalCards）
        </button>
        <button type="button" onClick={() => onTotalCardsChange(boardLayout.length)}>
          同步总牌数 = 槽位数
        </button>
        <button
          type="button"
          onClick={() => {
            const next = boardLayout.map((s) => ({
              ...s,
              X: snapToInt(s.X, snapX, SNAP_ORIGIN_X),
              Y: snapToInt(s.Y, snapY, SNAP_ORIGIN_Y),
            }));
            onChange(next);
          }}
        >
          全部吸附
        </button>
        <button type="button" onClick={() => onChange([])}>
          清空布局
        </button>
        <button
          type="button"
          onClick={() => {
            const next = [...boardLayout];
            sortSlotsByLayer(next);
            onChange(next);
          }}
        >
          按层排序
        </button>
      </div>
      {selectedSlot ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
          <label className="field" style={{ margin: 0 }}>
            <span>X</span>
            <input
              type="number"
              value={selectedSlot.X}
              onChange={(e) => updateSlot(selected, { X: parseInt(e.target.value, 10) || 0 })}
            />
          </label>
          <label className="field" style={{ margin: 0 }}>
            <span>Y</span>
            <input
              type="number"
              value={selectedSlot.Y}
              onChange={(e) => updateSlot(selected, { Y: parseInt(e.target.value, 10) || 0 })}
            />
          </label>
          <label className="field" style={{ margin: 0 }}>
            <span>层级（Layer）</span>
            <input
              type="number"
              value={selectedSlot.Layer}
              onChange={(e) => updateSlot(selected, { Layer: parseInt(e.target.value, 10) || 0 })}
            />
          </label>
          <label className="field" style={{ margin: 0 }}>
            <span>固定花色（Suit）</span>
            <select
              value={selectedSlot.Suit}
              onChange={(e) => {
                const suit = e.target.value as BoardSuitCode;
                updateSlot(selected, {
                  Suit: suit,
                  Rank: suit === "N" ? 0 : selectedSlot.Rank >= RANK_MIN && selectedSlot.Rank <= RANK_MAX ? selectedSlot.Rank : RANK_MIN,
                });
              }}
            >
              {BOARD_SUIT_CODES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="field" style={{ margin: 0 }}>
            <span>固定点数（Rank）</span>
            <select
              value={selectedSlot.Rank}
              disabled={selectedSlot.Suit === "N"}
              onChange={(e) => {
                const rank = parseInt(e.target.value, 10) || 0;
                updateSlot(selected, { Rank: selectedSlot.Suit === "N" ? 0 : rank });
              }}
            >
              <option value={0}>0</option>
              {Array.from({ length: RANK_MAX - RANK_MIN + 1 }, (_, i) => RANK_MIN + i).map((r) => (
                <option key={r} value={r}>
                  {rankLabel(r)}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={() => updateSlot(selected, { Layer: selectedSlot.Layer + 1 })}>
            层级 +1
          </button>
          <button type="button" onClick={() => updateSlot(selected, { Layer: Math.max(0, selectedSlot.Layer - 1) })}>
            层级 -1
          </button>
          <button
            type="button"
            onClick={() => {
              const maxL = Math.max(...boardLayout.map((s) => s.Layer), 0);
              updateSlot(selected, { Layer: maxL + 1 });
            }}
          >
            移到最上层
          </button>
          <button type="button" onClick={() => updateSlot(selected, { Layer: 0 })}>
            移到底层
          </button>
          <button
            type="button"
            onClick={() => {
              const copy = { ...selectedSlot };
              const next = [...boardLayout];
              next.splice(selected + 1, 0, { ...copy, X: copy.X + snapX });
              onChange(next);
              setSelected(selected + 1);
            }}
          >
            复制槽位
          </button>
          <button
            type="button"
            onClick={() => {
              const next = boardLayout.filter((_, i) => i !== selected);
              onChange(next);
              setSelected(Math.min(selected, next.length - 1));
              if (pickerIndex === selected) {
                setPickerIndex(-1);
              } else if (pickerIndex > selected) {
                setPickerIndex(pickerIndex - 1);
              }
            }}
          >
            删除槽位
          </button>
        </div>
      ) : null}
      <div style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden", background: "#0a0d12" }}>
        <svg
          width="100%"
          height={420}
          viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
          style={{ display: "block", touchAction: "none" }}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
        >
          <defs>
            <pattern id="grid" width={snapX} height={snapY} patternUnits="userSpaceOnUse" x={SNAP_ORIGIN_X} y={SNAP_ORIGIN_Y}>
              <path
                d={`M ${snapX} 0 L 0 0 0 ${snapY}`}
                fill="none"
                stroke="#1e2636"
                strokeWidth={0.5}
              />
            </pattern>
          </defs>
          <rect x={vb.x} y={vb.y} width={vb.w} height={vb.h} fill="url(#grid)" />
          <line
            x1={vb.x}
            y1={SNAP_ORIGIN_Y}
            x2={vb.x + vb.w}
            y2={SNAP_ORIGIN_Y}
            stroke="#2a3344"
            strokeWidth={1}
          />
          <line
            x1={SNAP_ORIGIN_X}
            y1={vb.y}
            x2={SNAP_ORIGIN_X}
            y2={vb.y + vb.h}
            stroke="#2a3344"
            strokeWidth={1}
          />
          {boardLayout.map((s, i) => {
            const w = SOURCE_CARD_WIDTH;
            const h = SOURCE_CARD_HEIGHT;
            const rx = s.X - w / 2;
            const ry = s.Y - h / 2;
            const clickable = clickInfo ? clickInfo[i]?.clickable : true;
            const ratio = clickInfo ? clickInfo[i]?.ratio : 1;
            const isSel = i === selected;
            const spriteHref = cardSpriteHref(s);
            return (
              <g
                key={i}
                transform={`translate(${rx},${ry})`}
                onPointerDown={(e) => onPointerDownSlot(e, i)}
                onDoubleClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setSelected(i);
                  setPickerIndex(i);
                }}
              >
                <title>
                  {`Index: ${i}
X: ${s.X}
Y: ${s.Y}
Layer: ${s.Layer}
Suit: ${s.Suit}
Rank: ${s.Rank}
VisibleRatio: ${(ratio * 100).toFixed(0)}%`}
                </title>
                <rect
                  width={w}
                  height={h}
                  rx={4}
                  fill={isSel ? "#4b6fb8" : "#50648c"}
                  stroke={isSel ? "var(--accent)" : clickable ? "#5a6a88" : "#444"}
                  strokeWidth={isSel ? 2 : 1}
                />
                {spriteHref ? (
                  <image
                    href={spriteHref}
                    width={w}
                    height={h}
                    preserveAspectRatio="xMidYMid meet"
                    opacity={clickable ? 1 : 0.55}
                    style={{ pointerEvents: "none" }}
                  />
                ) : null}
                <text
                  x={4}
                  y={h - 18}
                  fill="#ffe35c"
                  stroke="#10131a"
                  strokeWidth={2.5}
                  paintOrder="stroke"
                  fontSize={10}
                  fontWeight={800}
                  style={{ pointerEvents: "none" }}
                >
                  #{i} L{s.Layer}
                </text>
                {!spriteHref ? (
                  <text
                    x={w / 2}
                    y={h / 2 + 5}
                    textAnchor="middle"
                    fill="#9aa8c8"
                    fontSize={13}
                    style={{ pointerEvents: "none" }}
                  >
                    {slotFaceLabel(s)}
                  </text>
                ) : null}
                {clickInfo ? (
                  <text x={4} y={h - 6} fill="#9aa8c8" fontSize={9} style={{ pointerEvents: "none" }}>
                    {(ratio * 100).toFixed(0)}%
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>
      {pickerSlot ? (
        <div
          className="panel"
          style={{
            position: "fixed",
            right: 24,
            bottom: 24,
            width: 520,
            maxWidth: "calc(100vw - 48px)",
            maxHeight: "calc(100vh - 48px)",
            overflow: "auto",
            zIndex: 10,
            boxShadow: "0 18px 60px rgba(0,0,0,0.45)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <strong>选择槽位 #{pickerIndex} 固定牌面</strong>
            <button type="button" onClick={() => setPickerIndex(-1)}>
              关闭
            </button>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
            <button
              type="button"
              className={pickerSlot.Suit === "N" ? "primary" : ""}
              onClick={() => updateSlot(pickerIndex, { Suit: "N", Rank: 0 })}
            >
              不固定（N/0）
            </button>
            <span style={{ color: "var(--muted)" }}>当前：{slotFaceLabel(pickerSlot)}</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(13, minmax(0, 1fr))", gap: 6 }}>
            {(["H", "D", "C", "S"] as const).flatMap((suit) =>
              Array.from({ length: RANK_MAX - RANK_MIN + 1 }, (_, i) => RANK_MIN + i).map((rank) => {
                const slot = { ...pickerSlot, Suit: suit, Rank: rank };
                const href = cardSpriteHref(slot);
                const active = pickerSlot.Suit === suit && pickerSlot.Rank === rank;
                return (
                  <button
                    key={`${suit}-${rank}`}
                    type="button"
                    title={`${suit}${rankLabel(rank)}`}
                    onClick={() => updateSlot(pickerIndex, { Suit: suit, Rank: rank })}
                    style={{
                      padding: 2,
                      borderColor: active ? "var(--accent)" : "var(--border)",
                      background: active ? "#2a3f7a" : "#0a0d12",
                    }}
                  >
                    {href ? (
                      <img
                        src={href}
                        alt={`${suit}${rankLabel(rank)}`}
                        style={{ display: "block", width: "100%", aspectRatio: "42 / 66", objectFit: "contain" }}
                      />
                    ) : (
                      `${suit}${rankLabel(rank)}`
                    )}
                  </button>
                );
              }),
            )}
          </div>
        </div>
      ) : null}
      <div style={{ color: "var(--muted)", fontSize: 11 }}>
        单击或拖拽移动槽位；双击槽位选择固定牌面，N/0 表示不固定。遮挡可点预览需 BoardLayout 槽位数等于 TotalCards。可点阈值与运行时一致（可见比例 ≥ 70%）。
      </div>
    </div>
  );
}
