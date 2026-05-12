import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LevelWinConditionMode, RANK_MAX, RANK_MIN, SUIT_CODES, HAND_TYPES } from "./domain/enums";
import { createDefaultLevel } from "./domain/defaultLevel";
import { cloneLevel } from "./domain/levelClone";
import {
  levelFileNameForId,
  normalizeLevelConfig,
  parseLevelIdFromFileName,
  type LevelConfigData,
  type LevelFileSummary,
} from "./domain/levelTypes";
import {
  isLevelDirty,
  loadLevelsFromDirectory,
  nextLevelIdFromFiles,
  persistLevel,
  serializeLevelJson,
  type LoadedLevelFile,
} from "./storage/fsLevelStorage";
import { validateLevel } from "./validation/validateLevel";
import { BoardEditor } from "./ui/BoardEditor";
import { LevelList, type ListFilter } from "./ui/LevelList";
import { ValidationPanel } from "./ui/ValidationPanel";
import { PoolStatsPanel } from "./ui/PoolStatsPanel";
import { HandTypeUpperBoundsPanel } from "./ui/HandTypeUpperBoundsPanel";
import { buildMultisetFromBoardLayout, buildPoolMultiset, computeHandTypeUpperBounds } from "./domain/poolStats";
import { LevelPreviewPage } from "./ui/LevelPreviewPage";
import {
  generateUniqueLevelSeed,
  randomizeBoardLayoutSlotRanks,
  randomizeBoardLayoutSlotSuits,
  randomizeBoardLayoutSlotSuitsAndRanks,
} from "./domain/levelPoolRandom";
import { mergeLevelFromJsonFragment } from "./domain/mergeLevelFromPartial";

function parseSeedUint32(text: string): number | null {
  const t = text.trim().replace(/\s+/g, "");
  if (t === "") {
    return 0;
  }
  if (!/^\d+$/.test(t)) {
    return null;
  }
  if (t.length > 10) {
    return null;
  }
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) {
    return null;
  }
  if (n > 0xffffffff) {
    return null;
  }
  return n >>> 0;
}

