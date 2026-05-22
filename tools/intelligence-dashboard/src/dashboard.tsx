"use client";

import { useState, useEffect, useMemo, lazy, Suspense, type ReactNode } from "react";
import type {
  IntelligenceManifest,
  IntelligenceSummary,
  ComponentMeta,
  RouteMeta,
  RouteIntelligence,
  ComponentUsageMap,
  DependencyGraph,
} from "@i2c/intelligence-types";

const LazyRouteFlowGraph = lazy(() =>
  import("./route-flow-graph").then((mod) => ({ default: mod.RouteFlowGraph }))
);

// ─── Data Hook ──────────────────────────────────────────────

interface UseManifestDataOptions {
  manifestUrl?: string;
  data?: IntelligenceManifest;
}

export function useManifestData(options: UseManifestDataOptions) {
  const [manifest, setManifest] = useState<IntelligenceManifest | null>(
    options.data ?? null
  );
  const [loading, setLoading] = useState(!options.data);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (options.data) {
      setManifest(options.data);
      setLoading(false);
      return;
    }

    if (!options.manifestUrl) {
      setError("No manifest URL or data provided");
      setLoading(false);
      return;
    }

    const controller = new AbortController();

    fetch(options.manifestUrl, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: IntelligenceManifest) => {
        setManifest(data);
        setLoading(false);
      })
      .catch((err) => {
        if (err instanceof Error && err.name !== "AbortError") {
          setError(err.message);
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [options.manifestUrl, options.data]);

  return { manifest, loading, error };
}

// ─── Color Constants ────────────────────────────────────────

const TYPE_COLORS: Record<string, { bg: string; text: string }> = {
  component: { bg: "#f3f4f6", text: "#374151" },
  page: { bg: "#dbeafe", text: "#1d4ed8" },
  layout: { bg: "#e0e7ff", text: "#4338ca" },
  dialog: { bg: "#fce7f3", text: "#be185d" },
  grid: { bg: "#ccfbf1", text: "#0f766e" },
  chart: { bg: "#ffedd5", text: "#c2410c" },
  provider: { bg: "#f3e8ff", text: "#7c3aed" },
  template: { bg: "#fef9c3", text: "#854d0e" },
  loading: { bg: "#e0f2fe", text: "#0369a1" },
  error: { bg: "#fee2e2", text: "#dc2626" },
  hook: { bg: "#fef3c7", text: "#92400e" },
  util: { bg: "#ecfdf5", text: "#065f46" },
  route: { bg: "#ede9fe", text: "#6d28d9" },
};

// ─── Summary Card ───────────────────────────────────────────

interface SummaryCardProps {
  label: string;
  value: number | string;
  color?: string;
  small?: boolean;
}

export function SummaryCard({ label, value, color = "#3b82f6", small }: SummaryCardProps) {
  return (
    <div
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: "8px",
        padding: small ? "10px 12px" : "16px",
        background: "#fff",
        borderTop: `3px solid ${color}`,
      }}
    >
      <div style={{ fontSize: small ? "20px" : "28px", fontWeight: 700, color }}>
        {value}
      </div>
      <div style={{ fontSize: small ? "11px" : "13px", color: "#6b7280", marginTop: "2px" }}>
        {label}
      </div>
    </div>
  );
}

// ─── Summary Grid ───────────────────────────────────────────

const SUMMARY_ITEMS: {
  key: keyof IntelligenceSummary;
  label: string;
  color: string;
}[] = [
  { key: "screens", label: "Screens", color: "#8b5cf6" },
  { key: "components", label: "Components", color: "#3b82f6" },
  { key: "reusableComponents", label: "Reusable", color: "#10b981" },
  { key: "hooks", label: "Hooks", color: "#f59e0b" },
  { key: "utils", label: "Utils", color: "#06b6d4" },
  { key: "dialogs", label: "Dialogs", color: "#ec4899" },
  { key: "grids", label: "Grids", color: "#14b8a6" },
  { key: "charts", label: "Charts", color: "#f97316" },
  { key: "providers", label: "Providers", color: "#8b5cf6" },
  { key: "clientComponents", label: "Client", color: "#ef4444" },
  { key: "serverComponents", label: "Server", color: "#22c55e" },
  { key: "avgComplexity", label: "Avg Complexity", color: "#6366f1" },
  { key: "maxComplexity", label: "Max Complexity", color: "#dc2626" },
];

