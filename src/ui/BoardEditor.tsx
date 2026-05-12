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
  isSingleDeck: boolean;
  boardLayout: LevelBoardSlotData[];
  specialWild: number;
  specialMultiplier: number;
  specialSuit: number;
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
const NORMAL_CARD_SUITS = ["H", "D", "C", "S"] as const;
const preloadedCardSprites = new Set<string>();

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
    const pad = 80;
    return {
      minX: -80,
      maxX: 80,
      minY: SNAP_ORIGIN_Y - pad,
      maxY: SNAP_ORIGIN_Y + pad,
    };
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

function specialSpriteHref(special: NonNullable<LevelBoardSlotData["Special"]>): string | null {
  if (special === "Wild") {
    return publicAssetPath("sprites/cards/wild.png");
  }
  if (special === "Multiplier") {
    return publicAssetPath("sprites/cards/multiplier.png");
  }
  if (special === "SuitH" || special === "SuitD" || special === "SuitC" || special === "SuitS") {
    return publicAssetPath("sprites/cards/suit.png");
  }
  return null;
}

function allNormalCardSpriteHrefs(): string[] {
  return NORMAL_CARD_SUITS.flatMap((suit) =>
    Array.from({ length: RANK_MAX - RANK_MIN + 1 }, (_, i) =>
      cardSpriteHref({ X: 0, Y: 0, Layer: 0, Suit: suit, Rank: RANK_MIN + i }),
    ),
  ).filter((href): href is string => Boolean(href));
}

function preloadCardSprites(): void {
  for (const href of allNormalCardSpriteHrefs()) {
    if (preloadedCardSprites.has(href)) {
      continue;
    }
    preloadedCardSprites.add(href);
    const img = new Image();
    img.src = href;
  }
}