function hasFsAccess(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

const WIN_MODE_LABELS: Record<number, string> = {
  [LevelWinConditionMode.ScoreOnly]: "仅分数",
  [LevelWinConditionMode.ObjectivesOnly]: "仅目标",
  [LevelWinConditionMode.ScoreAndObjectives]: "分数且目标",
  [LevelWinConditionMode.ScoreOrObjectives]: "分数或目标",
};

const HAND_TYPE_LABELS: Record<string, string> = {
  HighCard: "高牌",
  Pair: "一对",
  TwoPair: "两对",
  ThreeOfAKind: "三条",
  Straight: "顺子",
  Flush: "同花",
  FullHouse: "葫芦",
  FourOfAKind: "四条",
  StraightFlush: "同花顺",
  RoyalFlush: "皇家同花顺",
};

const OBJECTIVE_REACH_LABEL: Record<"ok" | "risk" | "no", string> = {
  ok: "可达",
  risk: "边界",
  no: "不可达",
};

function browserHintName(): string {
  if (typeof navigator === "undefined") {
    return "当前浏览器";
  }
  const ua = navigator.userAgent;
  if (ua.includes("Edg/")) {
    return "Edge";
  }
  if (ua.includes("Chrome/") && !ua.includes("Edg/")) {
    return "Chrome";
  }
  if (ua.includes("Firefox/")) {
    return "Firefox";
  }
  if (ua.includes("Safari/") && !ua.includes("Chrome/")) {
    return "Safari";
  }
  return "当前浏览器";
}

function downloadText(fileName: string, text: string): void {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

function cacheKeyForFile(fileName: string): string {
  return `joker.levelEditor.cache.${fileName}`;
}

const SESSION_FILES_KEY = "joker.levelEditor.sessionFiles.v1";

function tryLoadCachedLevel(fileName: string): LevelConfigData | null {
  try {
    const raw = localStorage.getItem(cacheKeyForFile(fileName));
    if (!raw) {
      return null;
    }
    return normalizeLevelConfig(JSON.parse(raw));
  } catch {
    return null;
  }
}

function trySaveCachedLevel(fileName: string, data: LevelConfigData): void {
  try {
    localStorage.setItem(cacheKeyForFile(fileName), serializeLevelJson(data));
  } catch {
    // ignore
  }
}

function tryClearCachedLevel(fileName: string): void {
  try {
    localStorage.removeItem(cacheKeyForFile(fileName));
  } catch {
    // ignore
  }
}

type SessionFile = {
  fileName: string;
  data: LevelConfigData;
  baselineJson: string;
};

type EditHistory = {
  undo: LevelConfigData[];
  redo: LevelConfigData[];
};

function tryLoadSessionFiles(): LoadedLevelFile[] {
  try {
    const raw = localStorage.getItem(SESSION_FILES_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    const out: LoadedLevelFile[] = [];
    for (const item of parsed as SessionFile[]) {
      if (!item || typeof item !== "object") {
        continue;
      }
      const fileName = typeof item.fileName === "string" ? item.fileName : "";
      if (!fileName) {
        continue;
      }
      const normalized = normalizeLevelConfig((item as SessionFile).data);
      if (!normalized) {
        continue;
      }
      const legacy = item as SessionFile & { dirty?: boolean };
      const baselineJson =
        typeof legacy.baselineJson === "string"
          ? legacy.baselineJson
          : serializeLevelJson(normalized);
      // Note: fileHandle cannot survive refresh; user must re-pick directory to save to disk.
      out.push({ fileName, data: normalized, baselineJson });
    }
    return out;
  } catch {
    return [];
  }
}

function trySaveSessionFiles(files: LoadedLevelFile[]): void {
  try {
    const serializable: SessionFile[] = files.map((f) => ({
      fileName: f.fileName,
      data: f.data,
      baselineJson: f.baselineJson,
    }));
    localStorage.setItem(SESSION_FILES_KEY, JSON.stringify(serializable));
  } catch {
    // ignore
  }
}

export default function App() {
  const fsSupported = hasFsAccess();
  const browserName = browserHintName();
  const [dirHandle, setDirHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [files, setFiles] = useState<LoadedLevelFile[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [search, setSearch] = useState("");
  const [listFilter, setListFilter] = useState<ListFilter>("all");
  const [status, setStatus] = useState("");
  const [focusSlotIndex, setFocusSlotIndex] = useState<number | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const seedMergeInputRef = useRef<HTMLInputElement>(null);
  const selectedIndexRef = useRef(0);
  const [seedDraft, setSeedDraft] = useState("");
  const [previewLevel, setPreviewLevel] = useState<LevelConfigData | null>(null);
  const editHistoryRef = useRef<Record<string, EditHistory>>({});

  const historyKeyOf = useCallback((fileName: string) => fileName, []);

  const getHistory = useCallback(
    (fileName: string): EditHistory => {
      const key = historyKeyOf(fileName);
      if (!editHistoryRef.current[key]) {
        editHistoryRef.current[key] = { undo: [], redo: [] };
      }
      return editHistoryRef.current[key];
    },
    [historyKeyOf],
  );

  const summaries: LevelFileSummary[] = useMemo(
    () =>
      files.map((f) => ({
        fileName: f.fileName,
        levelId: parseLevelIdFromFileName(f.fileName),
      })),
    [files],
  );

  const current = files[selectedIndex] ?? null;
  selectedIndexRef.current = selectedIndex;
  const validation = useMemo(
    () => validateLevel(current?.data ?? null, summaries),
    [current, summaries],
  );

  const reachabilitySource = useMemo(() => {
    if (!current) {
      return { multiset: null as ReturnType<typeof buildPoolMultiset> | null, sourceLabel: "无数据" };
    }
    const board = buildMultisetFromBoardLayout(current.data);
    if (board.totalCards > 0) {
      return { multiset: board, sourceLabel: "棋盘预览" };
    }
    const pool = buildPoolMultiset(current.data);
    if (pool.totalCards > 0) {
      return { multiset: pool, sourceLabel: "花色池配置" };
    }
    return { multiset: null as ReturnType<typeof buildPoolMultiset> | null, sourceLabel: "无数据" };
  }, [current]);

  const objectiveReachState = useMemo(() => {
    const out: Array<{ status: "ok" | "risk" | "no"; upper: number | null }> = [];
    if (!current) {
      return out;
    }
    const upper = reachabilitySource.multiset ? computeHandTypeUpperBounds(reachabilitySource.multiset) : null;
    for (const obj of current.data.Objectives) {
      if (!obj || !upper || !(obj.HandType in upper) || obj.Count <= 0) {
        out.push({ status: "risk", upper: null });
        continue;
      }
      const cap = upper[obj.HandType as keyof typeof upper];
      if (cap > obj.Count) {
        out.push({ status: "ok", upper: cap });
      } else if (cap === obj.Count) {
        out.push({ status: "risk", upper: cap });
      } else {
        out.push({ status: "no", upper: cap });
      }
    }
    return out;
  }, [current, reachabilitySource.multiset]);

  useEffect(() => {
    if (current) {
      setSeedDraft(String(current.data.Seed >>> 0));
    } else {
      setSeedDraft("");
    }
  }, [current, current?.data.Seed, selectedIndex]);

  // Restore last session list on refresh (works even without directory permission).
  useEffect(() => {
    const restored = tryLoadSessionFiles();
    if (restored.length > 0) {
      setFiles(restored);
      setSelectedIndex(0);
      setStatus("已从本地缓存恢复上次会话（重新选择目录后才能保存到磁盘）");
    }
    // run once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Local cache (draft) — keeps unsaved edits after refresh/reopen.
  useEffect(() => {
    trySaveSessionFiles(files);
    for (const f of files) {
      if (!isLevelDirty(f)) {
        continue;
      }
      trySaveCachedLevel(f.fileName, f.data);
    }
  }, [files]);

  const updateData = useCallback(
    (updater: (d: LevelConfigData) => LevelConfigData) => {
      setFiles((prev) => {
        if (selectedIndex < 0 || selectedIndex >= prev.length) {
          return prev;
        }
        const next = [...prev];
        const row = next[selectedIndex];
        const prevData = cloneLevel(row.data);
        const nextData = updater(cloneLevel(row.data));
        const before = serializeLevelJson(prevData);
        const after = serializeLevelJson(nextData);
        if (before === after) {
          return prev;
        }
        const history = getHistory(row.fileName);
        history.undo.push(prevData);
        if (history.undo.length > 100) {
          history.undo.shift();
        }
        history.redo = [];
        next[selectedIndex] = {
          ...row,
          data: nextData,
        };
        return next;
      });
    },
    [getHistory, selectedIndex],
  );

  const undoCurrent = useCallback(() => {
    if (!current) {
      setStatus("当前无可撤销内容。");
      return;
    }
    const history = getHistory(current.fileName);
    const previous = history.undo.pop();
    if (!previous) {
      setStatus("已到最早修改记录。");
      return;
    }
    history.redo.push(cloneLevel(current.data));
    setFiles((prev) => {
      if (selectedIndex < 0 || selectedIndex >= prev.length) {
        return prev;
      }
      const next = [...prev];
      const row = next[selectedIndex];
      next[selectedIndex] = {
        ...row,
        data: cloneLevel(previous),
      };
      return next;
    });
    setStatus("已撤销一步（Ctrl/Cmd+Z）");
  }, [current, getHistory, selectedIndex]);

  const redoCurrent = useCallback(() => {
    if (!current) {
      setStatus("当前无可重做内容。");
      return;
    }
    const history = getHistory(current.fileName);
    const nextData = history.redo.pop();
    if (!nextData) {
      setStatus("没有可重做的修改。");
      return;
    }
    history.undo.push(cloneLevel(current.data));
    setFiles((prev) => {
      if (selectedIndex < 0 || selectedIndex >= prev.length) {
        return prev;
      }
      const next = [...prev];
      const row = next[selectedIndex];
      next[selectedIndex] = {
        ...row,
        data: cloneLevel(nextData),
      };
      return next;
    });
    setStatus("已重做一步（Ctrl+Y / Ctrl/Cmd+Shift+Z）");
  }, [current, getHistory, selectedIndex]);

  const pickDirectory = async () => {
    if (!hasFsAccess()) {
      setStatus("当前浏览器不支持目录访问，请使用 Chrome / Edge，或使用「导入 JSON」。");
      return;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const handle = await (window as any).showDirectoryPicker({ mode: "readwrite" });
      setDirHandle(handle);
      const loadedRaw = await loadLevelsFromDirectory(handle);
      const loaded = loadedRaw.map((f) => {
        const diskJson = f.baselineJson;
        const cached = tryLoadCachedLevel(f.fileName);
        if (!cached) {
          return f;
        }
        return {
          ...f,
          data: cached,
          baselineJson: diskJson,
        };
      });
      setFiles(loaded);
      setSelectedIndex(loaded.length > 0 ? 0 : 0);
      setStatus(`已加载 ${loaded.length} 个关卡文件`);
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setStatus(`打开目录失败：${(e as Error).message}`);
      }
    }
  };

  const saveCurrent = async () => {
    if (!dirHandle || !current) {
      setStatus("请先选择工程目录（Assets/Game/Level）。");
      return;
    }
    if (!current.fileHandle) {
      setStatus("当前关卡是从本地会话缓存恢复的：请先重新选择目录以获取写入权限与文件句柄。");
      return;
    }
    const errs = validateLevel(current.data, summaries).filter((m) => m.severity === "error");
    if (errs.length > 0) {
      setStatus("存在校验错误，请修正后再保存。");
      return;
    }
    const prevName = current.fileName;
    const idChanged = parseLevelIdFromFileName(prevName) !== current.data.Id;
    if (idChanged) {
      const ok = window.confirm(
        `关卡 Id 已改为 ${current.data.Id}，保存将重命名为 ${levelFileNameForId(current.data.Id)}，并删除旧文件 ${prevName}（若存在）。继续？`,
      );
      if (!ok) {
        return;
      }
    }
    try {
      const { fileName, fileHandle } = await persistLevel(dirHandle, current, prevName);
      setFiles((prev) => {
        const next = [...prev];
        const row = next[selectedIndex];
        next[selectedIndex] = {
          ...row,
          fileName,
          fileHandle,
          baselineJson: serializeLevelJson(row.data),
        };
        return next;
      });
      if (fileName !== prevName) {
        const oldKey = historyKeyOf(prevName);
        const newKey = historyKeyOf(fileName);
        if (editHistoryRef.current[oldKey]) {
          editHistoryRef.current[newKey] = editHistoryRef.current[oldKey];
          delete editHistoryRef.current[oldKey];
        }
      }
      setStatus(`已保存 ${fileName}`);
      tryClearCachedLevel(fileName);
      if (fileName !== prevName) {
        tryClearCachedLevel(prevName);
      }
    } catch (e) {
      setStatus(`保存失败：${(e as Error).message}`);
    }
  };

  const newLevel = () => {
    const id = nextLevelIdFromFiles(files);
    const data = createDefaultLevel(id);
    const row: LoadedLevelFile = {
      fileName: levelFileNameForId(id),
      data,
      baselineJson: serializeLevelJson(data),
    };
    setFiles((p) => [...p, row]);
    setSelectedIndex(files.length);
    setStatus(`新建关卡 ${id}（未写入磁盘前请保存）`);
  };

  const copyLevel = () => {
    if (!current) {
      return;
    }
    const id = nextLevelIdFromFiles(files);
    const data = cloneLevel(current.data);
    data.Id = id;
    const row: LoadedLevelFile = {
      fileName: levelFileNameForId(id),
      data,
      baselineJson: serializeLevelJson(data),
    };
    setFiles((p) => [...p, row]);
    setSelectedIndex(files.length);
    setStatus(`已复制为新关卡 ${id}`);
  };

  const deleteLevel = async () => {
    if (!current) {
      return;
    }
    if (!window.confirm(`确定删除 / 移除 ${current.fileName}？`)) {
      return;
    }
    if (!current.fileHandle || !dirHandle) {
      const next = files.filter((_, i) => i !== selectedIndex);
      const newIdx = Math.min(selectedIndex, Math.max(0, next.length - 1));
      setFiles(next);
      setSelectedIndex(newIdx);
      tryClearCachedLevel(current.fileName);
      setStatus("已从编辑列表移除（未删除磁盘文件）");
      return;
    }
    try {
      await dirHandle.removeEntry(current.fileName);
      const next = files.filter((_, i) => i !== selectedIndex);
      const newIdx = Math.min(selectedIndex, Math.max(0, next.length - 1));
      setFiles(next);
      setSelectedIndex(newIdx);
      tryClearCachedLevel(current.fileName);
      setStatus("已从磁盘删除");
    } catch (e) {
      setStatus(`删除失败：${(e as Error).message}`);
    }
  };

  const trySelect = (index: number) => {
    const target = files[index];
    if (!target) {
      return;
    }
    const cur = files[selectedIndex];
    if (cur && isLevelDirty(cur) && index !== selectedIndex) {
      if (!window.confirm("当前关卡有未保存修改，确定切换？")) {
        return;
      }
    }
    setSelectedIndex(index);
  };

  const onImportFiles = async (list: FileList | null) => {
    if (!list?.length) {
      return;
    }
    const added: LoadedLevelFile[] = [];
    for (let i = 0; i < list.length; i++) {
      const file = list[i];
      const text = await file.text();
      try {
        const data = normalizeLevelConfig(JSON.parse(text));
        if (!data) {
          continue;
        }
        added.push({
          fileName: levelFileNameForId(data.Id),
          data,
          baselineJson: serializeLevelJson(data),
        });
      } catch {
        /* skip */
      }
    }
    if (added.length) {
      setFiles((p) => [...p, ...added]);
      setSelectedIndex(files.length);
      setStatus(`已导入 ${added.length} 个 JSON（未选目录时请用导出下载写回）`);
    }
    importInputRef.current!.value = "";
  };

  const exportCurrent = () => {
    if (!current) {
      return;
    }
    downloadText(levelFileNameForId(current.data.Id), serializeLevelJson(current.data));
  };

  const clearCurrentCache = () => {
    if (!current) {
      return;
    }
    tryClearCachedLevel(current.fileName);
    setStatus("已清理当前关卡本地缓存（不影响磁盘文件）");
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing) {
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) {
        return;
      }
      const key = e.key.toLowerCase();
      if (key === "s") {
        e.preventDefault();
        void saveCurrent();
        return;
      }
      if (key === "z" && e.shiftKey) {
        e.preventDefault();
        redoCurrent();
        return;
      }
      if (key === "z") {
        e.preventDefault();
        undoCurrent();
        return;
      }
      if (key === "y") {
        e.preventDefault();
        redoCurrent();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [redoCurrent, saveCurrent, undoCurrent]);

  if (previewLevel) {
    return <LevelPreviewPage level={previewLevel} onClose={() => setPreviewLevel(null)} />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <header
        style={{
          padding: "10px 14px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          alignItems: "center",
        }}
      >
        <strong style={{ marginRight: 8 }}>Joker Sheep 关卡编辑器</strong>
        <button type="button" className="primary" onClick={pickDirectory}>
          选择关卡目录
        </button>
        <button
          type="button"
          className={current && isLevelDirty(current) ? "primary" : undefined}
          onClick={saveCurrent}
          disabled={!current}
          title={current && isLevelDirty(current) ? "将当前关卡写入已选目录" : undefined}
        >
          {current && isLevelDirty(current) ? "保存到磁盘" : "保存当前"}
        </button>
        {current && isLevelDirty(current) ? (
          <span style={{ color: "var(--warn)", fontSize: 12 }}>未保存</span>
        ) : null}
        {current && !current.fileHandle ? (
          <span style={{ color: "var(--muted)", fontSize: 12 }}>仅内存（未关联磁盘文件）</span>
        ) : null}
        <button type="button" onClick={newLevel}>
          新建
        </button>
        <button type="button" onClick={copyLevel} disabled={!current}>
          复制
        </button>
        <button type="button" onClick={() => void deleteLevel()} disabled={!current}>
          删除
        </button>
        <button type="button" onClick={() => importInputRef.current?.click()}>
          导入 JSON
        </button>
        <input
          ref={importInputRef}
          type="file"
          accept=".json,application/json"
          multiple
          style={{ display: "none" }}
          onChange={(e) => void onImportFiles(e.target.files)}
        />
        <button type="button" onClick={exportCurrent} disabled={!current}>
          导出当前 JSON
        </button>
        <button type="button" onClick={() => current && setPreviewLevel(cloneLevel(current.data))} disabled={!current}>
          关卡预览
        </button>
        <button type="button" onClick={clearCurrentCache} disabled={!current}>
          清理本地缓存
        </button>
        <span style={{ color: "var(--muted)", fontSize: 12 }}>{status}</span>
        {dirHandle ? (
          <span style={{ color: "var(--ok)", fontSize: 12 }}>已连接目录</span>
        ) : (
          <span style={{ color: "var(--warn)", fontSize: 12 }}>未选目录（仅导入/导出）</span>
        )}
      </header>
      {!fsSupported ? (
        <div
          style={{
            margin: "10px 10px 0",
            padding: "8px 12px",
            border: "1px solid var(--warn)",
            borderRadius: 8,
            background: "rgba(255, 193, 7, 0.08)",
            color: "var(--text)",
            fontSize: 13,
          }}
        >
          兼容性提示：检测到你正在使用 {browserName}。当前浏览器不支持目录读写（showDirectoryPicker）。
          你仍可使用“导入 JSON / 导出当前 JSON”；若需直接选择并保存到工程目录，请使用 Chrome 或 Edge。
        </div>
      ) : null}
      <div style={{ display: "flex", flex: 1, minHeight: 0, gap: 10, padding: 10 }}>
        <aside style={{ width: 300, flexShrink: 0, minHeight: 0, display: "flex" }}>
          <LevelList
            files={files}
            selectedIndex={selectedIndex}
            onSelect={trySelect}
            search={search}
            onSearchChange={setSearch}
            filter={listFilter}
            onFilterChange={setListFilter}
          />
        </aside>
        <main style={{ flex: 1, minWidth: 0, overflow: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
          {!current ? (
            <div className="panel">请选择或新建关卡</div>
          ) : (
            <>
              <div className="panel" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
                <label className="field">
                  <span>关卡编号（Id）</span>
                  <input
                    type="number"
                    value={current.data.Id}
                    onChange={(e) => updateData((d) => ({ ...d, Id: parseInt(e.target.value, 10) || 0 }))}
                  />
                </label>
                <label className="field">
                  <span>标题键（TitleKey）</span>
                  <input value={current.data.TitleKey} onChange={(e) => updateData((d) => ({ ...d, TitleKey: e.target.value }))} />
                </label>
                <label className="field">
                  <span>描述键（DescriptionKey）</span>
                  <input
                    value={current.data.DescriptionKey}
                    onChange={(e) => updateData((d) => ({ ...d, DescriptionKey: e.target.value }))}
                  />
                </label>
                <label className="field">
                  <span>总牌数（TotalCards）</span>
                  <input
                    type="number"
                    value={current.data.TotalCards}
                    onChange={(e) => updateData((d) => ({ ...d, TotalCards: parseInt(e.target.value, 10) || 0 }))}
                  />
                </label>
                <label className="field">
                  <span>目标分（TargetScore）</span>
                  <input
                    type="number"
                    value={current.data.TargetScore}
                    onChange={(e) => updateData((d) => ({ ...d, TargetScore: parseInt(e.target.value, 10) || 0 }))}
                  />
                </label>
                <label className="field">
                  <span>推荐目标分（TargetScoreRecommended）</span>
                  <input
                    type="number"
                    value={current.data.TargetScoreRecommended}
                    onChange={(e) => updateData((d) => ({ ...d, TargetScoreRecommended: parseInt(e.target.value, 10) || 0 }))}
                  />
                </label>
                <label className="field">
                  <span>目标分下限（TargetScoreMin）</span>
                  <input
                    type="number"
                    value={current.data.TargetScoreMin}
                    onChange={(e) => updateData((d) => ({ ...d, TargetScoreMin: parseInt(e.target.value, 10) || 0 }))}
                  />
                </label>
                <label className="field">
                  <span>目标分上限（TargetScoreMax）</span>
                  <input
                    type="number"
                    value={current.data.TargetScoreMax}
                    onChange={(e) => updateData((d) => ({ ...d, TargetScoreMax: parseInt(e.target.value, 10) || 0 }))}
                  />
                </label>
                <label className="field">
                  <span>超分通关（AllowOverScoreWin）</span>
                  <select
                    value={current.data.AllowOverScoreWin ? "true" : "false"}
                    onChange={(e) => updateData((d) => ({ ...d, AllowOverScoreWin: e.target.value === "true" }))}
                  >
                    <option value="true">开：达到或超过目标分即通关</option>
                    <option value="false">关：必须精确等于目标分才通关</option>
                  </select>
                </label>
                <label className="field">
                  <span>明显不可达强拦截发布（StrictBlockOnUnreachable）</span>
                  <select
                    value={current.data.StrictBlockOnUnreachable ? "true" : "false"}
                    onChange={(e) => updateData((d) => ({ ...d, StrictBlockOnUnreachable: e.target.value === "true" }))}
                  >
                    <option value="true">开：不可达会变成 Error，禁止保存到磁盘</option>
                    <option value="false">关：不可达只提示 Warning，不强拦截</option>
                  </select>
                </label>
                <label className="field">
                  <span>胜利条件（WinConditionMode）</span>
                  <select
                    value={current.data.WinConditionMode}
                    onChange={(e) =>
                      updateData((d) => ({ ...d, WinConditionMode: parseInt(e.target.value, 10) as LevelWinConditionMode }))
                    }
                  >
                    <option value={LevelWinConditionMode.ScoreOnly}>{WIN_MODE_LABELS[LevelWinConditionMode.ScoreOnly]}</option>
                    <option value={LevelWinConditionMode.ObjectivesOnly}>{WIN_MODE_LABELS[LevelWinConditionMode.ObjectivesOnly]}</option>
                    <option value={LevelWinConditionMode.ScoreAndObjectives}>
                      {WIN_MODE_LABELS[LevelWinConditionMode.ScoreAndObjectives]}
                    </option>
                    <option value={LevelWinConditionMode.ScoreOrObjectives}>{WIN_MODE_LABELS[LevelWinConditionMode.ScoreOrObjectives]}</option>
                  </select>
                </label>
                <label className="field">
                  <span>是否只有一副牌（IsSingleDeck）</span>
                  <select
                    value={current.data.IsSingleDeck ? "true" : "false"}
                    onChange={(e) => updateData((d) => ({ ...d, IsSingleDeck: e.target.value === "true" }))}
                  >
                    <option value="true">是：52 张普通牌只能各用一次</option>
                    <option value="false">否：允许重复固定同一张牌</option>
                  </select>
                </label>
                <div
                  style={{
                    gridColumn: "1 / -1",
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    marginBottom: 0,
                  }}
                >
                  <span style={{ fontWeight: 500 }}>随机种子（Seed）</span>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "stretch", width: "100%" }}>
                    <input
                      type="text"
                      className="seed-text"
                      inputMode="numeric"
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="0～4294967295"
                      value={seedDraft}
                      onChange={(e) => setSeedDraft(e.target.value)}
                      title="纯数字、无上下键；改完后点「应用种子」写入关卡。也可「从 JSON 合并」导入片段。"
                      style={{ minHeight: 36 }}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (!current) {
                          return;
                        }
                        const parsed = parseSeedUint32(seedDraft);
                        if (parsed === null) {
                          setStatus("种子格式无效：请输入非负整数（不超过 4294967295）。");
                          return;
                        }
                        updateData((d) => ({ ...d, Seed: parsed }));
                        setSeedDraft(String(parsed));
                        setStatus(`已应用种子：${parsed}`);
                      }}
                    >
                      应用种子
                    </button>
                    <button type="button" onClick={() => seedMergeInputRef.current?.click()}>
                      从 JSON 合并
                    </button>
                    <input
                      ref={seedMergeInputRef}
                      type="file"
                      accept=".json,application/json"
                      style={{ display: "none" }}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        if (!file) {
                          return;
                        }
                        const mergeTargetIndex = selectedIndex;
                        const row = files[mergeTargetIndex];
                        if (!row) {
                          setStatus("没有选中的关卡，无法合并。");
                          return;
                        }
                        const baseData = cloneLevel(row.data);
                        const reader = new FileReader();
                        reader.onload = () => {
                          try {
                            const text = String(reader.result ?? "");
                            const raw = JSON.parse(text) as unknown;
                            const res = mergeLevelFromJsonFragment(baseData, raw);
                            if (!res.ok) {
                              setStatus(res.message);
                              return;
                            }
                            if (mergeTargetIndex === selectedIndexRef.current) {
                              updateData(() => res.data);
                            } else {
                              setFiles((prev) => {
                                if (mergeTargetIndex < 0 || mergeTargetIndex >= prev.length) {
                                  return prev;
                                }
                                const next = [...prev];
                                const r = next[mergeTargetIndex];
                                next[mergeTargetIndex] = { ...r, data: res.data };
                                return next;
                              });
                            }
                            if (mergeTargetIndex === selectedIndexRef.current) {
                              setSeedDraft(String(res.data.Seed >>> 0));
                            }
                            setStatus(`已从 JSON 合并 ${file.name} 中的字段到关卡「${row.fileName}」。`);
                          } catch (err) {
                            setStatus(`读取 JSON 失败：${(err as Error).message}`);
                          }
                        };
                        reader.onerror = () => setStatus("读取文件失败。");
                        reader.readAsText(file, "UTF-8");
                      }}
                    />
                  </div>
                  <span style={{ color: "var(--muted)", fontSize: 11 }}>
                    「从 JSON 合并」会按文件中出现的字段覆盖当前关卡（如 Seed、牌池、棋盘等），未出现的字段保持不变。
                  </span>
                </div>
              </div>
              <div className="panel">
                <div style={{ marginBottom: 8, fontWeight: 600 }}>花色池（PoolSuits）</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 8 }}>
                  <button
                    type="button"
                    onClick={() => {
                      if (!current) {
                        return;
                      }
                      const layout = current.data.BoardLayout;
                      if (!layout.length) {
                        setStatus("请先在棋盘区域添加槽位，再随机各槽位牌的花色。");
                        return;
                      }
                      if (!current.data.PoolSuits.length) {
                        setStatus("花色池为空，无法随机槽位花色。");
                        return;
                      }
                      const seed = generateUniqueLevelSeed();
                      const res = randomizeBoardLayoutSlotSuits(seed, current.data.BoardLayout, current.data.PoolSuits);
                      if (!res.ok) {
                        setStatus(res.message);
                        return;
                      }
                      updateData((d) => ({
                        ...d,
                        Seed: seed,
                        BoardLayout: res.layout,
                      }));
                      setStatus("已按花色池为各槽位随机花色（每张实体牌不重复，未改池子）。");
                    }}
                  >
                    随机槽位花色
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!current) {
                        return;
                      }
                      const layout = current.data.BoardLayout;
                      if (!layout.length) {
                        setStatus("请先在棋盘区域添加槽位，再随机各槽位牌的花色与点数。");
                        return;
                      }
                      if (!current.data.PoolSuits.length) {
                        setStatus("花色池为空，无法随机槽位花色。");
                        return;
                      }
                      if (!current.data.PoolRanks.length) {
                        setStatus("点数池为空，无法随机槽位点数。");
                        return;
                      }
                      const seed = generateUniqueLevelSeed();
                      const res = randomizeBoardLayoutSlotSuitsAndRanks(
                        seed,
                        current.data.BoardLayout,
                        current.data.PoolSuits,
                        current.data.PoolRanks,
                      );
                      if (!res.ok) {
                        setStatus(res.message);
                        return;
                      }
                      updateData((d) => ({
                        ...d,
                        Seed: seed,
                        BoardLayout: res.layout,
                      }));
                      setStatus("已从花色池×点数池无放回发牌到各槽位（每张实体牌不重复）。");
                    }}
                  >
                    随机槽位花色与点数
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!current) {
                        return;
                      }
                      const layout = current.data.BoardLayout;
                      if (!layout.length) {
                        setStatus("请先在棋盘区域添加槽位，再随机各槽位牌的点数。");
                        return;
                      }
                      if (!current.data.PoolRanks.length) {
                        setStatus("点数池为空，无法随机槽位点数。");
                        return;
                      }
                      const seed = generateUniqueLevelSeed();
                      const res = randomizeBoardLayoutSlotRanks(seed, current.data.BoardLayout, current.data.PoolRanks);
                      if (!res.ok) {
                        setStatus(res.message);
                        return;
                      }
                      updateData((d) => ({
                        ...d,
                        Seed: seed,
                        BoardLayout: res.layout,
                      }));
                      setStatus("已按点数池为各槽位随机点数（每张实体牌不重复，未改池子）。");
                    }}
                  >
                    随机槽位点数
                  </button>
                  <span style={{ color: "var(--muted)", fontSize: 12 }}>
                    从花色池×点数池构成的牌堆无放回发牌；同一张实体牌（花色+点数）不会在棋盘上出现两次
                  </span>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {SUIT_CODES.map((s) => {
                    const on = current.data.PoolSuits.includes(s);
                    return (
                      <label key={s} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => {
                            updateData((d) => {
                              const set = new Set(d.PoolSuits);
                              if (set.has(s)) {
                                set.delete(s);
                              } else {
                                set.add(s);
                              }
                              return { ...d, PoolSuits: Array.from(set) as LevelConfigData["PoolSuits"] };
                            });
                          }}
                        />
                        {s}
                      </label>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => updateData((d) => ({ ...d, PoolSuits: [...SUIT_CODES] }))}
                  >
                    全花色
                  </button>
                  <button type="button" onClick={() => updateData((d) => ({ ...d, PoolSuits: ["H", "D"] }))}>
                    红色
                  </button>
                  <button type="button" onClick={() => updateData((d) => ({ ...d, PoolSuits: ["C", "S"] }))}>
                    黑色
                  </button>
                </div>
                <div style={{ margin: "12px 0 8px", fontWeight: 600 }}>点数池（PoolRanks，2–14，14=A）</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {Array.from({ length: RANK_MAX - RANK_MIN + 1 }, (_, i) => RANK_MIN + i).map((r) => {
                    const on = current.data.PoolRanks.includes(r);
                    const label = r <= 10 ? String(r) : r === 11 ? "J" : r === 12 ? "Q" : r === 13 ? "K" : "A";
                    return (
                      <label key={r} style={{ display: "flex", alignItems: "center", gap: 2, fontSize: 12 }}>
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => {
                            updateData((d) => {
                              const set = new Set(d.PoolRanks);
                              if (set.has(r)) {
                                set.delete(r);
                              } else {
                                set.add(r);
                              }
                              return { ...d, PoolRanks: Array.from(set).sort((a, b) => a - b) };
                            });
                          }}
                        />
                        {label}
                      </label>
                    );
                  })}
                  <button type="button" onClick={() => updateData((d) => ({ ...d, PoolRanks: Array.from({ length: 13 }, (_, i) => i + 2) }))}>
                    全点数
                  </button>
                  <button type="button" onClick={() => updateData((d) => ({ ...d, PoolRanks: [2, 3, 4, 5, 6, 7, 8] }))}>
                    低点数
                  </button>
                  <button type="button" onClick={() => updateData((d) => ({ ...d, PoolRanks: [8, 9, 10, 11, 12, 13, 14] }))}>
                    高点数
                  </button>
                </div>
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "stretch", flexWrap: "wrap" }}>
                <div style={{ flex: "1 1 560px", minWidth: 420 }}>
                  <PoolStatsPanel level={current.data} />
                </div>
                <div style={{ flex: "0 0 280px", minWidth: 260 }}>
                  <HandTypeUpperBoundsPanel multiset={reachabilitySource.multiset} sourceLabel={reachabilitySource.sourceLabel} />
                </div>
              </div>
              <div className="panel" style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
                <label className="field" style={{ margin: 0 }}>
                  <span>万能小丑数量（SpecialWild）</span>
                  <input
                    type="number"
                    value={current.data.SpecialWild}
                    onChange={(e) => updateData((d) => ({ ...d, SpecialWild: parseInt(e.target.value, 10) || 0 }))}
                  />
                </label>
                <label className="field" style={{ margin: 0 }}>
                  <span>倍率小丑数量（SpecialMultiplier）</span>
                  <input
                    type="number"
                    value={current.data.SpecialMultiplier}
                    onChange={(e) => updateData((d) => ({ ...d, SpecialMultiplier: parseInt(e.target.value, 10) || 0 }))}
                  />
                </label>
                <label className="field" style={{ margin: 0 }}>
                  <span>变化小丑数量（SpecialSuit）</span>
                  <input
                    type="number"
                    value={current.data.SpecialSuit}
                    onChange={(e) => updateData((d) => ({ ...d, SpecialSuit: parseInt(e.target.value, 10) || 0 }))}
                  />
                </label>
                <span style={{ alignSelf: "flex-end", color: "var(--muted)" }}>
                  特殊牌合计 {current.data.SpecialWild + current.data.SpecialMultiplier + current.data.SpecialSuit} /{" "}
                  {current.data.TotalCards}
                </span>
              </div>
              <div className="panel" style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
                <label className="field" style={{ margin: 0 }}>
                  <span>收容道具次数（ItemStorage）</span>
                  <input
                    type="number"
                    value={current.data.ItemStorage}
                    onChange={(e) => updateData((d) => ({ ...d, ItemStorage: parseInt(e.target.value, 10) || 0 }))}
                  />
                </label>
                <label className="field" style={{ margin: 0 }}>
                  <span>洗牌道具次数（ItemShuffle）</span>
                  <input
                    type="number"
                    value={current.data.ItemShuffle}
                    onChange={(e) => updateData((d) => ({ ...d, ItemShuffle: parseInt(e.target.value, 10) || 0 }))}
                  />
                </label>
                <label className="field" style={{ margin: 0 }}>
                  <span>万能小丑道具次数（ItemAddWild）</span>
                  <input
                    type="number"
                    value={current.data.ItemAddWild}
                    onChange={(e) => updateData((d) => ({ ...d, ItemAddWild: parseInt(e.target.value, 10) || 0 }))}
                  />
                </label>
              </div>
              <div className="panel">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                  <strong>随机消除规则（RandomEliminationRules）</strong>
                  <button
                    type="button"
                    onClick={() =>
                      updateData((d) => ({
                        ...d,
                        RandomEliminationRules: [
                          ...(d.RandomEliminationRules ?? []),
                          { Enabled: true, Trigger: "OnHighCard", RemoveCount: 3, Range: "All", Layers: [], ExcludeFixedCards: true, ExcludeJokers: false },
                        ],
                      }))
                    }
                  >
                    添加规则
                  </button>
                </div>
                {(current.data.RandomEliminationRules ?? []).length === 0 ? (
                  <div style={{ marginTop: 8, color: "var(--muted)", fontSize: 12 }}>
                    当前为空：预览会回退到旧逻辑（高牌 / 连续两轮一对 =&gt; 随机消除 3 张）。
                  </div>
                ) : null}
                {(current.data.RandomEliminationRules ?? []).map((r, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "110px 160px 110px 160px 1fr",
                      gap: 8,
                      alignItems: "end",
                      marginTop: 10,
                      paddingTop: 10,
                      borderTop: idx === 0 ? "none" : "1px solid var(--border)",
                    }}
                  >
                    <label className="field" style={{ margin: 0 }}>
                      <span>启用</span>
                      <select
                        value={r.Enabled ? "true" : "false"}
                        onChange={(e) =>
                          updateData((d) => {
                            const next = [...(d.RandomEliminationRules ?? [])];
                            next[idx] = { ...next[idx], Enabled: e.target.value === "true" };
                            return { ...d, RandomEliminationRules: next };
                          })
                        }
                      >
                        <option value="true">是</option>
                        <option value="false">否</option>
                      </select>
                    </label>
                    <label className="field" style={{ margin: 0 }}>
                      <span>触发条件（Trigger）</span>
                      <select
                        value={r.Trigger}
                        onChange={(e) =>
                          updateData((d) => {
                            const next = [...(d.RandomEliminationRules ?? [])];
                            next[idx] = { ...next[idx], Trigger: e.target.value as any };
                            return { ...d, RandomEliminationRules: next };
                          })
                        }
                      >
                        <option value="OnHighCard">高牌后（OnHighCard）</option>
                        <option value="OnPairStreak2">连续两轮一对后（OnPairStreak2）</option>
                      </select>
                    </label>
                    <label className="field" style={{ margin: 0 }}>
                      <span>消除数量（RemoveCount）</span>
                      <input
                        type="number"
                        value={r.RemoveCount}
                        onChange={(e) =>
                          updateData((d) => {
                            const next = [...(d.RandomEliminationRules ?? [])];
                            next[idx] = { ...next[idx], RemoveCount: parseInt(e.target.value, 10) || 0 };
                            return { ...d, RandomEliminationRules: next };
                          })
                        }
                      />
                    </label>
                    <label className="field" style={{ margin: 0 }}>
                      <span>消除范围（Range）</span>
                      <select
                        value={r.Range}
                        onChange={(e) =>
                          updateData((d) => {
                            const next = [...(d.RandomEliminationRules ?? [])];
                            const range = e.target.value as any;
                            next[idx] = { ...next[idx], Range: range, Layers: range === "Layers" ? next[idx].Layers ?? [] : [] };
                            return { ...d, RandomEliminationRules: next };
                          })
                        }
                      >
                        <option value="All">全牌面（All）</option>
                        <option value="Clickable">仅可点击（Clickable）</option>
                        <option value="Locked">仅不可点击（Locked）</option>
                        <option value="Layers">指定层（Layers）</option>
                      </select>
                    </label>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                      <label className="field" style={{ margin: 0, minWidth: 220 }}>
                        <span>指定层（Layers）</span>
                        <input
                          value={(r.Layers ?? []).join(",")}
                          placeholder="如 0,1,2"
                          disabled={r.Range !== "Layers"}
                          onChange={(e) => {
                            const parts = e.target.value
                              .split(",")
                              .map((s) => s.trim())
                              .filter(Boolean)
                              .map((s) => parseInt(s, 10))
                              .filter((n) => Number.isFinite(n) && n >= 0);
                            updateData((d) => {
                              const next = [...(d.RandomEliminationRules ?? [])];
                              next[idx] = { ...next[idx], Layers: parts };
                              return { ...d, RandomEliminationRules: next };
                            });
                          }}
                        />
                      </label>
                      <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12 }}>
                        <input
                          type="checkbox"
                          checked={!!r.ExcludeFixedCards}
                          onChange={(e) =>
                            updateData((d) => {
                              const next = [...(d.RandomEliminationRules ?? [])];
                              next[idx] = { ...next[idx], ExcludeFixedCards: e.target.checked };
                              return { ...d, RandomEliminationRules: next };
                            })
                          }
                        />
                        排除固定牌（ExcludeFixedCards）
                      </label>
                      <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12 }}>
                        <input
                          type="checkbox"
                          checked={!!r.ExcludeJokers}
                          onChange={(e) =>
                            updateData((d) => {
                              const next = [...(d.RandomEliminationRules ?? [])];
                              next[idx] = { ...next[idx], ExcludeJokers: e.target.checked };
                              return { ...d, RandomEliminationRules: next };
                            })
                          }
                        />
                        排除小丑牌（ExcludeJokers）
                      </label>
                      <button
                        type="button"
                        onClick={() =>
                          updateData((d) => {
                            const next = [...(d.RandomEliminationRules ?? [])];
                            next.splice(idx, 1);
                            return { ...d, RandomEliminationRules: next };
                          })
                        }
                        style={{ marginLeft: "auto" }}
                      >
                        删除
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="panel">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <strong>特殊目标（Objectives）</strong>
                  <button
                    type="button"
                    onClick={() =>
                      updateData((d) => ({
                        ...d,
                        Objectives: [...d.Objectives, { HandType: "Pair", Count: 1, Reward: 0 }],
                      }))
                    }
                  >
                    添加目标
                  </button>
                </div>
                {current.data.Objectives.map((obj, idx) => (
                  <div key={idx} style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8, alignItems: "flex-end" }}>
                    <label className="field" style={{ margin: 0 }}>
                      <span>牌型（HandType）</span>
                      <select
                        value={obj.HandType}
                        onChange={(e) =>
                          updateData((d) => {
                            const obs = [...d.Objectives];
                            obs[idx] = { ...obs[idx], HandType: e.target.value };
                            return { ...d, Objectives: obs };
                          })
                        }
                      >
                        {HAND_TYPES.map((h) => (
                          <option key={h} value={h}>
                            {HAND_TYPE_LABELS[h] ? `${HAND_TYPE_LABELS[h]}（${h}）` : h}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field" style={{ margin: 0 }}>
                      <span>要求次数（Count）</span>
                      <input
                        type="number"
                        value={obj.Count}
                        onChange={(e) =>
                          updateData((d) => {
                            const obs = [...d.Objectives];
                            obs[idx] = { ...obs[idx], Count: parseInt(e.target.value, 10) || 0 };
                            return { ...d, Objectives: obs };
                          })
                        }
                      />
                    </label>
                    <label className="field" style={{ margin: 0 }}>
                      <span>奖励分（Reward）</span>
                      <input
                        type="number"
                        value={obj.Reward}
                        onChange={(e) =>
                          updateData((d) => {
                            const obs = [...d.Objectives];
                            obs[idx] = { ...obs[idx], Reward: parseInt(e.target.value, 10) || 0 };
                            return { ...d, Objectives: obs };
                          })
                        }
                      />
                    </label>
                    <div
                      style={{
                        minWidth: 160,
                        alignSelf: "stretch",
                        display: "flex",
                        alignItems: "center",
                        padding: "0 8px",
                        border: "1px solid var(--border)",
                        borderRadius: 6,
                        background:
                          objectiveReachState[idx]?.status === "ok"
                            ? "rgba(91, 211, 139, 0.12)"
                            : objectiveReachState[idx]?.status === "no"
                              ? "rgba(255, 107, 107, 0.12)"
                              : "rgba(255, 200, 87, 0.12)",
                        color:
                          objectiveReachState[idx]?.status === "ok"
                            ? "var(--ok)"
                            : objectiveReachState[idx]?.status === "no"
                              ? "var(--error)"
                              : "var(--warn)",
                        fontSize: 12,
                      }}
                      title={`统计来源：${reachabilitySource.sourceLabel}`}
                    >
                      可达性：{OBJECTIVE_REACH_LABEL[objectiveReachState[idx]?.status ?? "risk"]}
                      {typeof objectiveReachState[idx]?.upper === "number" ? `（上界 ${objectiveReachState[idx]!.upper}）` : ""}
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        updateData((d) => ({
                          ...d,
                          Objectives: d.Objectives.filter((_, i) => i !== idx),
                        }))
                      }
                    >
                      删除
                    </button>
                  </div>
                ))}
              </div>
              <BoardEditor
                totalCards={current.data.TotalCards}
                isSingleDeck={current.data.IsSingleDeck}
                boardLayout={current.data.BoardLayout}
                specialWild={current.data.SpecialWild}
                specialMultiplier={current.data.SpecialMultiplier}
                specialSuit={current.data.SpecialSuit}
                onChange={(layout) => updateData((d) => ({ ...d, BoardLayout: layout }))}
                onTotalCardsChange={(n) => updateData((d) => ({ ...d, TotalCards: n }))}
                focusSlotIndex={focusSlotIndex}
                onFocusSlotConsumed={() => setFocusSlotIndex(null)}
              />
            </>
          )}
        </main>
        <aside style={{ width: 320, flexShrink: 0, display: "flex", flexDirection: "column", gap: 10, minHeight: 0 }}>
          <ValidationPanel messages={validation} onPickSlot={(i) => setFocusSlotIndex(i)} />
          <div className="panel" style={{ overflow: "auto", fontSize: 13, lineHeight: 1.6 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>使用说明</div>
            <div>
              <strong>1) 常规流程：</strong>先点「选择关卡目录」读取关卡文件，编辑后点「保存当前」写回磁盘。
            </div>
            <div>
              <strong>2) 浏览器兼容：</strong>部分浏览器不支持“直接读写文件夹”。需要把修改写回到工程目录时，请优先使用 Chrome 或 Edge。
            </div>
            <div>
              <strong>3) 兼容模式：</strong>无法直接写回目录时，用「导入 JSON」编辑，再「导出当前 JSON」下载结果并手动覆盖工程文件。
            </div>
            <div>
              <strong>4) 胜利条件逻辑：</strong>当胜利条件包含“分数目标”时，目标分必须大于 0；当胜利条件是“仅目标”时，目标分可不填。
            </div>
            <div>
              <strong>5) 目标判定：</strong>当胜利条件需要“目标”时，必须配置至少 1 条目标；目标的牌型必须合法；奖励分不能小于 0。
            </div>
            <div>
              <strong>6) 牌池规则：</strong>花色只能选 红心/方片/梅花/黑桃；点数范围只能是 2~14（14 表示 A）。任一为空都会校验失败。
            </div>
            <div>
              <strong>7) 特殊牌与总牌数：</strong>特殊牌总数不能超过总牌数；特殊牌和道具初始次数都不能为负数。
            </div>
            <div>
              <strong>8) 自定义布局生效条件：</strong>当“槽位数量 = 总牌数”时，自定义布局才会完整生效；数量不一致会提示，并可能回退为自动布局。
            </div>
            <div>
              <strong>9) 层级（叠放）逻辑：</strong>先比“层级”，数值越大越在上层；同层时，列表里更靠后的槽位会压在更上面（更容易遮挡下面的牌）。
            </div>
            <div>
              <strong>10) 可点击判定：</strong>系统会计算每张牌被遮挡后的“可见面积比例”；可见比例 ≥ 70% 才可点。布局编辑器里卡牌底部的百分比就是这个预览值。
            </div>
            <div>
              <strong>11) 坐标与吸附：</strong>拖拽时会按“吸附 X / 吸附 Y”对齐到网格；「全部吸附」会把全部槽位一次对齐。
            </div>
            <div>
              <strong>12) 默认矩阵与补齐：</strong>默认矩阵按每层 4×4（16 槽）生成；奇数层会做半格横向偏移与轻微纵向偏移，形成更自然的叠放。补齐只会增加缺少的槽位。
            </div>
            <div>
              <strong>13) 排序与覆盖关系：</strong>「按层排序」会重排槽位顺序（先层级，再纵向，再横向）。重排会改变“同层时谁在上面”的关系，请在完成布局后再排序确认。
            </div>
            <div>
              <strong>14) 常见保存失败原因：</strong>未选择目录、浏览器权限被拒、目标文件重名、校验报错（右侧错误项）。建议先修复错误，再保存。
            </div>
            <div>
              <strong>15) 坐标建议：</strong>坐标离中心过远可能超出可视区域；同层同坐标重复会触发警告，也会导致重叠难点选。
            </div>
            <div>
              <strong>16) 随机种子：</strong>三个「随机槽位…」按钮会换新种子，并在花色池×点数池构成的实体牌范围内<strong>无放回</strong>为槽位分配牌面，保证同一关卡里不会出现两张完全相同的实体牌（与「只有一副牌」校验一致）。槽位数不能超过池子能组成的张数（全池最多 52）；若无法满足不重复约束，会提示原因且不更新种子。
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
