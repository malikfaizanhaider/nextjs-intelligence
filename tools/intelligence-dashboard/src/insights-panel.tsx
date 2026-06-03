"use client";

import { type ReactNode } from "react";
import type {
  ComponentDerivedMetrics,
  DerivedMetrics,
  RouteDerivedMetrics,
} from "../../intelligence-types/src/index";

/**
 * Compact view of the {@link DerivedMetrics} block. Renders hotspots,
 * top-reusable components, dead code and confidence distribution in a
 * single scrollable panel. Pure presentation — all numbers come from the
 * manifest's `derived` block (recomputable via `deriveMetrics`).
 */
export interface InsightsPanelProps {
  derived: DerivedMetrics | null | undefined;
  onSelectRoute?: (path: string) => void;
}

export function InsightsPanel({ derived, onSelectRoute }: Readonly<InsightsPanelProps>) {
  if (!derived) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          color: "var(--c-text-faint)",
          fontSize: "13px",
          padding: "16px",
        }}
      >
        No derived metrics in this manifest (schema &lt; 1.1.0).
      </div>
    );
  }

  const confidenceTotal =
    derived.confidenceHistogram.high +
    derived.confidenceHistogram.medium +
    derived.confidenceHistogram.low;

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: "16px" }}>
      <h2
        style={{
          fontSize: "16px",
          fontWeight: 700,
          margin: "0 0 12px 0",
          color: "var(--c-text)",
        }}
      >
        Insights
      </h2>

      <TotalsGrid totals={derived.totals} diagnosticDensity={derived.diagnosticDensity} />

      {derived.bundle && (
        <Section title="Bundle" color="#f97316">
          <Row label="Source" value={derived.bundle.source} mono />
          <Row label="JS total" value={formatBytes(derived.bundle.totalJsBytes)} />
          <Row label="CSS total" value={formatBytes(derived.bundle.totalCssBytes)} />
          <Row
            label="Routes with stats"
            value={`${derived.bundle.routesWithStats} / ${derived.totals.routes}`}
          />
        </Section>
      )}

      <Section title="Hotspot routes" color="#dc2626">
        <HotspotRoutes routes={derived.hotspotRoutes} onSelect={onSelectRoute} />
      </Section>

      <Section title="Top reusable components" color="#10b981">
        <TopReusable components={derived.topReusable} />
      </Section>

      {derived.deadComponents.length > 0 && (
        <Section
          title={`Dead components (${derived.deadComponents.length})`}
          color="#6b7280"
        >
          <DeadComponents ids={derived.deadComponents} />
        </Section>
      )}

      <Section title="Confidence distribution" color="#6366f1">
        <ConfidenceBar
          histogram={derived.confidenceHistogram}
          total={confidenceTotal}
        />
      </Section>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────

function TotalsGrid({
  totals,
  diagnosticDensity,
}: Readonly<{
  totals: DerivedMetrics["totals"];
  diagnosticDensity: number;
}>) {
  const cells: { label: string; value: string | number; color: string }[] = [
    { label: "Components", value: totals.components, color: "#3b82f6" },
    { label: "Routes", value: totals.routes, color: "#8b5cf6" },
    { label: "Reusable", value: totals.reusableComponents, color: "#10b981" },
    { label: "Dead", value: totals.deadComponents, color: "#6b7280" },
    { label: "Diagnostics", value: totals.diagnostics, color: "#ef4444" },
    { label: "Diag/Comp", value: diagnosticDensity.toFixed(3), color: "#f59e0b" },
  ];
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))",
        gap: "8px",
        marginBottom: "16px",
      }}
    >
      {cells.map((c) => (
        <div
          key={c.label}
          style={{
            border: "1px solid var(--c-border)",
            borderRadius: "6px",
            padding: "8px 10px",
            background: "var(--c-surface)",
            borderTop: `3px solid ${c.color}`,
          }}
        >
          <div style={{ fontSize: "18px", fontWeight: 700, color: c.color }}>
            {c.value}
          </div>
          <div
            style={{
              fontSize: "10px",
              color: "var(--c-text-muted)",
              marginTop: "2px",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            {c.label}
          </div>
        </div>
      ))}
    </div>
  );
}

function HotspotRoutes({
  routes,
  onSelect,
}: Readonly<{
  routes: RouteDerivedMetrics[];
  onSelect?: (path: string) => void;
}>) {
  if (routes.length === 0) {
    return <Empty>No route metrics yet</Empty>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
      {routes.map((r) => (
        <button
          key={r.path}
          type="button"
          onClick={onSelect ? () => onSelect(r.path) : undefined}
          style={{
            all: "unset",
            cursor: onSelect ? "pointer" : "default",
            display: "grid",
            gridTemplateColumns: "1fr auto",
            gap: "8px",
            padding: "6px 8px",
            borderRadius: "4px",
            background: "var(--c-surface-alt)",
            fontSize: "12px",
            fontFamily: "monospace",
          }}
        >
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{r.path}</span>
          <span style={{ display: "flex", gap: "8px", fontFamily: "system-ui" }}>
            <Badge color="#dc2626" title="Hotness">
              {pct(r.hotness)}
            </Badge>
            <Badge color="#f97316" title="Bundle risk (eager ratio)">
              {pct(r.bundleRisk)}
            </Badge>
            {r.bundle && (
              <Badge color="#0ea5e9" title="JS bytes">
                {formatBytes(r.bundle.jsBytes)}
              </Badge>
            )}
          </span>
        </button>
      ))}
    </div>
  );
}