export function SummaryGrid({ summary }: { summary: IntelligenceSummary }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
        gap: "10px",
      }}
    >
      {SUMMARY_ITEMS.map((item) => (
        <SummaryCard
          key={item.key}
          label={item.label}
          value={summary[item.key]}
          color={item.color}
          small
        />
      ))}
    </div>
  );
}

// ─── Type Badge ─────────────────────────────────────────────

function TypeBadge({ type }: { type: string }) {
  const colors = TYPE_COLORS[type] ?? TYPE_COLORS.component;
  return (
    <span
      style={{
        fontSize: "10px",
        padding: "1px 6px",
        borderRadius: "9999px",
        background: colors.bg,
        color: colors.text,
        fontWeight: 500,
        whiteSpace: "nowrap",
      }}
    >
      {type}
    </span>
  );
}

// ─── Route Tree (LEFT panel) ────────────────────────────────

interface RouteTreeProps {
  routes: RouteMeta[];
  routeIntelligence: Record<string, RouteIntelligence>;
  selectedRoute: string | null;
  onSelectRoute: (path: string) => void;
}

export function RouteTree({
  routes,
  routeIntelligence,
  selectedRoute,
  onSelectRoute,
}: RouteTreeProps) {
  // Group routes into a tree structure
  const tree = useMemo(() => buildRouteTree(routes), [routes]);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid #e5e7eb",
          fontWeight: 600,
          fontSize: "13px",
          color: "#374151",
          background: "#f9fafb",
        }}
      >
        Routes ({routes.length})
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}>
        {tree.map((node) => (
          <RouteTreeNode
            key={node.path}
            node={node}
            routeIntelligence={routeIntelligence}
            selectedRoute={selectedRoute}
            onSelectRoute={onSelectRoute}
            depth={0}
          />
        ))}
      </div>
    </div>
  );
}

interface TreeNode {
  segment: string;
  path: string;
  isRoute: boolean;
  segmentType?: string;
  children: TreeNode[];
}

function buildRouteTree(routes: RouteMeta[]): TreeNode[] {
  const root: TreeNode[] = [];

  for (const route of routes.sort((a, b) => a.path.localeCompare(b.path))) {
    const segments = route.path === "/" ? ["/"] : route.path.split("/").filter(Boolean);

    let current = root;
    let currentPath = "";

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i]!;
      currentPath += "/" + segment;
      if (currentPath === "//") currentPath = "/";

      let existing = current.find((n) => n.segment === segment);
      if (!existing) {
        existing = {
          segment,
          path: currentPath,
          isRoute: i === segments.length - 1,
          segmentType: i === segments.length - 1 ? route.segmentType : undefined,
          children: [],
        };
        current.push(existing);
      }
      if (i === segments.length - 1) {
        existing.isRoute = true;
        existing.segmentType = route.segmentType;
      }
      current = existing.children;
    }
  }

  return root;
}

