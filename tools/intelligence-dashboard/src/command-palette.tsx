"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { IntelligenceManifest } from "../../intelligence-types/src/index";

/**
 * Single navigable result inside the command palette. Each entry knows how to
 * mutate dashboard state when chosen — the palette stays decoupled from view
 * routing by treating that mutation as an opaque callback.
 */
export interface PaletteResult {
  /** Stable key for React reconciliation. */
  key: string;
  /** Primary display text (route path, component name, diagnostic summary). */
  label: string;
  /** Secondary descriptor shown muted (file path, category, severity). */
  detail: string;
  /** Short tag rendered as a pill on the right side. */
  kind: "route" | "component" | "diagnostic";
  /** Invoked when the user activates this result. */
  onSelect: () => void;
}

interface CommandPaletteProps {
  manifest: IntelligenceManifest;
  /** Navigate to a route in the existing dashboard chrome. */
  onSelectRoute: (path: string) => void;
  /** Switch to a top-level view (e.g. "diagnostics", "usage"). */
  onSelectView: (
    view:
      | "intelligence"
      | "graph"
      | "usage"
      | "runtime"
      | "diagnostics"
      | "api"
      | "middleware"
      | "slots"
      | "actions"
  ) => void;
  /** Optional initial query (used by tests). */
  initialQuery?: string;
}

const MAX_RESULTS = 50;

/**
 * Cheap fuzzy match: returns true if every char of `needle` appears in
 * `haystack` in order (case-insensitive). Good enough for command-palette
 * filtering over a few hundred entries; avoids pulling in fuse.js.
 */
function fuzzyMatch(haystack: string, needle: string): boolean {
  if (!needle) return true;
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  let i = 0;
  for (const ch of h) {
    if (ch === n[i]) i++;
    if (i === n.length) return true;
  }
  return false;
}

/**
 * Cmd+K / Ctrl+K command palette. Listens on `document` for the hotkey, opens
 * an overlay with a fuzzy-searchable index over routes, components, and
 * diagnostics. ↑/↓ navigate, Enter activates, Esc/click-outside closes.
 *
 * Decoupled from routing: selecting a result calls `onSelectRoute` or
 * `onSelectView` and lets the host dashboard reconcile its own state.
 */