export function BoardEditor({
  totalCards,
  isSingleDeck,
  boardLayout,
  specialWild,
  specialMultiplier,
  specialSuit,
  onChange,
  onTotalCardsChange,
  focusSlotIndex,
  onFocusSlotConsumed,
}: Props) {
  const [selected, setSelected] = useState<number>(-1);
  const [pickerIndex, setPickerIndex] = useState<number>(-1);
  const [specialPicker, setSpecialPicker] = useState<"" | "Wild" | "Multiplier" | "SuitH" | "SuitD" | "SuitC" | "SuitS">("");
  const [visibleLayers, setVisibleLayers] = useState<number[] | null>(null);
  const [layerDropdownOpen, setLayerDropdownOpen] = useState(false);
  const layerDropdownRef = useRef<HTMLDivElement | null>(null);
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

  const placedSpecialCounts = useMemo(() => {
    let wild = 0;
    let mult = 0;
    let suit = 0;
    for (const s of boardLayout) {
      const sp = typeof s?.Special === "string" ? s.Special : "";
      if (sp === "Wild") wild++;
      else if (sp === "Multiplier") mult++;
      else if (sp === "SuitH" || sp === "SuitD" || sp === "SuitC" || sp === "SuitS") suit++;
    }
    return { wild, mult, suit };
  }, [boardLayout]);

  const remainSpecial = useMemo(
    () => ({
      wild: Math.max(0, Math.trunc(specialWild) - placedSpecialCounts.wild),
      mult: Math.max(0, Math.trunc(specialMultiplier) - placedSpecialCounts.mult),
      suit: Math.max(0, Math.trunc(specialSuit) - placedSpecialCounts.suit),
    }),
    [specialWild, specialMultiplier, specialSuit, placedSpecialCounts],
  );

  const layerOptions = useMemo(() => {
    const set = new Set<number>();
    for (const s of boardLayout) {
      set.add(s.Layer);
    }
    return Array.from(set).sort((a, b) => a - b);
  }, [boardLayout]);

  const visibleLayerSet = useMemo(() => (visibleLayers ? new Set(visibleLayers) : null), [visibleLayers]);

  const displayedIndices = useMemo(() => {
    if (!visibleLayerSet) {
      return boardLayout.map((_, i) => i);
    }
    const out: number[] = [];
    for (let i = 0; i < boardLayout.length; i++) {
      if (visibleLayerSet.has(boardLayout[i].Layer)) {
        out.push(i);
      }
    }
    return out;
  }, [boardLayout, visibleLayerSet]);

  const layerSummaryText = useMemo(() => {
    if (!layerOptions.length) {
      return "已选择全部层";
    }
    if (!visibleLayers || visibleLayers.length === layerOptions.length) {
      return "已选择全部层";
    }
    return `已选择${visibleLayers.join("/")}层`;
  }, [layerOptions, visibleLayers]);

  const toggleLayerVisible = useCallback(
    (layer: number) => {
      setVisibleLayers((prev) => {
        const all = layerOptions;
        const base = prev ?? [...all];
        const has = base.includes(layer);
        const next = has ? base.filter((x) => x !== layer) : [...base, layer].sort((a, b) => a - b);
        if (next.length === 0 || next.length === all.length) {
          return null;
        }
        return next;
      });
    },
    [layerOptions],
  );

  useEffect(() => {
    if (!layerDropdownOpen) {
      return;
    }
    const onPointerDown = (e: MouseEvent) => {
      if (!layerDropdownRef.current?.contains(e.target as Node)) {
        setLayerDropdownOpen(false);
      }
    };
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [layerDropdownOpen]);

  const hasFixedBoardCards = useMemo(
    () => boardLayout.some((slot) => slot.Suit !== "N" && slot.Rank >= RANK_MIN && slot.Rank <= RANK_MAX),
    [boardLayout],
  );

  const isCardUsedByOtherSlot = useCallback(
    (suit: string, rank: number, currentIndex: number): boolean =>
      isSingleDeck &&
      boardLayout.some((slot, index) => index !== currentIndex && slot.Suit === suit && slot.Rank === rank),
    [boardLayout, isSingleDeck],
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

  const toggleSpecialOnSlot = useCallback(
    (slotIndex: number) => {
      if (!specialPicker) {
        return;
      }
      const cur = boardLayout[slotIndex];
      if (!cur) return;
      const curSp = typeof cur.Special === "string" ? cur.Special : "";
      const isSuitPick =
        specialPicker === "SuitH" || specialPicker === "SuitD" || specialPicker === "SuitC" || specialPicker === "SuitS";
      const isSameType =
        curSp === specialPicker ||
        (isSuitPick && (curSp === "SuitH" || curSp === "SuitD" || curSp === "SuitC" || curSp === "SuitS") && curSp === specialPicker);

      const hasRemain =
        specialPicker === "Wild"
          ? remainSpecial.wild > 0
          : specialPicker === "Multiplier"
            ? remainSpecial.mult > 0
            : remainSpecial.suit > 0;

      // Allow remove even if remaining is 0.
      if (curSp && isSameType) {
        updateSlot(slotIndex, { Special: "" });
        return;
      }
      if (!hasRemain) {
        return;
      }
      updateSlot(slotIndex, { Special: specialPicker });
    },
    [boardLayout, remainSpecial, specialPicker, updateSlot],
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

  useEffect(() => {
    preloadCardSprites();
  }, []);

  const onPointerDownSlot = (e: React.PointerEvent, index: number) => {
    setSelected(index);
    if (pickerIndex >= 0) {
      setPickerIndex(index);
      dragRef.current = null;
      return;
    }
    (e.currentTarget as SVGGElement).setPointerCapture(e.pointerId);
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
        <span style={{ color: "var(--muted)", fontSize: 12 }}>小丑牌放置：</span>
        <button
          type="button"
          onClick={() => setSpecialPicker((p) => (p === "Wild" ? "" : "Wild"))}
          disabled={remainSpecial.wild <= 0 && specialPicker !== "Wild"}
          title={remainSpecial.wild <= 0 ? "万能小丑已用完（可点已放置的槽位取消）" : "选择后单击槽位放置/取消"}
          style={{ background: specialPicker === "Wild" ? "#243049" : undefined }}
        >
          万能（{remainSpecial.wild}/{Math.max(0, Math.trunc(specialWild))}）
        </button>
        <button
          type="button"
          onClick={() => setSpecialPicker((p) => (p === "Multiplier" ? "" : "Multiplier"))}
          disabled={remainSpecial.mult <= 0 && specialPicker !== "Multiplier"}
          title={remainSpecial.mult <= 0 ? "倍率小丑已用完（可点已放置的槽位取消）" : "选择后单击槽位放置/取消"}
          style={{ background: specialPicker === "Multiplier" ? "#243049" : undefined }}
        >
          倍率（{remainSpecial.mult}/{Math.max(0, Math.trunc(specialMultiplier))}）
        </button>
        <button
          type="button"
          onClick={() => setSpecialPicker((p) => (p.startsWith("Suit") ? "" : "SuitH"))}
          disabled={remainSpecial.suit <= 0 && !specialPicker.startsWith("Suit")}
          title={remainSpecial.suit <= 0 ? "变化小丑已用完（可点已放置的槽位取消）" : "选择后单击槽位放置/取消；可选花色版本"}
          style={{ background: specialPicker.startsWith("Suit") ? "#243049" : undefined }}
        >
          变化（{remainSpecial.suit}/{Math.max(0, Math.trunc(specialSuit))}）
        </button>
        {specialPicker.startsWith("Suit") ? (
          <select value={specialPicker} onChange={(e) => setSpecialPicker(e.target.value as any)} style={{ height: 32 }}>
            <option value="SuitH">♥</option>
            <option value="SuitD">♦</option>
            <option value="SuitC">♣</option>
            <option value="SuitS">♠</option>
          </select>
        ) : null}
        {specialPicker ? <span style={{ color: "var(--accent)", fontSize: 12 }}>已进入放置模式：单击槽位放置/取消</span> : null}
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
        <div ref={layerDropdownRef} style={{ position: "relative", display: "flex", alignItems: "center", gap: 6 }}>
          <span>层级筛选</span>
          <button type="button" onClick={() => setLayerDropdownOpen((v) => !v)} aria-expanded={layerDropdownOpen} title="点击展开层级筛选">
            {layerSummaryText} {layerDropdownOpen ? "▴" : "▾"}
          </button>
          {layerDropdownOpen ? (
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 6px)",
                left: 68,
                minWidth: 170,
                maxHeight: 220,
                overflow: "auto",
                border: "1px solid var(--border)",
                borderRadius: 8,
                background: "var(--panel)",
                padding: 6,
                zIndex: 20,
                boxShadow: "0 10px 24px rgba(0,0,0,0.35)",
              }}
            >
              {layerOptions.map((layer) => (
                <button
                  key={layer}
                  type="button"
                  onClick={() => toggleLayerVisible(layer)}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 4,
                    background: visibleLayerSet?.has(layer) || (!visibleLayerSet && layerOptions.length > 0) ? "#243049" : undefined,
                  }}
                >
                  <span>层 {layer}</span>
                  <span>{visibleLayerSet?.has(layer) || (!visibleLayerSet && layerOptions.length > 0) ? "✓" : ""}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <button type="button" onClick={() => setVisibleLayers(null)}>
          显示全部层
        </button>
        <span style={{ color: "var(--muted)", fontSize: 12 }}>
          {visibleLayers ? `当前显示层：${visibleLayers.join(", ")}` : "当前显示层：全部"}
        </span>
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
                const nextRank =
                  suit === "N" ? 0 : selectedSlot.Rank >= RANK_MIN && selectedSlot.Rank <= RANK_MAX ? selectedSlot.Rank : RANK_MIN;
                if (suit !== "N" && isCardUsedByOtherSlot(suit, nextRank, selected)) {
                  return;
                }
                updateSlot(selected, {
                  Suit: suit,
                  Rank: nextRank,
                });
              }}
            >
              {BOARD_SUIT_CODES.map((s) => (
                <option
                  key={s}
                  value={s}
                  disabled={s !== "N" && isCardUsedByOtherSlot(s, selectedSlot.Rank, selected)}
                >
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
                if (selectedSlot.Suit !== "N" && isCardUsedByOtherSlot(selectedSlot.Suit, rank, selected)) {
                  return;
                }
                updateSlot(selected, { Rank: selectedSlot.Suit === "N" ? 0 : rank });
              }}
            >
              <option value={0}>0</option>
              {Array.from({ length: RANK_MAX - RANK_MIN + 1 }, (_, i) => RANK_MIN + i).map((r) => (
                <option key={r} value={r} disabled={isCardUsedByOtherSlot(selectedSlot.Suit, r, selected)}>
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
            stroke="var(--accent)"
            strokeWidth={1.5}
            strokeDasharray="6 4"
          />
          <text
            x={vb.x + 6}
            y={SNAP_ORIGIN_Y - 4}
            fill="var(--muted)"
            fontSize={10}
            style={{ pointerEvents: "none" }}
          >
            Y 基准 ({SNAP_ORIGIN_Y})
          </text>
          <line
            x1={SNAP_ORIGIN_X}
            y1={vb.y}
            x2={SNAP_ORIGIN_X}
            y2={vb.y + vb.h}
            stroke="#2a3344"
            strokeWidth={1}
          />
          {displayedIndices.map((i) => {
            const s = boardLayout[i];
            const w = SOURCE_CARD_WIDTH;
            const h = SOURCE_CARD_HEIGHT;
            const rx = s.X - w / 2;
            const ry = s.Y - h / 2;
            const clickable = clickInfo ? clickInfo[i]?.clickable : true;
            const ratio = clickInfo ? clickInfo[i]?.ratio : 1;
            const isSel = i === selected;
            const spriteHref = s.Special ? specialSpriteHref(s.Special) : cardSpriteHref(s);
            return (
              <g
                key={i}
                transform={`translate(${rx},${ry})`}
                onPointerDown={(e) => onPointerDownSlot(e, i)}
                onClick={(e) => {
                  if (!specialPicker) {
                    return;
                  }
                  e.preventDefault();
                  e.stopPropagation();
                  toggleSpecialOnSlot(i);
                }}
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
              className={pickerSlot.Suit === "N" && !pickerSlot.Special ? "primary" : ""}
              onClick={() => updateSlot(pickerIndex, { Suit: "N", Rank: 0, Special: "" })}
            >
              不固定（N/0）
            </button>
            <span style={{ color: "var(--muted)" }}>
              当前：{pickerSlot.Special ? `Special:${pickerSlot.Special}` : slotFaceLabel(pickerSlot)}
            </span>
          </div>
          <div style={{ marginBottom: 10 }}>
            <div style={{ marginBottom: 6, color: "var(--muted)", fontSize: 12 }}>小丑牌</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: 6 }}>
              {(
                [
                  { key: "Wild", label: "万能" },
                  { key: "Multiplier", label: "倍率" },
                  { key: "SuitH", label: "变化-H" },
                  { key: "SuitD", label: "变化-D" },
                  { key: "SuitC", label: "变化-C" },
                  { key: "SuitS", label: "变化-S" },
                ] as const
              ).map((item) => {
                const href = specialSpriteHref(item.key);
                const active = pickerSlot.Special === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => updateSlot(pickerIndex, { Suit: "N", Rank: 0, Special: item.key })}
                    style={{
                      padding: 2,
                      borderColor: active ? "var(--accent)" : "var(--border)",
                      background: active ? "#2a3f7a" : "#0a0d12",
                    }}
                    title={item.label}
                  >
                    {href ? (
                      <img src={href} alt={item.label} style={{ display: "block", width: "100%", aspectRatio: "42 / 66", objectFit: "contain" }} />
                    ) : (
                      item.label
                    )}
                    <div style={{ fontSize: 10, marginTop: 2 }}>{item.label}</div>
                  </button>
                );
              })}
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(13, minmax(0, 1fr))", gap: 6 }}>
            {NORMAL_CARD_SUITS.flatMap((suit) =>
              Array.from({ length: RANK_MAX - RANK_MIN + 1 }, (_, i) => RANK_MIN + i).map((rank) => {
                const slot = { ...pickerSlot, Suit: suit, Rank: rank };
                const href = cardSpriteHref(slot);
                const active = !pickerSlot.Special && pickerSlot.Suit === suit && pickerSlot.Rank === rank;
                const usedByOtherSlot = isCardUsedByOtherSlot(suit, rank, pickerIndex);
                return (
                  <button
                    key={`${suit}-${rank}`}
                    type="button"
                    title={usedByOtherSlot ? `${suit}${rankLabel(rank)} 已被其他槽位使用` : `${suit}${rankLabel(rank)}`}
                    disabled={usedByOtherSlot}
                    onClick={() => {
                      if (!usedByOtherSlot) {
                        updateSlot(pickerIndex, { Suit: suit, Rank: rank, Special: "" });
                      }
                    }}
                    style={{
                      padding: 2,
                      borderColor: active ? "var(--accent)" : "var(--border)",
                      background: active ? "#2a3f7a" : "#0a0d12",
                      opacity: usedByOtherSlot ? 0.28 : 1,
                      cursor: usedByOtherSlot ? "not-allowed" : "pointer",
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
        坐标与数据一致：预览为浏览器 SVG 惯例，<strong>Y 轴向下为正</strong>（数值越大越靠画面下方）；青色虚线为数据 Y = {SNAP_ORIGIN_Y} 的基准行。若运行时世界坐标 Y 向上，请在客户端对 BoardLayout.Y 做符号换算。
      </div>
    </div>
  );
}