function RouteTreeNode({
  node,
  routeIntelligence,
  selectedRoute,
  onSelectRoute,
  depth,
}: {
  node: TreeNode;
  routeIntelligence: Record<string, RouteIntelligence>;
  selectedRoute: string | null;
  onSelectRoute: (path: string) => void;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(true);
  const isSelected = selectedRoute === node.path;
  const intel = routeIntelligence[node.path];
  const hasChildren = node.children.length > 0;

  return (
    <div>
      <div
        onClick={() => {
          if (node.isRoute) onSelectRoute(node.path);
          if (hasChildren) setExpanded(!expanded);
        }}
        style={{
          padding: "5px 12px",
          paddingLeft: `${12 + depth * 16}px`,
          display: "flex",
          alignItems: "center",
          gap: "6px",
          cursor: node.isRoute ? "pointer" : hasChildren ? "pointer" : "default",
          background: isSelected ? "#eff6ff" : "transparent",
          borderRight: isSelected ? "3px solid #3b82f6" : "3px solid transparent",
          fontSize: "13px",
          fontFamily: "monospace",
          color: node.isRoute ? "#111827" : "#9ca3af",
          fontWeight: isSelected ? 600 : 400,
        }}
      >
        {hasChildren && (
          <span style={{ fontSize: "10px", color: "#9ca3af", width: "12px" }}>
            {expanded ? "▼" : "▶"}
          </span>
        )}
        {!hasChildren && <span style={{ width: "12px" }} />}
        <span style={{ flex: 1 }}>{node.segment === "/" ? "/" : node.segment}</span>
        {intel && (
          <span
            style={{
              fontSize: "10px",
              color: "#9ca3af",
              fontFamily: "system-ui",
            }}
          >
            {intel.components.length}c · {intel.hooks.length}h
          </span>
        )}
        {node.segmentType && node.segmentType !== "static" && (
          <TypeBadge type={node.segmentType} />
        )}
      </div>
      {expanded &&
        hasChildren &&
        node.children.map((child) => (
          <RouteTreeNode
            key={child.path}
            node={child}
            routeIntelligence={routeIntelligence}
            selectedRoute={selectedRoute}
            onSelectRoute={onSelectRoute}
            depth={depth + 1}
          />
        ))}
    </div>
  );
}

// ─── Route Intelligence Panel (CENTER) ──────────────────────

interface RouteIntelligencePanelProps {
  intelligence: RouteIntelligence | null;
  componentUsage: ComponentUsageMap;
  allComponents: Record<string, ComponentMeta>;
  path: string | null;
}

export function RouteIntelligencePanel({
  intelligence,
  componentUsage,
  allComponents,
  path,
}: RouteIntelligencePanelProps) {
  if (!intelligence || !path) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          color: "#9ca3af",
          fontSize: "14px",
        }}
      >
        Select a route to view its intelligence
      </div>
    );
  }

  const sections: { title: string; items: string[]; type: string; color: string }[] = [
    { title: "Components", items: intelligence.components, type: "component", color: "#3b82f6" },
    { title: "Hooks", items: intelligence.hooks, type: "hook", color: "#f59e0b" },
    { title: "Utils", items: intelligence.utils, type: "util", color: "#06b6d4" },
    { title: "Providers", items: intelligence.providers, type: "provider", color: "#8b5cf6" },
    { title: "Dialogs", items: intelligence.dialogs, type: "dialog", color: "#ec4899" },
    { title: "Grids", items: intelligence.grids, type: "grid", color: "#14b8a6" },
    { title: "Charts", items: intelligence.charts, type: "chart", color: "#f97316" },
  ];

  const searchParamEntries = Object.entries(intelligence.searchParams);

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: "16px" }}>
      {/* Route Header */}
      <div style={{ marginBottom: "20px" }}>
        <h2
          style={{
            fontSize: "18px",
            fontWeight: 700,
            fontFamily: "monospace",
            margin: "0 0 4px 0",
            color: "#111827",
          }}
        >
          {path}
        </h2>
        <div style={{ fontSize: "12px", color: "#6b7280", fontFamily: "monospace" }}>
          {intelligence.relativePath}
        </div>
      </div>

      {/* Complexity Bar */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: "10px",
          marginBottom: "20px",
        }}
      >
        <SummaryCard label="Depth" value={intelligence.complexity.depth} color="#6366f1" small />
        <SummaryCard
          label="Components"
          value={intelligence.complexity.components}
          color="#3b82f6"
          small
        />
        <SummaryCard
          label="Dependencies"
          value={intelligence.complexity.dependencies}
          color="#dc2626"
          small
        />
      </div>

      {/* Dynamic Params */}
      {intelligence.dynamicParams.length > 0 && (
        <IntelSection title="Dynamic Params" color="#8b5cf6">
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            {intelligence.dynamicParams.map((p) => (
              <code
                key={p}
                style={{
                  fontSize: "12px",
                  padding: "2px 8px",
                  borderRadius: "4px",
                  background: "#f3e8ff",
                  color: "#7c3aed",
                }}
              >
                [{p}]
              </code>
            ))}
          </div>
        </IntelSection>
      )}

      {/* Search Params */}
      {searchParamEntries.length > 0 && (
        <IntelSection title="Search Params" color="#f59e0b">
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {searchParamEntries.map(([param, usage]) => (
              <div
                key={param}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "4px 8px",
                  background: "#fffbeb",
                  borderRadius: "4px",
                  fontSize: "12px",
                }}
              >
                <code style={{ fontWeight: 600, color: "#92400e" }}>{param}</code>
                <span style={{ color: "#6b7280" }}>
                  {usage.usedIn.join(", ")} ({usage.accessPattern})
                </span>
              </div>
            ))}
          </div>
        </IntelSection>
      )}

      {/* Component Sections */}
      {sections.map(
        (section) =>
          section.items.length > 0 && (
            <IntelSection key={section.title} title={section.title} color={section.color}>
              <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                {section.items.map((item) => {
                  const usage = componentUsage[item];
                  const isReusable = usage && usage.usedInRoutes.length > 1;
                  // Find composite info
                  const compMeta = Object.values(allComponents).find((c) => c.name === item);
                  const isComposite = compMeta?.isComposite ?? false;
                  return (
                    <div key={item}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          padding: "3px 8px",
                          borderRadius: "4px",
                          fontSize: "12px",
                          background: isReusable ? "#ecfdf5" : "transparent",
                        }}
                      >
                        <span style={{ fontWeight: 500, fontFamily: "monospace" }}>
                          {item}
                          {isComposite && (
                            <span
                              style={{
                                fontSize: "9px",
                                marginLeft: "6px",
                                padding: "1px 5px",
                                borderRadius: "9999px",
                                background: "#dbeafe",
                                color: "#1d4ed8",
                                fontWeight: 600,
                                fontFamily: "system-ui",
                              }}
                            >
                              composite
                            </span>
                          )}
                        </span>
                        <span style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                          <TypeBadge type={section.type} />
                          {isReusable && (
                            <span
                              style={{
                                fontSize: "10px",
                                color: "#059669",
                                fontWeight: 600,
                              }}
                            >
                              {usage!.usedInRoutes.length} routes
                            </span>
                          )}
                        </span>
                      </div>
                      {isComposite && compMeta!.subComponents.length > 0 && (
                        <div
                          style={{
                            paddingLeft: "20px",
                            display: "flex",
                            gap: "4px",
                            flexWrap: "wrap",
                            marginTop: "2px",
                            marginBottom: "4px",
                          }}
                        >
                          {compMeta!.subComponents.map((sub) => (
                            <span
                              key={sub}
                              style={{
                                fontSize: "10px",
                                padding: "1px 6px",
                                borderRadius: "4px",
                                background: "#f3f4f6",
                                color: "#6b7280",
                                fontFamily: "monospace",
                              }}
                            >
                              .{sub}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </IntelSection>
          )
      )}

      {/* Special Files */}
      <IntelSection title="Route Files" color="#6b7280">
        <div style={{ display: "flex", flexDirection: "column", gap: "3px", fontSize: "12px" }}>
          <FileRow label="page" path={intelligence.relativePath} />
          {intelligence.layoutFilePath && (
            <FileRow label="layout" path={intelligence.layoutFilePath} />
          )}
          {intelligence.loadingFilePath && (
            <FileRow label="loading" path={intelligence.loadingFilePath} />
          )}
          {intelligence.errorFilePath && (
            <FileRow label="error" path={intelligence.errorFilePath} />
          )}
          {intelligence.templateFilePath && (
            <FileRow label="template" path={intelligence.templateFilePath} />
          )}
        </div>
      </IntelSection>
    </div>
  );
}

function IntelSection({
  title,
  color,
  children,
}: {
  title: string;
  color: string;
  children: ReactNode;
}) {
  return (
    <div style={{ marginBottom: "16px" }}>
      <div
        style={{
          fontSize: "12px",
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
          style={{ width: "3px", height: "14px", background: color, borderRadius: "2px" }}
        />
        {title}
      </div>
      {children}
    </div>
  );
}

function FileRow({ label, path }: { label: string; path: string }) {
  return (
    <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
      <span
        style={{
          fontSize: "10px",
          fontWeight: 600,
          color: "#6b7280",
          textTransform: "uppercase",
          width: "60px",
        }}
      >
        {label}
      </span>
      <code style={{ color: "#374151", fontFamily: "monospace", fontSize: "11px" }}>
        {typeof path === "string" ? path.replace(/\\/g, "/").split("/").slice(-3).join("/") : ""}
      </code>
    </div>
  );
}

// ─── Dependency Hierarchy (RIGHT panel) ─────────────────────

interface DependencyHierarchyProps {
  intelligence: RouteIntelligence | null;
  allComponents: Record<string, ComponentMeta>;
  graph: DependencyGraph;
}

export function DependencyHierarchy({
  intelligence,
  allComponents,
  graph,
}: Readonly<DependencyHierarchyProps>) {
  // Build a dependency tree for this route (always call hook)
  const depTree = useMemo(
    () =>
      intelligence
        ? buildDependencyTree(intelligence, allComponents, graph)
        : [],
    [intelligence, allComponents, graph]
  );

  if (!intelligence) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          color: "#9ca3af",
          fontSize: "13px",
        }}
      >
        Select a route
      </div>
    );
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid #e5e7eb",
          fontWeight: 600,
          fontSize: "13px",
          color: "#374151",
          background: "#f9fafb",
        }}
      >
        Dependencies ({intelligence.dependencyCount})
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
        {depTree.map((node) => (
          <DepTreeNode key={node.name} node={node} depth={0} />
        ))}
      </div>
    </div>
  );
}

interface DepNode {
  name: string;
  type: string;
  children: DepNode[];
}

function buildDependencyTree(
  intelligence: RouteIntelligence,
  allComponents: Record<string, ComponentMeta>,
  graph: DependencyGraph
): DepNode[] {
  const nodes: DepNode[] = [];

  // Group by type
  const groups: { label: string; items: string[]; type: string }[] = [
    { label: "Components", items: intelligence.components, type: "component" },
    { label: "Hooks", items: intelligence.hooks, type: "hook" },
    { label: "Utils", items: intelligence.utils, type: "util" },
    { label: "Providers", items: intelligence.providers, type: "provider" },
    { label: "Dialogs", items: intelligence.dialogs, type: "dialog" },
    { label: "Grids", items: intelligence.grids, type: "grid" },
    { label: "Charts", items: intelligence.charts, type: "chart" },
  ];

  for (const group of groups) {
    if (group.items.length === 0) continue;
    nodes.push({
      name: `${group.label} (${group.items.length})`,
      type: "group",
      children: group.items.map((item) => {
        // Find child components this item renders
        const comp = Object.values(allComponents).find((c) => c.name === item);
        const childEdges = comp
          ? graph.edges.filter(
              (e) => e.source === comp.id && e.relationship === "renders"
            )
          : [];
        const children = childEdges
          .map((e) => {
            const target = allComponents[e.target];
            return target
              ? { name: target.name, type: target.type, children: [] }
              : null;
          })
          .filter(Boolean) as DepNode[];

        return {
          name: item,
          type: comp?.type ?? group.type,
          children,
        };
      }),
    });
  }

  return nodes;
}

function DepTreeNode({ node, depth }: { node: DepNode; depth: number }) {
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = node.children.length > 0;

  return (
    <div>
      <div
        onClick={() => hasChildren && setExpanded(!expanded)}
        style={{
          padding: "3px 12px",
          paddingLeft: `${12 + depth * 16}px`,
          display: "flex",
          alignItems: "center",
          gap: "6px",
          cursor: hasChildren ? "pointer" : "default",
          fontSize: "12px",
          fontFamily: node.type === "group" ? "system-ui" : "monospace",
          fontWeight: node.type === "group" ? 600 : 400,
          color: node.type === "group" ? "#374151" : "#111827",
        }}
      >
        {hasChildren ? (
          <span style={{ fontSize: "9px", color: "#9ca3af", width: "10px" }}>
            {expanded ? "▼" : "▶"}
          </span>
        ) : (
          <span style={{ width: "10px" }} />
        )}
        <span style={{ flex: 1 }}>{node.name}</span>
        {node.type !== "group" && <TypeBadge type={node.type} />}
      </div>
      {expanded &&
        hasChildren &&
        node.children.map((child) => (
          <DepTreeNode key={child.name} node={child} depth={depth + 1} />
        ))}
    </div>
  );
}

// ─── Component Usage Table ──────────────────────────────────

interface ComponentUsageTableProps {
  componentUsage: ComponentUsageMap;
}

export function ComponentUsageTable({ componentUsage }: ComponentUsageTableProps) {
  const entries = useMemo(
    () =>
      Object.entries(componentUsage)
        .map(([name, usage]) => ({ name, ...usage }))
        .sort((a, b) => b.usedInRoutes.length - a.usedInRoutes.length),
    [componentUsage]
  );

  const reusable = entries.filter((e) => e.usedInRoutes.length > 1);

  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: "8px", overflow: "hidden" }}>
      <div
        style={{
          padding: "12px 16px",
          background: "#f9fafb",
          fontWeight: 600,
          fontSize: "14px",
          borderBottom: "1px solid #e5e7eb",
        }}
      >
        Reusable Components ({reusable.length})
      </div>
      <div style={{ overflowX: "auto", maxHeight: "400px", overflowY: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
          <thead>
            <tr style={{ background: "#f9fafb", position: "sticky", top: 0 }}>
              <th style={thStyle}>Component</th>
              <th style={thStyle}>Type</th>
              <th style={thStyle}>Routes</th>
              <th style={thStyle}>Usage</th>
            </tr>
          </thead>
          <tbody>
            {reusable.map((entry) => (
              <tr key={entry.name} style={{ borderBottom: "1px solid #f3f4f6" }}>
                <td style={tdStyle}>
                  <code style={{ fontWeight: 500, fontSize: "12px" }}>{entry.name}</code>
                </td>
                <td style={tdStyle}>
                  <TypeBadge type={entry.type} />
                </td>
                <td style={tdStyle}>
                  <div
                    style={{
                      display: "flex",
                      gap: "4px",
                      flexWrap: "wrap",
                    }}
                  >
                    {entry.usedInRoutes.map((r) => (
                      <code
                        key={r}
                        style={{
                          fontSize: "10px",
                          background: "#f3f4f6",
                          padding: "1px 4px",
                          borderRadius: "2px",
                        }}
                      >
                        {r}
                      </code>
                    ))}
                  </div>
                </td>
                <td style={tdStyle}>
                  <span style={{ fontWeight: 600, color: "#059669" }}>
                    {entry.usedInRoutes.length}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 12px",
  fontWeight: 600,
  fontSize: "11px",
  color: "#6b7280",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  borderBottom: "1px solid #e5e7eb",
};

const tdStyle: React.CSSProperties = {
  padding: "6px 12px",
};

// ─── Runtime Tree ───────────────────────────────────────────

interface RuntimeTreeProps {
  runtime: IntelligenceManifest["runtime"];
  components: IntelligenceManifest["components"];
}

export function RuntimeTree({ runtime, components }: RuntimeTreeProps) {
  const entries = Object.values(runtime).sort((a, b) => b.mountCount - a.mountCount);

  if (entries.length === 0) {
    return (
      <div
        style={{
          border: "1px solid #e5e7eb",
          borderRadius: "8px",
          padding: "24px",
          textAlign: "center",
          color: "#9ca3af",
          fontSize: "13px",
        }}
      >
        No runtime data. Run with <code>&lt;IntelligenceProvider&gt;</code> to collect.
      </div>
    );
  }

  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: "8px", overflow: "hidden" }}>
      <div
        style={{
          padding: "12px 16px",
          background: "#f9fafb",
          fontWeight: 600,
          fontSize: "14px",
          borderBottom: "1px solid #e5e7eb",
        }}
      >
        Runtime ({entries.length})
      </div>
      <div style={{ maxHeight: "400px", overflowY: "auto" }}>
        {entries.map((meta) => {
          const component = components[meta.componentId];
          return (
            <div
              key={meta.componentId}
              style={{
                padding: "8px 16px",
                borderBottom: "1px solid #f3f4f6",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                fontSize: "12px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span style={{ fontWeight: 500 }}>
                  {component?.name ?? meta.componentId}
                </span>
                {component && <TypeBadge type={component.type} />}
              </div>
              <div style={{ display: "flex", gap: "12px", color: "#6b7280", fontSize: "11px" }}>
                <span>M:{meta.mountCount}</span>
                <span>R:{meta.renderCount}</span>
                <span>{meta.averageRenderDuration.toFixed(1)}ms</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main Dashboard ─────────────────────────────────────────

interface IntelligenceDashboardProps {
  manifestUrl?: string;
  manifest?: IntelligenceManifest;
}

export function IntelligenceDashboard({
  manifestUrl,
  manifest: inlineManifest,
}: IntelligenceDashboardProps) {
  const { manifest, loading, error } = useManifestData({
    manifestUrl,
    data: inlineManifest,
  });

  const [selectedRoute, setSelectedRoute] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<"intelligence" | "graph" | "usage" | "runtime">(
    "intelligence"
  );

  const selectedIntel = selectedRoute
    ? manifest?.routeIntelligence[selectedRoute] ?? null
    : null;

  if (loading) {
    return (
      <div style={{ padding: "48px", textAlign: "center", color: "#9ca3af" }}>
        Loading intelligence data...
      </div>
    );
  }

  if (error || !manifest) {
    return (
      <div style={{ padding: "48px", textAlign: "center", color: "#ef4444" }}>
        Failed to load: {error ?? "No data"}
      </div>
    );
  }

  return (
    <div
      style={{
        fontFamily: "system-ui, -apple-system, sans-serif",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "#fff",
        overflow: "hidden",
      }}
    >
      {/* Top Bar */}
      <div
        style={{
          padding: "12px 20px",
          borderBottom: "1px solid #e5e7eb",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          background: "#fafafa",
        }}
      >
        <div>
          <h1 style={{ fontSize: "16px", fontWeight: 700, margin: 0, color: "#111827" }}>
            Route Intelligence Engine
          </h1>
          <span style={{ fontSize: "11px", color: "#9ca3af" }}>
            {manifest.summary.screens} routes · {manifest.summary.components} components ·{" "}
            {new Date(manifest.generatedAt).toLocaleString()}
          </span>
        </div>
        <div style={{ display: "flex", gap: "4px" }}>
          {(["intelligence", "graph", "usage", "runtime"] as const).map((view) => (
            <button
              key={view}
              onClick={() => setActiveView(view)}
              style={{
                padding: "4px 12px",
                borderRadius: "6px",
                border: "1px solid",
                borderColor: activeView === view ? "#3b82f6" : "#e5e7eb",
                background: activeView === view ? "#eff6ff" : "#fff",
                color: activeView === view ? "#3b82f6" : "#6b7280",
                cursor: "pointer",
                fontSize: "12px",
                fontWeight: activeView === view ? 600 : 400,
                textTransform: "capitalize",
              }}
            >
              {view}
            </button>
          ))}
        </div>
      </div>

      {/* Summary Strip */}
      {activeView !== "graph" && (
        <div style={{ padding: "12px 20px", borderBottom: "1px solid #e5e7eb", flexShrink: 0 }}>
          <SummaryGrid summary={manifest.summary} />
        </div>
      )}

      {/* Main Content */}
      {activeView === "intelligence" ? (
        <div
          style={{
            flex: 1,
            display: "grid",
            gridTemplateColumns: "260px 1fr 280px",
            overflow: "hidden",
          }}
        >
          {/* LEFT: Route Tree */}
          <div style={{ borderRight: "1px solid #e5e7eb", overflow: "hidden" }}>
            <RouteTree
              routes={manifest.routes}
              routeIntelligence={manifest.routeIntelligence}
              selectedRoute={selectedRoute}
              onSelectRoute={setSelectedRoute}
            />
          </div>

          {/* CENTER: Route Intelligence */}
          <div style={{ overflow: "hidden" }}>
            <RouteIntelligencePanel
              intelligence={selectedIntel}
              componentUsage={manifest.componentUsage}
              allComponents={manifest.components}
              path={selectedRoute}
            />
          </div>

          {/* RIGHT: Dependency Hierarchy */}
          <div style={{ borderLeft: "1px solid #e5e7eb", overflow: "hidden" }}>
            <DependencyHierarchy
              intelligence={selectedIntel}
              allComponents={manifest.components}
              graph={manifest.graph}
            />
          </div>
        </div>
      ) : activeView === "graph" ? (
        <div style={{ flex: "1 1 0%", overflow: "hidden", position: "relative", minHeight: "400px" }}>
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}>
            <Suspense
              fallback={
                <div style={{ padding: "48px", textAlign: "center", color: "#9ca3af" }}>
                  Loading graph...
                </div>
              }
            >
              <LazyRouteFlowGraph
                manifest={manifest}
                selectedRoute={selectedRoute}
                onRouteSelect={setSelectedRoute}
              />
            </Suspense>
          </div>
        </div>
      ) : activeView === "usage" ? (
        <div style={{ flex: 1, overflow: "auto", padding: "20px" }}>
          <ComponentUsageTable componentUsage={manifest.componentUsage} />
        </div>
      ) : (
        <div style={{ flex: 1, overflow: "auto", padding: "20px" }}>
          <RuntimeTree runtime={manifest.runtime} components={manifest.components} />
        </div>
      )}
    </div>
  );
}
