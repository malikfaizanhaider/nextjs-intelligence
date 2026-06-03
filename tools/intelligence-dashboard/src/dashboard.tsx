"use client";

import { useState, useEffect, useMemo, lazy, Suspense, useCallback, type ReactNode } from "react";
import type {
  IntelligenceManifest,
  IntelligenceSummary,
  ComponentMeta,
  RouteMeta,
  RouteIntelligence,
  ComponentUsageMap,
  DependencyGraph,
} from "../../intelligence-types/src/index";
import { useTheme } from "./tokens";

const LazyRouteFlowGraph = lazy(() =>
  import("./route-flow-graph").then((mod) => ({ default: mod.RouteFlowGraph }))
);
const LazyCommandPalette = lazy(() =>
  import("./command-palette").then((mod) => ({ default: mod.CommandPalette }))
);

// ─── Data Hook ──────────────────────────────────────────────

interface UseManifestDataOptions {
  manifestUrl?: string;
  data?: IntelligenceManifest;
}

export function useManifestData(options: UseManifestDataOptions) {
  const [retryKey, setRetryKey] = useState(0);
  const [manifest, setManifest] = useState<IntelligenceManifest | null>(
    options.data ?? null
  );
  const [loading, setLoading] = useState(!options.data);
  const [error, setError] = useState<string | null>(null);

  const retry = useCallback(() => {
    setError(null);
    setLoading(true);
    setRetryKey((prev) => prev + 1);
  }, []);

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
  }, [options.manifestUrl, options.data, retryKey]);

  return { manifest, loading, error, retry };
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
        border: "1px solid var(--c-border)",
        borderRadius: "8px",
        padding: small ? "10px 12px" : "16px",
        background: "var(--c-surface)",
        borderTop: `3px solid ${color}`,
      }}
    >
      <div style={{ fontSize: small ? "20px" : "28px", fontWeight: 700, color }}>
        {value}
      </div>
      <div style={{ fontSize: small ? "11px" : "13px", color: "var(--c-text-muted)", marginTop: "2px" }}>
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
          borderBottom: "1px solid var(--c-border)",
          fontWeight: 600,
          fontSize: "13px",
          color: "var(--c-text)",
          background: "var(--c-surface-alt)",
        }}
      >
        Routes ({routes.length})
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "4px 0" }} role="tree" aria-label="Routes">
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
  const isInteractive = node.isRoute || hasChildren;

  const activate = () => {
    if (node.isRoute) onSelectRoute(node.path);
    if (hasChildren) setExpanded((v) => !v);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activate();
    } else if (event.key === "ArrowRight" && hasChildren && !expanded) {
      setExpanded(true);
    } else if (event.key === "ArrowLeft" && hasChildren && expanded) {
      setExpanded(false);
    }
  };

  return (
    <div>
      <div
        onClick={activate}
        onKeyDown={isInteractive ? handleKeyDown : undefined}
        role={isInteractive ? "treeitem" : undefined}
        tabIndex={isInteractive ? 0 : -1}
        aria-level={depth + 1}
        aria-selected={node.isRoute ? isSelected : undefined}
        aria-expanded={hasChildren ? expanded : undefined}
        style={{
          padding: "5px 12px",
          paddingLeft: `${12 + depth * 16}px`,
          display: "flex",
          alignItems: "center",
          gap: "6px",
          cursor: isInteractive ? "pointer" : "default",
          background: isSelected ? "#eff6ff" : "transparent",
          borderRight: isSelected ? "3px solid #3b82f6" : "3px solid transparent",
          fontSize: "13px",
          fontFamily: "monospace",
          color: node.isRoute ? "#111827" : "#9ca3af",
          fontWeight: isSelected ? 600 : 400,
          outline: "none",
        }}
        onFocus={(event) => {
          event.currentTarget.style.boxShadow = "inset 0 0 0 2px #3b82f6";
        }}
        onBlur={(event) => {
          event.currentTarget.style.boxShadow = "none";
        }}
      >
        {hasChildren && (
          <span style={{ fontSize: "10px", color: "var(--c-text-faint)", width: "12px" }}>
            {expanded ? "▼" : "▶"}
          </span>
        )}
        {!hasChildren && <span style={{ width: "12px" }} />}
        <span style={{ flex: 1 }}>{node.segment === "/" ? "/" : node.segment}</span>
        {intel && (
          <span
            style={{
              fontSize: "10px",
              color: "var(--c-text-faint)",
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
          color: "var(--c-text-faint)",
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
            color: "var(--c-text)",
          }}
        >
          {path}
        </h2>
        <div style={{ fontSize: "12px", color: "var(--c-text-muted)", fontFamily: "monospace" }}>
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
          <SearchParamsView entries={searchParamEntries} />
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
                  const isLazy =
                    section.type === "component" &&
                    intelligence.lazyComponents?.includes(item) === true;
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
                          {isLazy && (
                            <span
                              style={{
                                fontSize: "9px",
                                marginLeft: "6px",
                                padding: "1px 5px",
                                borderRadius: "9999px",
                                background: "#fef3c7",
                                color: "#92400e",
                                fontWeight: 600,
                                fontFamily: "system-ui",
                              }}
                              title="Loaded via next/dynamic or import()"
                            >
                              lazy
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
                                color: "var(--c-text-muted)",
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
          color: "var(--c-text-muted)",
          textTransform: "uppercase",
          width: "60px",
        }}
      >
        {label}
      </span>
      <code style={{ color: "var(--c-text)", fontFamily: "monospace", fontSize: "11px" }}>
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
          color: "var(--c-text-faint)",
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
          borderBottom: "1px solid var(--c-border)",
          fontWeight: 600,
          fontSize: "13px",
          color: "var(--c-text)",
          background: "var(--c-surface-alt)",
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

  const toggle = () => {
    if (hasChildren) setExpanded((v) => !v);
  };
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!hasChildren) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggle();
    } else if (event.key === "ArrowRight" && !expanded) {
      setExpanded(true);
    } else if (event.key === "ArrowLeft" && expanded) {
      setExpanded(false);
    }
  };

  return (
    <div>
      <div
        onClick={toggle}
        onKeyDown={hasChildren ? handleKeyDown : undefined}
        role={hasChildren ? "treeitem" : undefined}
        tabIndex={hasChildren ? 0 : -1}
        aria-level={depth + 1}
        aria-expanded={hasChildren ? expanded : undefined}
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
          outline: "none",
        }}
        onFocus={(event) => {
          event.currentTarget.style.boxShadow = "inset 0 0 0 2px #3b82f6";
        }}
        onBlur={(event) => {
          event.currentTarget.style.boxShadow = "none";
        }}
      >
        {hasChildren ? (
          <span style={{ fontSize: "9px", color: "var(--c-text-faint)", width: "10px" }}>
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
    <div style={{ border: "1px solid var(--c-border)", borderRadius: "8px", overflow: "hidden" }}>
      <div
        style={{
          padding: "12px 16px",
          background: "var(--c-surface-alt)",
          fontWeight: 600,
          fontSize: "14px",
          borderBottom: "1px solid var(--c-border)",
        }}
      >
        Reusable Components ({reusable.length})
      </div>
      <div style={{ overflowX: "auto", maxHeight: "400px", overflowY: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
          <thead>
            <tr style={{ background: "var(--c-surface-alt)", position: "sticky", top: 0 }}>
              <th style={thStyle}>Component</th>
              <th style={thStyle}>Type</th>
              <th style={thStyle}>Routes</th>
              <th style={thStyle}>Usage</th>
            </tr>
          </thead>
          <tbody>
            {reusable.map((entry) => (
              <tr key={entry.name} style={{ borderBottom: "1px solid var(--c-border-subtle)" }}>
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
  color: "var(--c-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  borderBottom: "1px solid var(--c-border)",
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
          border: "1px solid var(--c-border)",
          borderRadius: "8px",
          padding: "24px",
          textAlign: "center",
          color: "var(--c-text-faint)",
          fontSize: "13px",
        }}
      >
        No runtime data. Run with <code>&lt;IntelligenceProvider&gt;</code> to collect.
      </div>
    );
  }

  return (
    <div style={{ border: "1px solid var(--c-border)", borderRadius: "8px", overflow: "hidden" }}>
      <div
        style={{
          padding: "12px 16px",
          background: "var(--c-surface-alt)",
          fontWeight: 600,
          fontSize: "14px",
          borderBottom: "1px solid var(--c-border)",
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
                borderBottom: "1px solid var(--c-border-subtle)",
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
              <div style={{ display: "flex", gap: "12px", color: "var(--c-text-muted)", fontSize: "11px" }}>
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

// ─── Search Params View (grouped by access pattern) ────────

const ACCESS_PATTERN_LABEL: Record<string, string> = {
  searchParams: "props.searchParams",
  useSearchParams: "useSearchParams()",
  params: "props.params",
};

function SearchParamsView({
  entries,
}: {
  entries: [string, import("../../intelligence-types/src/index").SearchParamUsage][];
}) {
  const groups = useMemo(() => {
    const map = new Map<
      string,
      [string, import("../../intelligence-types/src/index").SearchParamUsage][]
    >();
    for (const entry of entries) {
      const key = entry[1].accessPattern;
      const list = map.get(key) ?? [];
      list.push(entry);
      map.set(key, list);
    }
    return Array.from(map.entries());
  }, [entries]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      {groups.map(([pattern, items]) => (
        <div key={pattern}>
          <div
            style={{
              fontSize: "10px",
              fontWeight: 600,
              color: "#92400e",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              marginBottom: "4px",
            }}
          >
            {ACCESS_PATTERN_LABEL[pattern] ?? pattern} · {items.length}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            {items.map(([param, usage]) => (
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
                  gap: "12px",
                }}
              >
                <code style={{ fontWeight: 600, color: "#92400e" }}>{param}</code>
                <span
                  style={{
                    color: "var(--c-text-muted)",
                    fontSize: "11px",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={usage.usedIn.join(", ")}
                >
                  {usage.usedIn.length} reader{usage.usedIn.length === 1 ? "" : "s"}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Diagnostics Panel ──────────────────────────────────────

const SEVERITY_STYLES: Record<
  string,
  { bg: string; text: string; border: string; icon: string }
> = {
  error: { bg: "#fee2e2", text: "#991b1b", border: "#fca5a5", icon: "✖" },
  warning: { bg: "#fef3c7", text: "#92400e", border: "#fcd34d", icon: "⚠" },
  info: { bg: "#dbeafe", text: "#1e40af", border: "#93c5fd", icon: "ℹ" },
};

interface DiagnosticsPanelProps {
  diagnostics: IntelligenceManifest["diagnostics"];
  onJumpToRoute?: (path: string) => void;
}

export function DiagnosticsPanel({ diagnostics, onJumpToRoute }: DiagnosticsPanelProps) {
  const [severityFilter, setSeverityFilter] = useState<"all" | "error" | "warning" | "info">(
    "all"
  );

  const filtered = useMemo(
    () =>
      severityFilter === "all"
        ? diagnostics
        : diagnostics.filter((d) => d.severity === severityFilter),
    [diagnostics, severityFilter]
  );

  const grouped = useMemo(() => {
    const map = new Map<string, typeof filtered>();
    for (const d of filtered) {
      const list = map.get(d.category) ?? [];
      list.push(d);
      map.set(d.category, list);
    }
    return Array.from(map.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [filtered]);

  if (diagnostics.length === 0) {
    return (
      <div
        style={{
          border: "1px solid var(--c-border)",
          borderRadius: "8px",
          padding: "32px",
          textAlign: "center",
          color: "#10b981",
          fontSize: "14px",
          background: "#f0fdf4",
        }}
      >
        ✓ No diagnostics — analyzer found no issues.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* Filter chips */}
      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
        {(["all", "error", "warning", "info"] as const).map((sev) => {
          const count =
            sev === "all" ? diagnostics.length : diagnostics.filter((d) => d.severity === sev).length;
          const active = severityFilter === sev;
          const stylesForSev = sev === "all" ? null : SEVERITY_STYLES[sev]!;
          return (
            <button
              key={sev}
              type="button"
              onClick={() => setSeverityFilter(sev)}
              style={{
                padding: "4px 10px",
                borderRadius: "9999px",
                border: "1px solid",
                borderColor: active
                  ? stylesForSev?.border ?? "#3b82f6"
                  : "#e5e7eb",
                background: active ? stylesForSev?.bg ?? "#eff6ff" : "#fff",
                color: active ? stylesForSev?.text ?? "#3b82f6" : "#6b7280",
                cursor: "pointer",
                fontSize: "11px",
                fontWeight: active ? 700 : 500,
                textTransform: "capitalize",
                display: "flex",
                gap: "6px",
                alignItems: "center",
              }}
            >
              {stylesForSev && <span>{stylesForSev.icon}</span>}
              {sev}
              <span style={{ opacity: 0.7 }}>({count})</span>
            </button>
          );
        })}
      </div>

      {/* Grouped list */}
      {grouped.map(([category, items]) => (
        <div
          key={category}
          style={{ border: "1px solid var(--c-border)", borderRadius: "8px", overflow: "hidden" }}
        >
          <div
            style={{
              padding: "10px 14px",
              background: "var(--c-surface-alt)",
              fontWeight: 600,
              fontSize: "13px",
              color: "var(--c-text)",
              borderBottom: "1px solid var(--c-border)",
              display: "flex",
              justifyContent: "space-between",
            }}
          >
            <span style={{ fontFamily: "monospace" }}>{category}</span>
            <span style={{ color: "var(--c-text-muted)", fontSize: "11px" }}>{items.length}</span>
          </div>
          <div>
            {items.map((d, idx) => (
              <DiagnosticRow
                key={`${category}-${idx}`}
                diagnostic={d}
                onJumpToRoute={onJumpToRoute}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function DiagnosticRow({
  diagnostic,
  onJumpToRoute,
}: {
  diagnostic: IntelligenceManifest["diagnostics"][number];
  onJumpToRoute?: (path: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const sev = SEVERITY_STYLES[diagnostic.severity] ?? SEVERITY_STYLES.info!;
  const hasDetails =
    Boolean(diagnostic.suggestion) ||
    Boolean(diagnostic.docUrl) ||
    (Array.isArray(diagnostic.relatedNodes) && diagnostic.relatedNodes.length > 0);

  return (
    <div
      style={{
        padding: "10px 14px",
        borderBottom: "1px solid var(--c-border-subtle)",
        fontSize: "12px",
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        background: "var(--c-surface)",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
        <span
          style={{
            color: sev.text,
            background: sev.bg,
            border: `1px solid ${sev.border}`,
            padding: "1px 6px",
            borderRadius: "4px",
            fontSize: "10px",
            fontWeight: 700,
            whiteSpace: "nowrap",
            lineHeight: 1.5,
          }}
        >
          {sev.icon} {diagnostic.severity}
        </span>
        <div style={{ flex: 1, color: "var(--c-text)", lineHeight: 1.45 }}>{diagnostic.message}</div>
        {hasDetails && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            style={{
              background: "transparent",
              border: "1px solid var(--c-border)",
              borderRadius: "4px",
              padding: "0 6px",
              cursor: "pointer",
              fontSize: "10px",
              color: "var(--c-text-muted)",
            }}
          >
            {open ? "−" : "+"}
          </button>
        )}
      </div>

      {(diagnostic.file || diagnostic.nodeId) && (
        <div style={{ color: "var(--c-text-muted)", fontFamily: "monospace", fontSize: "11px" }}>
          {diagnostic.file && <span>{diagnostic.file}</span>}
          {diagnostic.file && diagnostic.nodeId && <span> · </span>}
          {diagnostic.nodeId && <span>{diagnostic.nodeId}</span>}
        </div>
      )}

      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "4px" }}>
          {diagnostic.suggestion && (
            <div
              style={{
                background: "var(--c-surface-alt)",
                border: "1px solid var(--c-border)",
                borderRadius: "6px",
                padding: "8px 10px",
                color: "var(--c-text)",
                lineHeight: 1.5,
              }}
            >
              <div
                style={{
                  fontSize: "10px",
                  fontWeight: 700,
                  color: "var(--c-text-muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  marginBottom: "4px",
                }}
              >
                Suggestion
              </div>
              {diagnostic.suggestion}
            </div>
          )}
          {Array.isArray(diagnostic.relatedNodes) && diagnostic.relatedNodes.length > 0 && (
            <div>
              <div
                style={{
                  fontSize: "10px",
                  fontWeight: 700,
                  color: "var(--c-text-muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  marginBottom: "4px",
                }}
              >
                Related
              </div>
              <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
                {diagnostic.relatedNodes.map((node) => (
                  <button
                    key={node}
                    type="button"
                    onClick={() => onJumpToRoute?.(node)}
                    style={{
                      fontSize: "10px",
                      fontFamily: "monospace",
                      background: "#f3f4f6",
                      border: "1px solid var(--c-border)",
                      borderRadius: "4px",
                      padding: "1px 6px",
                      cursor: onJumpToRoute ? "pointer" : "default",
                      color: "var(--c-text)",
                    }}
                  >
                    {node}
                  </button>
                ))}
              </div>
            </div>
          )}
          {diagnostic.docUrl && (
            <a
              href={diagnostic.docUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: "#3b82f6",
                fontSize: "11px",
                textDecoration: "none",
              }}
            >
              📖 Read documentation →
            </a>
          )}
        </div>
      )}
    </div>
  );
}

// ─── API Routes Panel ───────────────────────────────────────

export function ApiRoutesPanel({ apiRoutes }: { apiRoutes: IntelligenceManifest["apiRoutes"] }) {
  if (apiRoutes.length === 0) {
    return <EmptyPanel message="No API routes found (no route.ts files)." />;
  }
  return (
    <div style={{ border: "1px solid var(--c-border)", borderRadius: "8px", overflow: "hidden" }}>
      <PanelHeader title="API Routes" count={apiRoutes.length} />
      <div style={{ overflowX: "auto", maxHeight: "500px", overflowY: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
          <thead>
            <tr style={{ background: "var(--c-surface-alt)", position: "sticky", top: 0 }}>
              <th style={thStyle}>Path</th>
              <th style={thStyle}>Methods</th>
              <th style={thStyle}>Segment</th>
              <th style={thStyle}>File</th>
            </tr>
          </thead>
          <tbody>
            {apiRoutes.map((route) => (
              <tr key={route.path} style={{ borderBottom: "1px solid var(--c-border-subtle)" }}>
                <td style={tdStyle}>
                  <code style={{ fontSize: "12px", fontWeight: 500 }}>{route.path}</code>
                </td>
                <td style={tdStyle}>
                  <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
                    {route.methods.map((m) => (
                      <span
                        key={m}
                        style={{
                          fontSize: "10px",
                          padding: "1px 6px",
                          borderRadius: "4px",
                          background: methodColor(m).bg,
                          color: methodColor(m).text,
                          fontWeight: 700,
                          fontFamily: "monospace",
                        }}
                      >
                        {m}
                      </span>
                    ))}
                  </div>
                </td>
                <td style={tdStyle}>
                  <TypeBadge type={route.isDynamic ? "dynamic" : route.segmentType} />
                </td>
                <td style={tdStyle}>
                  <code style={{ fontSize: "11px", color: "var(--c-text-muted)" }}>{route.relativePath}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function methodColor(method: string): { bg: string; text: string } {
  switch (method) {
    case "GET":
      return { bg: "#dcfce7", text: "#166534" };
    case "POST":
      return { bg: "#dbeafe", text: "#1e40af" };
    case "PUT":
    case "PATCH":
      return { bg: "#fef3c7", text: "#92400e" };
    case "DELETE":
      return { bg: "#fee2e2", text: "#991b1b" };
    default:
      return { bg: "#f3f4f6", text: "#374151" };
  }
}

// ─── Middleware Panel ───────────────────────────────────────

export function MiddlewarePanel({
  middleware,
}: {
  middleware: IntelligenceManifest["middleware"];
}) {
  if (middleware.length === 0) {
    return <EmptyPanel message="No middleware found (no middleware.ts file)." />;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      {middleware.map((mw) => (
        <div
          key={mw.relativePath}
          style={{ border: "1px solid var(--c-border)", borderRadius: "8px", overflow: "hidden" }}
        >
          <PanelHeader title={mw.relativePath} count={undefined} />
          <div style={{ padding: "12px 16px", fontSize: "12px", color: "var(--c-text)" }}>
            <div style={{ marginBottom: "8px" }}>
              <strong>Default export:</strong>{" "}
              <span style={{ color: mw.hasDefaultExport ? "#10b981" : "#ef4444" }}>
                {mw.hasDefaultExport ? "✓ present" : "✖ missing"}
              </span>
            </div>
            <div>
              <strong>Matchers:</strong>{" "}
              {mw.matcher === null ? (
                <em style={{ color: "var(--c-text-muted)" }}>none / dynamic</em>
              ) : mw.matcher.length === 0 ? (
                <em style={{ color: "var(--c-text-muted)" }}>empty (runs on every request)</em>
              ) : (
                <div
                  style={{ display: "flex", gap: "4px", flexWrap: "wrap", marginTop: "4px" }}
                >
                  {mw.matcher.map((m) => (
                    <code
                      key={m}
                      style={{
                        fontSize: "11px",
                        background: "#f3f4f6",
                        padding: "2px 6px",
                        borderRadius: "4px",
                      }}
                    >
                      {m}
                    </code>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Parallel Slots Panel ───────────────────────────────────

export function ParallelSlotsPanel({
  slots,
}: {
  slots: IntelligenceManifest["parallelSlots"];
}) {
  const byParent = useMemo(() => {
    const map = new Map<string, typeof slots>();
    for (const slot of slots) {
      const list = map.get(slot.parentPath) ?? [];
      list.push(slot);
      map.set(slot.parentPath, list);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [slots]);

  if (slots.length === 0) {
    return <EmptyPanel message="No parallel slots found (no @slot directories)." />;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      {byParent.map(([parent, parentSlots]) => (
        <div
          key={parent}
          style={{ border: "1px solid var(--c-border)", borderRadius: "8px", overflow: "hidden" }}
        >
          <PanelHeader title={parent === "" ? "/ (root layout)" : parent} count={parentSlots.length} />
          <div>
            {parentSlots.map((slot) => (
              <div
                key={slot.relativePath}
                style={{
                  padding: "10px 16px",
                  borderBottom: "1px solid var(--c-border-subtle)",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  fontSize: "12px",
                }}
              >
                <div>
                  <code style={{ fontWeight: 600, color: "#7c3aed" }}>@{slot.name}</code>
                  <span style={{ color: "var(--c-text-muted)", marginLeft: "10px", fontSize: "11px" }}>
                    {slot.relativePath}
                  </span>
                </div>
                <span
                  style={{
                    fontSize: "10px",
                    padding: "2px 8px",
                    borderRadius: "9999px",
                    background: slot.hasDefault ? "#dcfce7" : "#fee2e2",
                    color: slot.hasDefault ? "#166534" : "#991b1b",
                    fontWeight: 600,
                  }}
                >
                  {slot.hasDefault ? "default ✓" : "no default"}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Server Actions Panel ───────────────────────────────────

export function ServerActionsPanel({
  actions,
}: {
  actions: IntelligenceManifest["serverActions"];
}) {
  if (actions.length === 0) {
    return <EmptyPanel message='No server actions found (no "use server" directives).' />;
  }
  return (
    <div style={{ border: "1px solid var(--c-border)", borderRadius: "8px", overflow: "hidden" }}>
      <PanelHeader title="Server Actions" count={actions.length} />
      <div style={{ overflowX: "auto", maxHeight: "500px", overflowY: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
          <thead>
            <tr style={{ background: "var(--c-surface-alt)", position: "sticky", top: 0 }}>
              <th style={thStyle}>Export</th>
              <th style={thStyle}>Scope</th>
              <th style={thStyle}>File</th>
              <th style={thStyle}>Line</th>
            </tr>
          </thead>
          <tbody>
            {actions.map((a) => (
              <tr key={a.canonicalId} style={{ borderBottom: "1px solid var(--c-border-subtle)" }}>
                <td style={tdStyle}>
                  <code style={{ fontWeight: 500 }}>
                    {a.exportName === "__module__" ? <em>(module-level)</em> : a.exportName}
                  </code>
                </td>
                <td style={tdStyle}>
                  <span
                    style={{
                      fontSize: "10px",
                      padding: "1px 6px",
                      borderRadius: "4px",
                      background: a.scope === "module" ? "#e0e7ff" : "#fef3c7",
                      color: a.scope === "module" ? "#4338ca" : "#92400e",
                      fontWeight: 600,
                    }}
                  >
                    {a.scope}
                  </span>
                </td>
                <td style={tdStyle}>
                  <code style={{ fontSize: "11px", color: "var(--c-text-muted)" }}>{a.relativePath}</code>
                </td>
                <td style={tdStyle}>{a.line}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Shared sub-components ──────────────────────────────────

function PanelHeader({ title, count }: { title: string; count: number | undefined }) {
  return (
    <div
      style={{
        padding: "12px 16px",
        background: "var(--c-surface-alt)",
        fontWeight: 600,
        fontSize: "14px",
        borderBottom: "1px solid var(--c-border)",
        display: "flex",
        justifyContent: "space-between",
      }}
    >
      <span>{title}</span>
      {count !== undefined && <span style={{ color: "var(--c-text-muted)", fontSize: "12px" }}>{count}</span>}
    </div>
  );
}

function EmptyPanel({ message }: { message: string }) {
  return (
    <div
      style={{
        border: "1px solid var(--c-border)",
        borderRadius: "8px",
        padding: "32px",
        textAlign: "center",
        color: "var(--c-text-faint)",
        fontSize: "13px",
      }}
    >
      {message}
    </div>
  );
}

// ─── URL State Sync (location.hash) ──────────────────────────

const VALID_VIEWS = [
  "intelligence",
  "graph",
  "usage",
  "runtime",
  "diagnostics",
  "api",
  "middleware",
  "slots",
  "actions",
] as const;
type DashboardView = (typeof VALID_VIEWS)[number];

interface UrlState {
  view: DashboardView;
  route: string | null;
  query: string;
}

function parseHashState(hash: string): UrlState {
  const clean = hash.startsWith("#") ? hash.slice(1) : hash;
  const [viewSegment, paramString = ""] = clean.split("?");
  const params = new URLSearchParams(paramString);
  const view = (VALID_VIEWS as readonly string[]).includes(viewSegment)
    ? (viewSegment as DashboardView)
    : "intelligence";
  return {
    view,
    route: params.get("route"),
    query: params.get("q") ?? "",
  };
}

function serializeHashState(state: UrlState): string {
  const params = new URLSearchParams();
  if (state.route) params.set("route", state.route);
  if (state.query) params.set("q", state.query);
  const qs = params.toString();
  return qs ? `${state.view}?${qs}` : state.view;
}

function useUrlState() {
  const [state, setState] = useState<UrlState>(() => {
    if (typeof window === "undefined") {
      return { view: "intelligence", route: null, query: "" };
    }
    return parseHashState(window.location.hash);
  });

  // Listen for back/forward navigation.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onHashChange = () => setState(parseHashState(window.location.hash));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // Write back to hash whenever state changes.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const next = `#${serializeHashState(state)}`;
    if (window.location.hash !== next) {
      // Use replaceState to avoid spamming history on every keystroke.
      const url = `${window.location.pathname}${window.location.search}${next}`;
      window.history.replaceState(null, "", url);
    }
  }, [state]);

  return [state, setState] as const;
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
  const { manifest, loading, error, retry } = useManifestData({
    manifestUrl,
    data: inlineManifest,
  });
  const { tokens, mode } = useTheme();

  const [selectedRoute, setSelectedRoute] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<
    | "intelligence"
    | "graph"
    | "usage"
    | "runtime"
    | "diagnostics"
    | "api"
    | "middleware"
    | "slots"
    | "actions"
  >("intelligence");
  const [routeQuery, setRouteQuery] = useState("");

  // URL state sync — deep-linkable + survives reloads via location.hash.
  const [urlState, setUrlState] = useUrlState();
  // Hydrate on mount from URL state.
  useEffect(() => {
    setActiveView(urlState.view);
    if (urlState.route !== null) setSelectedRoute(urlState.route);
    if (urlState.query) setRouteQuery(urlState.query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Push every state change back to the hash.
  useEffect(() => {
    setUrlState({ view: activeView, route: selectedRoute, query: routeQuery });
  }, [activeView, selectedRoute, routeQuery, setUrlState]);

  const filteredRoutes = useMemo(() => {
    if (!manifest) return [];
    const query = routeQuery.trim().toLowerCase();
    if (!query) return manifest.routes;
    return manifest.routes.filter((route) => {
      const pathMatch = route.path.toLowerCase().includes(query);
      const fileMatch = route.relativePath.toLowerCase().includes(query);
      return pathMatch || fileMatch;
    });
  }, [manifest, routeQuery]);

  const selectedIntel = selectedRoute
    ? manifest?.routeIntelligence[selectedRoute] ?? null
    : null;

  const diagnosticCounts = useMemo(() => {
    if (!manifest) return { error: 0, warning: 0, info: 0 };
    let error = 0;
    let warning = 0;
    let info = 0;
    for (const d of manifest.diagnostics) {
      if (d.severity === "error") error++;
      else if (d.severity === "warning") warning++;
      else if (d.severity === "info") info++;
    }
    return { error, warning, info };
  }, [manifest]);

  if (loading) {
    return (
      <div style={{ padding: "48px", textAlign: "center", color: "var(--c-text-faint)" }}>
        Loading intelligence data...
      </div>
    );
  }

  if (error || !manifest) {
    return (
      <div style={{ padding: "48px", textAlign: "center", color: "#ef4444" }}>
        <div style={{ marginBottom: "12px", fontWeight: 600 }}>Failed to load: {error ?? "No data"}</div>
        <button
          onClick={retry}
          style={{
            padding: "6px 14px",
            borderRadius: "6px",
            border: "1px solid #ef4444",
            background: "var(--c-surface)",
            color: "#ef4444",
            cursor: "pointer",
            fontSize: "12px",
            fontWeight: 600,
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div
      data-theme={mode}
      style={
        {
          fontFamily: "system-ui, -apple-system, sans-serif",
          height: "100vh",
          display: "flex",
          flexDirection: "column",
          background: "var(--c-bg)",
          color: "var(--c-text)",
          overflow: "hidden",
          // CSS custom properties — cascade to every descendant.
          "--c-bg": tokens.bg,
          "--c-surface": tokens.surface,
          "--c-surface-alt": tokens.surfaceAlt,
          "--c-surface-selected": tokens.surfaceSelected,
          "--c-border": tokens.border,
          "--c-border-subtle": tokens.borderSubtle,
          "--c-text": tokens.text,
          "--c-text-muted": tokens.textMuted,
          "--c-text-faint": tokens.textFaint,
          "--c-accent": tokens.accent,
          "--c-accent-bg": tokens.accentBg,
          "--c-code": tokens.code,
        } as React.CSSProperties & Record<string, string>
      }
    >
      {/* Top Bar */}
      <div
        style={{
          padding: "12px 20px",
          borderBottom: "1px solid var(--c-border)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          background: "var(--c-surface-alt)",
        }}
      >
        <div>
          <h1 style={{ fontSize: "16px", fontWeight: 700, margin: 0, color: "var(--c-text)" }}>
            Route Intelligence Engine
          </h1>
          <span style={{ fontSize: "11px", color: "var(--c-text-faint)" }}>
            {manifest.summary.screens} routes · {manifest.summary.components} components ·{" "}
            {new Date(manifest.generatedAt).toLocaleString()}
          </span>
        </div>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          {/* Diagnostic counter chips */}
          {(diagnosticCounts.error > 0 ||
            diagnosticCounts.warning > 0 ||
            diagnosticCounts.info > 0) && (
            <div style={{ display: "flex", gap: "4px" }}>
              {diagnosticCounts.error > 0 && (
                <DiagnosticChip
                  severity="error"
                  count={diagnosticCounts.error}
                  onClick={() => setActiveView("diagnostics")}
                />
              )}
              {diagnosticCounts.warning > 0 && (
                <DiagnosticChip
                  severity="warning"
                  count={diagnosticCounts.warning}
                  onClick={() => setActiveView("diagnostics")}
                />
              )}
              {diagnosticCounts.info > 0 && (
                <DiagnosticChip
                  severity="info"
                  count={diagnosticCounts.info}
                  onClick={() => setActiveView("diagnostics")}
                />
              )}
            </div>
          )}
          <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
            {(
              [
                { id: "intelligence", label: "Intelligence" },
                { id: "graph", label: "Graph" },
                { id: "usage", label: "Usage" },
                { id: "runtime", label: "Runtime" },
                { id: "diagnostics", label: "Diagnostics" },
                { id: "api", label: `API (${manifest.apiRoutes.length})` },
                { id: "middleware", label: `Middleware (${manifest.middleware.length})` },
                { id: "slots", label: `Slots (${manifest.parallelSlots.length})` },
                { id: "actions", label: `Actions (${manifest.serverActions.length})` },
              ] as const
            ).map((view) => (
              <button
                key={view.id}
                type="button"
                onClick={() => setActiveView(view.id)}
                style={{
                  padding: "4px 12px",
                  borderRadius: "6px",
                  border: "1px solid",
                  borderColor: activeView === view.id ? "#3b82f6" : "#e5e7eb",
                  background: activeView === view.id ? "#eff6ff" : "#fff",
                  color: activeView === view.id ? "#3b82f6" : "#6b7280",
                  cursor: "pointer",
                  fontSize: "12px",
                  fontWeight: activeView === view.id ? 600 : 400,
                }}
              >
                {view.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Summary Strip */}
      {(activeView === "intelligence" ||
        activeView === "usage" ||
        activeView === "runtime") && (
        <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--c-border)", flexShrink: 0 }}>
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
          <div style={{ borderRight: "1px solid var(--c-border)", overflow: "hidden", display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--c-border-subtle)" }}>
              <input
                value={routeQuery}
                onChange={(event) => setRouteQuery(event.target.value)}
                placeholder="Search routes or files..."
                style={{
                  width: "100%",
                  padding: "6px 8px",
                  borderRadius: "6px",
                  border: "1px solid var(--c-border)",
                  fontSize: "12px",
                }}
              />
            </div>
            <RouteTree
              routes={filteredRoutes}
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
          <div style={{ borderLeft: "1px solid var(--c-border)", overflow: "hidden" }}>
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
                <div style={{ padding: "48px", textAlign: "center", color: "var(--c-text-faint)" }}>
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
      ) : activeView === "runtime" ? (
        <div style={{ flex: 1, overflow: "auto", padding: "20px" }}>
          <RuntimeTree runtime={manifest.runtime} components={manifest.components} />
        </div>
      ) : activeView === "diagnostics" ? (
        <div style={{ flex: 1, overflow: "auto", padding: "20px" }}>
          <DiagnosticsPanel
            diagnostics={manifest.diagnostics}
            onJumpToRoute={(node) => {
              // If the node is a route path, jump to it; otherwise no-op.
              if (node.startsWith("/") && manifest.routeIntelligence[node]) {
                setSelectedRoute(node);
                setActiveView("intelligence");
              }
            }}
          />
        </div>
      ) : activeView === "api" ? (
        <div style={{ flex: 1, overflow: "auto", padding: "20px" }}>
          <ApiRoutesPanel apiRoutes={manifest.apiRoutes} />
        </div>
      ) : activeView === "middleware" ? (
        <div style={{ flex: 1, overflow: "auto", padding: "20px" }}>
          <MiddlewarePanel middleware={manifest.middleware} />
        </div>
      ) : activeView === "slots" ? (
        <div style={{ flex: 1, overflow: "auto", padding: "20px" }}>
          <ParallelSlotsPanel slots={manifest.parallelSlots} />
        </div>
      ) : (
        <div style={{ flex: 1, overflow: "auto", padding: "20px" }}>
          <ServerActionsPanel actions={manifest.serverActions} />
        </div>
      )}

      {/* Cmd+K command palette — global hotkey, lazy-loaded. */}
      <Suspense fallback={null}>
        <LazyCommandPalette
          manifest={manifest}
          onSelectRoute={setSelectedRoute}
          onSelectView={setActiveView}
        />
      </Suspense>
    </div>
  );
}

// ─── Diagnostic Chip ────────────────────────────────────────

function DiagnosticChip({
  severity,
  count,
  onClick,
}: {
  severity: "error" | "warning" | "info";
  count: number;
  onClick: () => void;
}) {
  const sev = SEVERITY_STYLES[severity]!;
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${count} ${severity} diagnostic${count === 1 ? "" : "s"} — click to view`}
      style={{
        display: "flex",
        gap: "4px",
        alignItems: "center",
        padding: "3px 8px",
        borderRadius: "9999px",
        border: `1px solid ${sev.border}`,
        background: sev.bg,
        color: sev.text,
        cursor: "pointer",
        fontSize: "11px",
        fontWeight: 700,
      }}
    >
      <span>{sev.icon}</span>
      <span>{count}</span>
    </button>
  );
}