function TopReusable({ components }: Readonly<{ components: ComponentDerivedMetrics[] }>) {
  if (components.length === 0) {
    return <Empty>No reusable components detected</Empty>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
      {components.map((c) => {
        const short = c.canonicalId.split("#").at(-1) ?? c.canonicalId;
        return (
          <div
            key={c.canonicalId}
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto",
              gap: "8px",
              padding: "4px 8px",
              fontSize: "12px",
              fontFamily: "monospace",
              borderLeft: `3px solid ${scoreColor(c.reusabilityScore)}`,
              background: "var(--c-surface-alt)",
            }}
            title={c.canonicalId}
          >
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{short}</span>
            <span style={{ fontFamily: "system-ui", color: "var(--c-text-muted)" }}>
              {c.routeCount}r · {c.fanIn}f · {pct(c.reusabilityScore)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function DeadComponents({ ids }: Readonly<{ ids: string[] }>) {
  // Cap rendering — the panel is for navigation, not exhaustive listing.
  const MAX = 50;
  const display = ids.slice(0, MAX);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
      {display.map((id) => (
        <code
          key={id}
          style={{
            fontSize: "11px",
            color: "var(--c-text-muted)",
            padding: "2px 6px",
            background: "var(--c-surface-alt)",
            borderRadius: "3px",
            fontFamily: "monospace",
          }}
        >
          {id}
        </code>
      ))}
      {ids.length > MAX && (
        <div
          style={{
            fontSize: "11px",
            color: "var(--c-text-faint)",
            padding: "4px 6px",
          }}
        >
          …and {ids.length - MAX} more
        </div>
      )}
    </div>
  );
}

function ConfidenceBar({
  histogram,
  total,
}: Readonly<{
  histogram: { high: number; medium: number; low: number };
  total: number;
}>) {
  if (total === 0) {
    return <Empty>No scored edges</Empty>;
  }
  const segments: { key: keyof typeof histogram; color: string; label: string }[] = [
    { key: "high", color: "#10b981", label: "High" },
    { key: "medium", color: "#f59e0b", label: "Medium" },
    { key: "low", color: "#ef4444", label: "Low" },
  ];
  return (
    <div>
      <div
        style={{
          display: "flex",
          height: "10px",
          borderRadius: "4px",
          overflow: "hidden",
          marginBottom: "6px",
        }}
        role="img"
        aria-label="Edge confidence distribution"
      >
        {segments.map((s) => {
          const pctVal = (histogram[s.key] / total) * 100;
          return (
            <div
              key={s.key}
              style={{ width: `${pctVal}%`, background: s.color }}
              title={`${s.label}: ${histogram[s.key]} (${pctVal.toFixed(1)}%)`}
            />
          );
        })}
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: "11px",
          color: "var(--c-text-muted)",
        }}
      >
        {segments.map((s) => (
          <span key={s.key}>
            <span
              style={{
                display: "inline-block",
                width: "8px",
                height: "8px",
                borderRadius: "2px",
                background: s.color,
                marginRight: "4px",
              }}
            />
            {s.label}: {histogram[s.key]}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Tiny helpers ───────────────────────────────────────────

function Section({
  title,
  color,
  children,
}: Readonly<{
  title: string;
  color: string;
  children: ReactNode;
}>) {
  return (
    <div style={{ marginBottom: "16px" }}>
      <div
        style={{
          fontSize: "11px",
          fontWeight: 600,
          color,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          marginBottom: "6px",
          display: "flex",
          alignItems: "center",
          gap: "6px",
        }}
      >
        <span
          style={{ width: "3px", height: "12px", background: color, borderRadius: "2px" }}
        />
        {title}
      </div>
      {children}
    </div>
  );
}

function Row({ label, value, mono }: Readonly<{ label: string; value: string; mono?: boolean }>) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        fontSize: "12px",
        padding: "2px 0",
      }}
    >
      <span style={{ color: "var(--c-text-muted)" }}>{label}</span>
      <span style={{ fontFamily: mono ? "monospace" : "system-ui", color: "var(--c-text)" }}>
        {value}
      </span>
    </div>
  );
}

function Badge({
  color,
  title,
  children,
}: Readonly<{
  color: string;
  title?: string;
  children: ReactNode;
}>) {
  return (
    <span
      title={title}
      style={{
        fontSize: "10px",
        padding: "1px 6px",
        borderRadius: "9999px",
        background: color + "22",
        color,
        fontWeight: 600,
      }}
    >
      {children}
    </span>
  );
}

function Empty({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div style={{ fontSize: "12px", color: "var(--c-text-faint)", padding: "4px 0" }}>
      {children}
    </div>
  );
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function scoreColor(score: number): string {
  if (score >= 0.66) return "#10b981";
  if (score >= 0.33) return "#f59e0b";
  return "#9ca3af";
}
