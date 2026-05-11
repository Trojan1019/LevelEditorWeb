import { parseLevelIdFromFileName } from "../domain/levelTypes";
import type { LoadedLevelFile } from "../storage/fsLevelStorage";
import type { ValidationMessage } from "../validation/validateLevel";
import { validateLevel } from "../validation/validateLevel";

export type ListFilter = "all" | "errors" | "warnings" | "layoutOk" | "layoutBad";

interface Props {
  files: LoadedLevelFile[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  search: string;
  onSearchChange: (v: string) => void;
  filter: ListFilter;
  onFilterChange: (f: ListFilter) => void;
}

function summarizeFile(f: LoadedLevelFile, allSummaries: { fileName: string; levelId: number }[]): ValidationMessage[] {
  return validateLevel(f.data, allSummaries.map((s) => ({ fileName: s.fileName, levelId: s.levelId })));
}

export function LevelList({ files, selectedIndex, onSelect, search, onSearchChange, filter, onFilterChange }: Props) {
  const summaries = files.map((f) => ({
    fileName: f.fileName,
    levelId: parseLevelIdFromFileName(f.fileName),
  }));

  const q = search.trim().toLowerCase();
  const rows = files
    .map((f, index) => ({ f, index, msgs: summarizeFile(f, summaries) }))
    .filter(({ f }) => {
      if (!q) {
        return true;
      }
      const idStr = String(f.data.Id);
      if (idStr.includes(q) || f.fileName.toLowerCase().includes(q)) {
        return true;
      }
      return (f.data.TitleKey ?? "").toLowerCase().includes(q);
    })
    .filter(({ f, msgs }) => {
      const errCount = msgs.filter((m) => m.severity === "error").length;
      const warnCount = msgs.filter((m) => m.severity === "warning").length;
      const layoutOk = f.data.BoardLayout.length === f.data.TotalCards && f.data.BoardLayout.length > 0;
      if (filter === "errors") {
        return errCount > 0;
      }
      if (filter === "warnings") {
        return warnCount > 0;
      }
      if (filter === "layoutOk") {
        return layoutOk;
      }
      if (filter === "layoutBad") {
        return f.data.BoardLayout.length > 0 && f.data.BoardLayout.length !== f.data.TotalCards;
      }
      return true;
    });

  return (
    <div className="panel" style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <input
        placeholder="搜索 Id / 文件名 / TitleKey"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        style={{ marginBottom: 8, width: "100%" }}
      />
      <select value={filter} onChange={(e) => onFilterChange(e.target.value as ListFilter)} style={{ marginBottom: 8 }}>
        <option value="all">全部</option>
        <option value="errors">有错误</option>
        <option value="warnings">有警告</option>
        <option value="layoutOk">显式布局生效</option>
        <option value="layoutBad">显式布局未生效</option>
      </select>
      <div style={{ overflow: "auto", flex: 1 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ color: "var(--muted)", textAlign: "left" }}>
              <th style={{ padding: "4px 6px" }}>Id</th>
              <th style={{ padding: "4px 6px" }}>文件</th>
              <th style={{ padding: "4px 6px" }}>牌</th>
              <th style={{ padding: "4px 6px" }}>布局</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ f, index, msgs }) => {
              const err = msgs.some((m) => m.severity === "error");
              const warn = msgs.some((m) => m.severity === "warning");
              const layoutLabel =
                f.data.BoardLayout.length === 0
                  ? "自动"
                  : f.data.BoardLayout.length === f.data.TotalCards
                    ? "生效"
                    : "无效";
              return (
                <tr
                  key={f.fileName + index}
                  onClick={() => onSelect(index)}
                  style={{
                    cursor: "pointer",
                    background: index === selectedIndex ? "#243049" : "transparent",
                    color: err ? "var(--error)" : warn ? "var(--warn)" : undefined,
                  }}
                >
                  <td style={{ padding: "6px" }}>{f.data.Id}</td>
                  <td style={{ padding: "6px", wordBreak: "break-all" }}>{f.fileName}</td>
                  <td style={{ padding: "6px" }}>{f.data.TotalCards}</td>
                  <td style={{ padding: "6px" }}>{layoutLabel}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
