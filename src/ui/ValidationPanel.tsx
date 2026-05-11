import type { ValidationMessage } from "../validation/validateLevel";
import { countBySeverity } from "../validation/validateLevel";

interface Props {
  messages: ValidationMessage[];
  onPickSlot?: (index: number) => void;
}

export function ValidationPanel({ messages, onPickSlot }: Props) {
  const err = countBySeverity(messages, "error");
  const warn = countBySeverity(messages, "warning");
  const info = countBySeverity(messages, "info");

  return (
    <div className="panel" style={{ display: "flex", flexDirection: "column", gap: 8, minHeight: 200 }}>
      <div style={{ display: "flex", gap: 12, color: "var(--muted)", fontSize: 12 }}>
        <span style={{ color: "var(--error)" }}>错误 {err}</span>
        <span style={{ color: "var(--warn)" }}>警告 {warn}</span>
        <span style={{ color: "var(--info)" }}>信息 {info}</span>
      </div>
      <ul
        style={{
          margin: 0,
          padding: "0 0 0 16px",
          maxHeight: "calc(100vh - 220px)",
          overflow: "auto",
          listStyle: "disc",
        }}
      >
        {messages.map((m, i) => (
          <li
            key={i}
            style={{
              marginBottom: 6,
              color: m.severity === "error" ? "var(--error)" : m.severity === "warning" ? "var(--warn)" : "var(--info)",
            }}
          >
            {m.message}
            {onPickSlot && m.message.includes("BoardLayout[") ? (
              <button
                type="button"
                style={{ marginLeft: 8, padding: "2px 6px", fontSize: 11 }}
                onClick={() => {
                  const match = /BoardLayout\[(\d+)\]/.exec(m.message);
                  if (match) {
                    onPickSlot(parseInt(match[1], 10));
                  }
                }}
              >
                定位
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
