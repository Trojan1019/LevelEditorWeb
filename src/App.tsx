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
  dirty: boolean;
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
      // Note: fileHandle cannot survive refresh; user must re-pick directory to save to disk.
      out.push({ fileName, data: normalized, dirty: Boolean((item as SessionFile).dirty) });
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
      dirty: f.dirty,
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
  const validation = useMemo(
    () => validateLevel(current?.data ?? null, summaries),
    [current, summaries],
  );

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
      if (!f.dirty) {
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
          dirty: true,
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
        dirty: true,
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
        dirty: true,
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
        const cached = tryLoadCachedLevel(f.fileName);
        if (!cached) {
          return f;
        }
        return { ...f, data: cached, dirty: true };
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
          dirty: false,
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
      dirty: true,
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
      dirty: true,
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
    if (cur?.dirty && index !== selectedIndex) {
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
          dirty: false,
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
        <button type="button" onClick={saveCurrent} disabled={!current}>
          保存当前
        </button>
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
              </div>
              <div className="panel">
                <div style={{ marginBottom: 8, fontWeight: 600 }}>花色池（PoolSuits）</div>
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
              <div className="panel" style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
                <label className="field" style={{ margin: 0 }}>
                  <span>万能牌数量（SpecialWild）</span>
                  <input
                    type="number"
                    value={current.data.SpecialWild}
                    onChange={(e) => updateData((d) => ({ ...d, SpecialWild: parseInt(e.target.value, 10) || 0 }))}
                  />
                </label>
                <label className="field" style={{ margin: 0 }}>
                  <span>倍率牌数量（SpecialMultiplier）</span>
                  <input
                    type="number"
                    value={current.data.SpecialMultiplier}
                    onChange={(e) => updateData((d) => ({ ...d, SpecialMultiplier: parseInt(e.target.value, 10) || 0 }))}
                  />
                </label>
                <label className="field" style={{ margin: 0 }}>
                  <span>花色牌数量（SpecialSuit）</span>
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
                  <span>收纳道具次数（ItemStorage）</span>
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
                  <span>加万能牌道具次数（ItemAddWild）</span>
                  <input
                    type="number"
                    value={current.data.ItemAddWild}
                    onChange={(e) => updateData((d) => ({ ...d, ItemAddWild: parseInt(e.target.value, 10) || 0 }))}
                  />
                </label>
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
          </div>
        </aside>
      </div>
    </div>
  );
}