export function CommandPalette({
  manifest,
  onSelectRoute,
  onSelectView,
  initialQuery = "",
}: CommandPaletteProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(initialQuery);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Global hotkey listener. Single mount, captures Cmd+K / Ctrl+K from
  // anywhere on the page (input fields included — palette is a meta-action).
  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      const isHotkey = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
      if (isHotkey) {
        event.preventDefault();
        setOpen((prev) => !prev);
      } else if (event.key === "Escape" && open) {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  // Focus the input and reset state whenever the palette opens.
  useEffect(() => {
    if (open) {
      setHighlight(0);
      // Defer one tick so the input exists when we focus.
      const id = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(id);
    }
    setQuery("");
    return undefined;
  }, [open]);

  // Build the full result set once per manifest. Filtering happens on top of
  // this — keeps the search loop tight even for thousand-entry projects.
  const allResults = useMemo<PaletteResult[]>(() => {
    const out: PaletteResult[] = [];

    for (const route of manifest.routes) {
      out.push({
        key: `route::${route.path}`,
        label: route.path,
        detail: route.relativePath,
        kind: "route",
        onSelect: () => {
          onSelectRoute(route.path);
          onSelectView("intelligence");
        },
      });
    }

    for (const [id, comp] of Object.entries(manifest.components)) {
      out.push({
        key: `component::${id}`,
        label: comp.name,
        detail: `${comp.type} · ${comp.relativePath}`,
        kind: "component",
        onSelect: () => onSelectView("usage"),
      });
    }

    for (let i = 0; i < manifest.diagnostics.length; i++) {
      const d = manifest.diagnostics[i]!;
      out.push({
        key: `diagnostic::${i}`,
        label: d.message,
        detail: `${d.severity} · ${d.category}${d.file ? ` · ${d.file}` : ""}`,
        kind: "diagnostic",
        onSelect: () => onSelectView("diagnostics"),
      });
    }

    return out;
  }, [manifest, onSelectRoute, onSelectView]);

  const filtered = useMemo(() => {
    if (!query.trim()) return allResults.slice(0, MAX_RESULTS);
    const matches: PaletteResult[] = [];
    for (const r of allResults) {
      if (fuzzyMatch(`${r.label} ${r.detail}`, query)) {
        matches.push(r);
        if (matches.length >= MAX_RESULTS) break;
      }
    }
    return matches;
  }, [allResults, query]);

  // Clamp highlight whenever the filtered list shrinks below it.
  useEffect(() => {
    if (highlight >= filtered.length) setHighlight(0);
  }, [filtered.length, highlight]);

  const activate = (index: number): void => {
    const target = filtered[index];
    if (!target) return;
    target.onSelect();
    setOpen(false);
  };

  if (!open) return null;

  return (
    <div
      onClick={() => setOpen(false)}
      style={overlayStyle}
      role="presentation"
      data-testid="command-palette-overlay"
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={panelStyle}
        role="dialog"
        aria-label="Command palette"
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setHighlight((prev) => Math.min(prev + 1, filtered.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setHighlight((prev) => Math.max(prev - 1, 0));
            } else if (event.key === "Enter") {
              event.preventDefault();
              activate(highlight);
            }
          }}
          placeholder="Search routes, components, diagnostics..."
          style={inputStyle}
          data-testid="command-palette-input"
        />
        <ul style={listStyle} role="listbox">
          {filtered.length === 0 && (
            <li style={emptyStyle}>No matches.</li>
          )}
          {filtered.map((result, index) => (
            <li
              key={result.key}
              role="option"
              aria-selected={index === highlight}
              onMouseEnter={() => setHighlight(index)}
              onClick={() => activate(index)}
              style={{
                ...itemStyle,
                background: index === highlight ? "#eff6ff" : "transparent",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
                <span style={labelStyle}>{result.label}</span>
                <span style={detailStyle}>{result.detail}</span>
              </div>
              <span style={{ ...kindStyle, ...kindAccent[result.kind] }}>{result.kind}</span>
            </li>
          ))}
        </ul>
        <div style={hintStyle}>
          <kbd style={kbdStyle}>↑</kbd> <kbd style={kbdStyle}>↓</kbd> navigate ·{" "}
          <kbd style={kbdStyle}>↵</kbd> select · <kbd style={kbdStyle}>Esc</kbd> close
        </div>
      </div>
    </div>
  );
}

const overlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(15, 23, 42, 0.45)",
  zIndex: 9999,
  display: "flex",
  justifyContent: "center",
  paddingTop: "10vh",
};

const panelStyle: CSSProperties = {
  width: "min(640px, 92vw)",
  maxHeight: "70vh",
  background: "#fff",
  borderRadius: "12px",
  boxShadow: "0 20px 50px rgba(15, 23, 42, 0.25)",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  fontFamily: "system-ui, -apple-system, sans-serif",
};

const inputStyle: CSSProperties = {
  border: "none",
  borderBottom: "1px solid #e5e7eb",
  padding: "14px 18px",
  fontSize: "14px",
  outline: "none",
  flexShrink: 0,
};

const listStyle: CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  overflowY: "auto",
  flex: 1,
};

const itemStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "12px",
  padding: "8px 18px",
  cursor: "pointer",
  fontSize: "13px",
  borderBottom: "1px solid #f3f4f6",
};

const labelStyle: CSSProperties = {
  fontWeight: 600,
  color: "#1f2937",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: "13px",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const detailStyle: CSSProperties = {
  fontSize: "11px",
  color: "#6b7280",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const emptyStyle: CSSProperties = {
  padding: "20px",
  textAlign: "center",
  color: "#9ca3af",
  fontSize: "13px",
};

const kindStyle: CSSProperties = {
  fontSize: "10px",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  padding: "2px 8px",
  borderRadius: "9999px",
  flexShrink: 0,
};

const kindAccent: Record<PaletteResult["kind"], CSSProperties> = {
  route: { background: "#ede9fe", color: "#5b21b6" },
  component: { background: "#dbeafe", color: "#1e40af" },
  diagnostic: { background: "#fee2e2", color: "#991b1b" },
};

const hintStyle: CSSProperties = {
  padding: "8px 18px",
  fontSize: "11px",
  color: "#6b7280",
  borderTop: "1px solid #e5e7eb",
  background: "#f9fafb",
  flexShrink: 0,
};

const kbdStyle: CSSProperties = {
  background: "#fff",
  border: "1px solid #d1d5db",
  borderRadius: "4px",
  padding: "1px 5px",
  fontSize: "10px",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  margin: "0 2px",
};
