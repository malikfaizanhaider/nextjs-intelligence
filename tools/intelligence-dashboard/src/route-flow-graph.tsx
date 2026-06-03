"use client";

import { useMemo, useCallback, useEffect, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Panel,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  MarkerType,
  type Node,
  type Edge,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type {
  IntelligenceManifest,
  RouteIntelligence,
  ComponentMeta,
  DependencyGraph,
  ComponentUsageMap,
} from "../../intelligence-types/src/index";

// ─── Color Config ───────────────────────────────────────────

const NODE_STYLES: Record<
  string,
  { bg: string; border: string; text: string; icon: string }
> = {
  route: { bg: "#ede9fe", border: "#8b5cf6", text: "#5b21b6", icon: "◆" },
  page: { bg: "#dbeafe", border: "#3b82f6", text: "#1e40af", icon: "▤" },
  component: { bg: "#f3f4f6", border: "#9ca3af", text: "#374151", icon: "▣" },
  dialog: { bg: "#fce7f3", border: "#ec4899", text: "#9d174d", icon: "◫" },
  grid: { bg: "#ccfbf1", border: "#14b8a6", text: "#0f766e", icon: "▦" },
  chart: { bg: "#ffedd5", border: "#f97316", text: "#c2410c", icon: "◔" },
  provider: { bg: "#f3e8ff", border: "#a78bfa", text: "#6d28d9", icon: "◎" },
  hook: { bg: "#fef3c7", border: "#f59e0b", text: "#92400e", icon: "↩" },
  util: { bg: "#ecfdf5", border: "#10b981", text: "#065f46", icon: "ƒ" },
  layout: { bg: "#e0e7ff", border: "#6366f1", text: "#4338ca", icon: "▥" },
  loading: { bg: "#e0f2fe", border: "#0ea5e9", text: "#0369a1", icon: "◌" },
  error: { bg: "#fee2e2", border: "#ef4444", text: "#991b1b", icon: "⚠" },
  group: { bg: "#f9fafb", border: "#d1d5db", text: "#6b7280", icon: "▧" },
};

const EDGE_STYLES: Record<string, { stroke: string; label: string }> = {
  "routes-to": { stroke: "#8b5cf6", label: "routes" },
  renders: { stroke: "#10b981", label: "renders" },
  imports: { stroke: "#3b82f6", label: "imports" },
  "parent-child": { stroke: "#f59e0b", label: "child" },
  reuses: { stroke: "#ec4899", label: "reuses" },
  uses: { stroke: "#6b7280", label: "uses" },
};

// ─── Custom Nodes ───────────────────────────────────────────

interface IntelNodeData {
  label: string;
  nodeType: string;
  subtitle?: string;
  badges?: string[];
  metrics?: { label: string; value: string | number }[];
  isReusable?: boolean;
  /** Low-confidence diagnostic attached to this node (composite root). */
  confidence?: {
    score: number;
    severity: "warning" | "info";
    evidence: string[];
  };
  [key: string]: unknown;
}

const CONFIDENCE_OVERLAY = {
  warning: { border: "#f59e0b", text: "#92400e", bg: "#fef3c7" },
  info: { border: "#0ea5e9", text: "#0369a1", bg: "#e0f2fe" },
} as const;

type IntelNode = Node<IntelNodeData>;

const MAX_ROUTE_OVERVIEW_SHARED_EDGES = 600;
const MAX_ROUTE_OVERVIEW_PAIRS_PER_COMPONENT = 25;
const MAX_ROUTE_DETAIL_ITEMS_PER_GROUP = 120;
const MAX_COMPONENT_REUSE_COMPONENTS = 200;
const MAX_COMPONENT_REUSE_ROUTES = 300;
const MAX_COMPONENT_REUSE_EDGES = 900;
const MAX_FULL_ARCH_COMPONENTS = 400;
const MAX_FULL_ARCH_EDGES = 1_200;

function addLimitNotice(
  nodes: IntelNode[],
  label: string,
  position: { x: number; y: number }
): void {
  nodes.push({
    id: `limit-notice::${nodes.length}`,
    type: "compactNode",
    position,
    data: {
      label,
      nodeType: "group",
    },
  });
}

function RouteNode({ data }: NodeProps<IntelNode>) {
  const style = NODE_STYLES[data.nodeType] ?? NODE_STYLES.component;
  const conf = data.confidence;
  const confOverlay = conf ? CONFIDENCE_OVERLAY[conf.severity] : null;
  return (
    <div
      title={conf ? `Low-confidence composite (${conf.score.toFixed(2)}): ${conf.evidence.join(", ") || "no evidence"}` : undefined}
      style={{
        background: style.bg,
        border: confOverlay ? `2px dashed ${confOverlay.border}` : `2px solid ${style.border}`,
        borderRadius: "10px",
        padding: "12px 16px",
        minWidth: "180px",
        maxWidth: "260px",
        boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
        fontFamily: "system-ui, sans-serif",
        opacity: conf ? 0.7 : 1,
      }}
    >
      <Handle type="target" position={Position.Top} style={{ background: style.border }} />
      <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
        <span style={{ fontSize: "14px" }}>{style.icon}</span>
        <span
          style={{
            fontWeight: 700,
            fontSize: "13px",
            color: style.text,
            fontFamily: "monospace",
          }}
        >
          {data.label}
        </span>
      </div>
      {data.subtitle && (
        <div style={{ fontSize: "10px", color: "#6b7280", marginBottom: "6px" }}>
          {data.subtitle}
        </div>
      )}
      {data.badges && data.badges.length > 0 && (
        <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", marginBottom: "4px" }}>
          {data.badges.map((badge) => {
            const badgeStyle = NODE_STYLES[badge] ?? NODE_STYLES.component;
            return (
              <span
                key={badge}
                style={{
                  fontSize: "9px",
                  padding: "1px 6px",
                  borderRadius: "9999px",
                  background: badgeStyle.bg,
                  color: badgeStyle.text,
                  border: `1px solid ${badgeStyle.border}`,
                  fontWeight: 500,
                }}
              >
                {badge}
              </span>
            );
          })}
        </div>
      )}
      {data.metrics && data.metrics.length > 0 && (
        <div
          style={{
            display: "flex",
            gap: "8px",
            fontSize: "10px",
            color: "#6b7280",
            borderTop: "1px solid rgba(0,0,0,0.06)",
            paddingTop: "4px",
            marginTop: "4px",
          }}
        >
          {data.metrics.map((m) => (
            <span key={m.label}>
              <strong style={{ color: style.text }}>{m.value}</strong> {m.label}
            </span>
          ))}
        </div>
      )}
      {data.isReusable && (
        <div
          style={{
            fontSize: "9px",
            color: "#059669",
            fontWeight: 600,
            marginTop: "2px",
          }}
        >
          ♻ reusable
        </div>
      )}
      {conf && confOverlay && (
        <div
          style={{
            fontSize: "9px",
            marginTop: "4px",
            padding: "2px 6px",
            borderRadius: "9999px",
            background: confOverlay.bg,
            color: confOverlay.text,
            border: `1px solid ${confOverlay.border}`,
            fontWeight: 600,
            display: "inline-block",
          }}
        >
          ⚠ low confidence {conf.score.toFixed(2)}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} style={{ background: style.border }} />
    </div>
  );
}

function CompactNode({ data }: NodeProps<IntelNode>) {
  const style = NODE_STYLES[data.nodeType] ?? NODE_STYLES.component;
  const conf = data.confidence;
  const confOverlay = conf ? CONFIDENCE_OVERLAY[conf.severity] : null;
  return (
    <div
      title={conf ? `Low-confidence composite (${conf.score.toFixed(2)}): ${conf.evidence.join(", ") || "no evidence"}` : undefined}
      style={{
        background: style.bg,
        border: confOverlay ? `1.5px dashed ${confOverlay.border}` : `1.5px solid ${style.border}`,
        borderRadius: "6px",
        padding: "6px 10px",
        minWidth: "100px",
        fontSize: "11px",
        fontFamily: "monospace",
        color: style.text,
        fontWeight: 500,
        boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
        display: "flex",
        alignItems: "center",
        gap: "4px",
        opacity: conf ? 0.65 : 1,
      }}
    >
      <Handle type="target" position={Position.Top} style={{ background: style.border, width: 6, height: 6 }} />
      <span style={{ fontSize: "12px" }}>{style.icon}</span>
      <span>{data.label}</span>
      {data.isReusable && <span style={{ color: "#059669", fontSize: "10px" }}>♻</span>}
      {conf && <span style={{ color: confOverlay?.text, fontSize: "10px" }} aria-label={`low confidence ${conf.score.toFixed(2)}`}>⚠</span>}
      <Handle type="source" position={Position.Bottom} style={{ background: style.border, width: 6, height: 6 }} />
    </div>
  );
}

const nodeTypes: NodeTypes = {
  routeNode: RouteNode,
  compactNode: CompactNode,
};

// ─── Confidence Decoration ──────────────────────────────────

type LowConfidenceMap = Map<
  string,
  { score: number; severity: "warning" | "info"; evidence: string[] }
>;

function extractLowConfidenceMap(manifest: IntelligenceManifest): LowConfidenceMap {
  const map: LowConfidenceMap = new Map();
  for (const d of manifest.diagnostics ?? []) {
    if (d.category !== "low-confidence-composite") continue;
    if (!d.nodeId) continue;
    if (d.severity !== "warning" && d.severity !== "info") continue;
    const score = typeof d.context?.confidence === "number" ? d.context.confidence : 0;
    const evidence = Array.isArray(d.context?.evidence)
      ? (d.context.evidence as string[])
      : [];
    map.set(d.nodeId, { score, severity: d.severity, evidence });
    // Also index by component short name for builders that key on display name.
    const shortName = d.nodeId.split("#").pop();
    if (shortName && !map.has(shortName)) {
      map.set(shortName, { score, severity: d.severity, evidence });
    }
  }
  return map;
}

function decorateConfidence(nodes: IntelNode[], lowConf: LowConfidenceMap): IntelNode[] {
  if (lowConf.size === 0) return nodes;
  return nodes.map((node) => {
    // Component nodes use `comp::${canonicalIdOrName}`; route nodes never carry composite IDs.
    if (!node.id.startsWith("comp::") && !node.id.startsWith("reusable::")) {
      return node;
    }
    const key = node.id.replace(/^(comp|reusable)::/, "");
    const entry = lowConf.get(key);
    if (!entry) return node;
    return {
      ...node,
      data: { ...node.data, confidence: entry },
    };
  });
}

// ─── Graph Modes ────────────────────────────────────────────

type GraphMode = "route-overview" | "route-detail" | "component-reuse" | "full-architecture";

// ─── Graph Builders ─────────────────────────────────────────

function buildRouteOverviewGraph(manifest: IntelligenceManifest): {
  nodes: IntelNode[];
  edges: Edge[];
} {
  const nodes: IntelNode[] = [];
  const edges: Edge[] = [];
  const routes = Object.values(manifest.routeIntelligence);
  const routePaths = new Set(routes.map((route) => route.path));
  const edgeIds = new Set<string>();
  let sharedEdgeCount = 0;
  let omittedSharedEdges = 0;

  // Position routes in a grid. Generous spacing (was 300/200) so shared-component
  // edges between distant routes have room to bend instead of overlapping the
  // node bodies.
  const cols = Math.ceil(Math.sqrt(routes.length));
  const colWidth = 440;
  const rowHeight = 320;

  routes.forEach((route, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);

    const contentTypes: string[] = [];
    if (route.dialogs.length > 0) contentTypes.push("dialog");
    if (route.grids.length > 0) contentTypes.push("grid");
    if (route.charts.length > 0) contentTypes.push("chart");
    if (route.providers.length > 0) contentTypes.push("provider");

    nodes.push({
      id: `route::${route.path}`,
      type: "routeNode",
      position: { x: col * colWidth, y: row * rowHeight },
      data: {
        label: route.path,
        nodeType: "route",
        subtitle: route.relativePath,
        badges: contentTypes,
        metrics: [
          { label: "deps", value: route.dependencyCount },
          { label: "comp", value: route.components.length },
          { label: "hooks", value: route.hooks.length },
          { label: "depth", value: route.complexity.depth },
        ],
      },
    });

    // Parent-child edges between routes
    if (route.parentRoute && route.parentRoute !== "/") {
      if (routePaths.has(route.parentRoute)) {
        edges.push({
          id: `${route.parentRoute}->${route.path}`,
          source: `route::${route.parentRoute}`,
          target: `route::${route.path}`,
          type: "smoothstep",
          animated: true,
          style: { stroke: EDGE_STYLES["parent-child"].stroke, strokeWidth: 1.5 },
          markerEnd: { type: MarkerType.ArrowClosed, color: EDGE_STYLES["parent-child"].stroke },
          label: "child",
          labelStyle: { fontSize: 9, fill: "#9ca3af" },
        });
      }
    }
  });

  // Shared component edges between routes
  sharedComponents: for (const [name, usage] of Object.entries(manifest.componentUsage)) {
    if (usage.usedInRoutes.length <= 1) continue;

    // Connect only a bounded sample of routes that share this component. Fully connecting
    // high-fanout shared components creates O(route²) edge counts and freezes React Flow.
    for (let i = 0; i < usage.usedInRoutes.length - 1; i++) {
      const routeA = usage.usedInRoutes[i]!;
      const maxJ = Math.min(
        usage.usedInRoutes.length,
        i + 1 + MAX_ROUTE_OVERVIEW_PAIRS_PER_COMPONENT
      );
      omittedSharedEdges += Math.max(usage.usedInRoutes.length - maxJ, 0);

      for (let j = i + 1; j < maxJ; j++) {
        if (sharedEdgeCount >= MAX_ROUTE_OVERVIEW_SHARED_EDGES) {
          omittedSharedEdges += usage.usedInRoutes.length - j;
          continue sharedComponents;
        }

        const routeB = usage.usedInRoutes[j]!;
        const edgeId = `shared::${name}::${routeA}->${routeB}`;
        if (!edgeIds.has(edgeId)) {
          edgeIds.add(edgeId);
          sharedEdgeCount += 1;
          edges.push({
            id: edgeId,
            source: `route::${routeA}`,
            target: `route::${routeB}`,
            type: "smoothstep",
            style: {
              stroke: EDGE_STYLES.reuses.stroke,
              strokeWidth: 1,
              strokeDasharray: "5 3",
            },
            label: name,
            labelStyle: { fontSize: 8, fill: "#ec4899" },
          });
        }
      }
    }
  }

  if (omittedSharedEdges > 0) {
    addLimitNotice(
      nodes,
      `+${omittedSharedEdges.toLocaleString()} shared route links hidden`,
      { x: 0, y: Math.ceil(routes.length / Math.max(cols, 1)) * rowHeight + 80 }
    );
  }

  return { nodes, edges };
}

function buildRouteDetailGraph(
  route: RouteIntelligence,
  allComponents: Record<string, ComponentMeta>,
  componentUsage: ComponentUsageMap,
  graph: DependencyGraph
): { nodes: IntelNode[]; edges: Edge[] } {
  const nodes: IntelNode[] = [];
  const edges: Edge[] = [];
  const addedNodes = new Set<string>();
  const routeComponentNames = new Set(route.components);
  const dialogNames = new Set(route.dialogs);
  const gridNames = new Set(route.grids);
  const chartNames = new Set(route.charts);
  const providerNames = new Set(route.providers);
  const componentByName = new Map(Object.values(allComponents).map((component) => [component.name, component]));
  const renderEdgesBySource = new Map<string, typeof graph.edges>();
  for (const edge of graph.edges) {
    if (edge.relationship !== "renders") continue;
    const bucket = renderEdgesBySource.get(edge.source) ?? [];
    bucket.push(edge);
    renderEdgesBySource.set(edge.source, bucket);
  }

  // Root route node at top. Pushed right a bit to leave space for the wider
  // group rows below.
  nodes.push({
    id: `route::${route.path}`,
    type: "routeNode",
    position: { x: 600, y: 0 },
    data: {
      label: route.path,
      nodeType: "route",
      subtitle: route.relativePath,
      metrics: [
        { label: "deps", value: route.dependencyCount },
        { label: "depth", value: route.complexity.depth },
      ],
    },
  });
  addedNodes.add(`route::${route.path}`);

  // Group items by type and lay them out in columns
  const groups: { type: string; items: string[] }[] = [
    { type: "provider", items: route.providers },
    { type: "component", items: route.components.filter((c) => !dialogNames.has(c) && !gridNames.has(c) && !chartNames.has(c) && !providerNames.has(c)) },
    { type: "dialog", items: route.dialogs },
    { type: "grid", items: route.grids },
    { type: "chart", items: route.charts },
    { type: "hook", items: route.hooks },
    { type: "util", items: route.utils },
  ];

  // Layout knobs — relaxed so child rows don't crash into each other and
  // edges from root route fan out cleanly.
  const ITEM_STEP = 240;
  const ROW_STEP = 220;
  let yOffset = 260;

  for (const group of groups) {
    if (group.items.length === 0) continue;

    const displayedItems = group.items.slice(0, MAX_ROUTE_DETAIL_ITEMS_PER_GROUP);
    const omittedItems = group.items.length - displayedItems.length;
    const totalWidth = displayedItems.length * ITEM_STEP;
    const startX = 600 - totalWidth / 2 + ITEM_STEP / 2;

    displayedItems.forEach((item, idx) => {
      const nodeId = `${group.type}::${item}`;
      if (addedNodes.has(nodeId)) return;
      addedNodes.add(nodeId);

      const comp = componentByName.get(item);
      const usage = componentUsage[item];
      const isReusable = usage ? usage.usedInRoutes.length > 1 : false;

      nodes.push({
        id: nodeId,
        type: "compactNode",
        position: { x: startX + idx * ITEM_STEP, y: yOffset },
        data: {
          label: item,
          nodeType: comp?.type ?? group.type,
          isReusable,
        },
      });

      // Edge from route to this node
      edges.push({
        id: `route::${route.path}->${nodeId}`,
        source: `route::${route.path}`,
        target: nodeId,
        type: "smoothstep",
        style: {
          stroke: (EDGE_STYLES["routes-to"] ?? EDGE_STYLES.uses).stroke,
          strokeWidth: 1.5,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: (EDGE_STYLES["routes-to"] ?? EDGE_STYLES.uses).stroke,
        },
      });

      // Child component edges (renders relationship)
      if (comp) {
        const renderEdges = renderEdgesBySource.get(comp.id) ?? [];
        for (const re of renderEdges) {
          const target = allComponents[re.target];
          if (target && routeComponentNames.has(target.name)) {
            const targetNodeId = `component::${target.name}`;
            if (addedNodes.has(targetNodeId)) {
              edges.push({
                id: `${nodeId}->${targetNodeId}`,
                source: nodeId,
                target: targetNodeId,
                type: "smoothstep",
                style: { stroke: EDGE_STYLES.renders.stroke, strokeWidth: 1 },
                markerEnd: { type: MarkerType.ArrowClosed, color: EDGE_STYLES.renders.stroke },
              });
            }
          }
        }
      }
    });

    if (omittedItems > 0) {
      addLimitNotice(nodes, `+${omittedItems.toLocaleString()} ${group.type} items hidden`, {
        x: startX + displayedItems.length * ITEM_STEP,
        y: yOffset,
      });
    }

    yOffset += ROW_STEP;
  }

  return { nodes, edges };
}

function buildComponentReuseGraph(
  manifest: IntelligenceManifest
): { nodes: IntelNode[]; edges: Edge[] } {
  const nodes: IntelNode[] = [];
  const edges: Edge[] = [];

  const allReusable = Object.entries(manifest.componentUsage)
    .filter(([, u]) => u.usedInRoutes.length > 1)
    .sort((a, b) => b[1].usedInRoutes.length - a[1].usedInRoutes.length);
  const reusable = allReusable.slice(0, MAX_COMPONENT_REUSE_COMPONENTS);

  if (allReusable.length === 0) {
    return { nodes, edges };
  }

  // Place reusable components in centre column. Generous vertical spacing
  // (was 160) so the many incoming reuse edges from each side don't pile up.
  const centerX = 600;
  const reusableStep = 220;
  reusable.forEach(([name, usage], idx) => {
    nodes.push({
      id: `reusable::${name}`,
      type: "routeNode",
      position: { x: centerX, y: idx * reusableStep },
      data: {
        label: name,
        nodeType: usage.type,
        isReusable: true,
        metrics: [{ label: "routes", value: usage.usedInRoutes.length }],
      },
    });
  });

  // Place routes on both sides. Wider gutters (0 / 1200 instead of 0 / 800)
  // give the smoothstep edges room to curve without crossing the centre nodes.
  const routePaths = new Set(reusable.flatMap(([, u]) => u.usedInRoutes));
  const routeList = Array.from(routePaths).slice(0, MAX_COMPONENT_REUSE_ROUTES);
  const displayedRoutePaths = new Set(routeList);
  const leftRoutes = routeList.slice(0, Math.ceil(routeList.length / 2));
  const rightRoutes = routeList.slice(Math.ceil(routeList.length / 2));
  const routeStep = 110;

  leftRoutes.forEach((path, idx) => {
    nodes.push({
      id: `route::${path}`,
      type: "compactNode",
      position: { x: 0, y: idx * routeStep },
      data: { label: path, nodeType: "route" },
    });
  });

  rightRoutes.forEach((path, idx) => {
    nodes.push({
      id: `route::${path}`,
      type: "compactNode",
      position: { x: 1200, y: idx * routeStep },
      data: { label: path, nodeType: "route" },
    });
  });

  // Connect routes to reusable components
  for (const [name, usage] of reusable) {
    for (const routePath of usage.usedInRoutes) {
      if (!displayedRoutePaths.has(routePath)) continue;
      if (edges.length >= MAX_COMPONENT_REUSE_EDGES) break;
      edges.push({
        id: `${routePath}->${name}`,
        source: `route::${routePath}`,
        target: `reusable::${name}`,
        type: "smoothstep",
        style: { stroke: EDGE_STYLES.reuses.stroke, strokeWidth: 1.5 },
        markerEnd: { type: MarkerType.ArrowClosed, color: EDGE_STYLES.reuses.stroke },
      });
    }
  }

  const hiddenReusable = allReusable.length - reusable.length;
  const hiddenRoutes = routePaths.size - routeList.length;
  if (hiddenReusable > 0 || hiddenRoutes > 0 || edges.length >= MAX_COMPONENT_REUSE_EDGES) {
    addLimitNotice(
      nodes,
      `limited view: ${hiddenReusable.toLocaleString()} components, ${hiddenRoutes.toLocaleString()} routes, or extra links hidden`,
      { x: centerX, y: reusable.length * reusableStep + 100 }
    );
  }

  return { nodes, edges };
}

function buildFullArchitectureGraph(
  manifest: IntelligenceManifest
): { nodes: IntelNode[]; edges: Edge[] } {
  const nodes: IntelNode[] = [];
  const edges: Edge[] = [];

  const routes = Object.values(manifest.routeIntelligence);

  // Routes as top row. Wider step (was 280) so route nodes don't crowd and
  // the fan-out to components below stays legible.
  const ROUTE_STEP_X = 360;
  routes.forEach((route, idx) => {
    nodes.push({
      id: `route::${route.path}`,
      type: "routeNode",
      position: { x: idx * ROUTE_STEP_X, y: 0 },
      data: {
        label: route.path,
        nodeType: "route",
        metrics: [
          { label: "deps", value: route.dependencyCount },
          { label: "comp", value: route.components.length },
        ],
      },
    });
  });

  // Collect all unique components across routes
  const allCompNames = new Set<string>();
  for (const route of routes) {
    for (const c of route.components) allCompNames.add(c);
  }

  // Components as middle row. Wider step (was 160) + larger vertical gap
  // from routes (was 250) so route→component edges have room to breathe.
  const allCompList = Array.from(allCompNames).sort();
  const compList = allCompList.slice(0, MAX_FULL_ARCH_COMPONENTS);
  const visibleComponents = new Set(compList);
  const COMP_STEP_X = 210;
  const COMP_ROW_Y = 420;
  compList.forEach((name, idx) => {
    const usage = manifest.componentUsage[name];
    nodes.push({
      id: `comp::${name}`,
      type: "compactNode",
      position: { x: idx * COMP_STEP_X, y: COMP_ROW_Y },
      data: {
        label: name,
        nodeType: usage?.type ?? "component",
        isReusable: usage ? usage.usedInRoutes.length > 1 : false,
      },
    });
  });

  // Route → Component edges
  let omittedEdges = 0;
  for (const route of routes) {
    for (const comp of route.components) {
      if (!visibleComponents.has(comp) || edges.length >= MAX_FULL_ARCH_EDGES) {
        omittedEdges += 1;
        continue;
      }
      edges.push({
        id: `route::${route.path}->comp::${comp}`,
        source: `route::${route.path}`,
        target: `comp::${comp}`,
        type: "smoothstep",
        style: { stroke: "#d1d5db", strokeWidth: 1 },
        markerEnd: { type: MarkerType.ArrowClosed, color: "#d1d5db" },
      });
    }
  }

  const hiddenComponents = allCompList.length - compList.length;
  if (hiddenComponents > 0 || omittedEdges > 0) {
    addLimitNotice(
      nodes,
      `+${hiddenComponents.toLocaleString()} components and ${omittedEdges.toLocaleString()} links hidden`,
      { x: compList.length * COMP_STEP_X + COMP_STEP_X, y: COMP_ROW_Y }
    );
  }

  return { nodes, edges };
}

// ─── Main Component ─────────────────────────────────────────

interface RouteFlowGraphProps {
  manifest: IntelligenceManifest;
  selectedRoute?: string | null;
  onRouteSelect?: (path: string) => void;
}

export function RouteFlowGraph({
  manifest,
  selectedRoute,
  onRouteSelect,
}: Readonly<RouteFlowGraphProps>) {
  const [mode, setMode] = useState<GraphMode>("route-overview");
  // ID of the node the user clicked to focus. `null` = no focus, full graph at
  // normal opacity. When set, only the focused node + its N-hop neighbors
  // render at full opacity; everything else dims.
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
  // How many hops out from the focused node to keep visible. Default 1 keeps
  // the original behaviour; bumping to 2/3 reveals deeper dependency chains
  // without losing the dim-everything-else effect.
  const [focusDepth, setFocusDepth] = useState<1 | 2 | 3>(1);
  // Free-text filter applied on top of the built graph. Empty string = no
  // filter. Matches any node whose label includes the query (case-insensitive)
  // and dims everything else, regardless of focus state.
  const [searchQuery, setSearchQuery] = useState("");
  // Node types currently hidden via the legend. Clicking a legend swatch
  // toggles its key in/out of this set. Hidden types dim alongside the rest
  // of the dim treatment, so the user keeps spatial context.
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(() => new Set());
  // Ref to the search input so the `/` shortcut can focus it.
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const selectedIntel = selectedRoute
    ? manifest.routeIntelligence[selectedRoute] ?? null
    : null;

  // Build graph based on mode
  const { initialNodes, initialEdges } = useMemo(() => {
    const lowConf = extractLowConfidenceMap(manifest);
    let result: { nodes: IntelNode[]; edges: Edge[] };

    switch (mode) {
      case "route-detail":
        if (selectedIntel) {
          result = buildRouteDetailGraph(
            selectedIntel,
            manifest.components,
            manifest.componentUsage,
            manifest.graph
          );
        } else {
          result = buildRouteOverviewGraph(manifest);
        }
        break;
      case "component-reuse":
        result = buildComponentReuseGraph(manifest);
        break;
      case "full-architecture":
        result = buildFullArchitectureGraph(manifest);
        break;
      case "route-overview":
      default:
        result = buildRouteOverviewGraph(manifest);
        break;
    }

    return {
      initialNodes: decorateConfidence(result.nodes, lowConf),
      initialEdges: result.edges,
    };
  }, [mode, manifest, selectedIntel]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Update nodes/edges when mode or selection changes. Reset focus + search
  // + type filters too — they are graph-local and would otherwise reference
  // stale node ids.
  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
    setFocusNodeId(null);
    setSearchQuery("");
    setHiddenTypes(new Set());
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  // Keyboard shortcuts: `/` focuses the filter input, `Esc` clears focus +
  // search + type filters. Ignored when the user is typing in any input so
  // we don't hijack normal typing.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      if (event.key === "/" && !isTyping) {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      } else if (event.key === "Escape") {
        setFocusNodeId(null);
        setSearchQuery("");
        setHiddenTypes(new Set());
        (target as HTMLInputElement | null)?.blur?.();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Adjacency built once per graph build — used for N-hop BFS from the
  // focused node. Cheaper than re-scanning edges N times.
  const adjacency = useMemo<Map<string, string[]>>(() => {
    const adj = new Map<string, string[]>();
    const push = (a: string, b: string) => {
      const list = adj.get(a);
      if (list) list.push(b);
      else adj.set(a, [b]);
    };
    for (const edge of initialEdges) {
      push(edge.source, edge.target);
      push(edge.target, edge.source);
    }
    return adj;
  }, [initialEdges]);

  // Compute the visible set whenever focus / search / type filters / topology
  // change. `null` means "no constraint, show everything at full opacity".
  const visibleNodeIds = useMemo<Set<string> | null>(() => {
    const trimmedQuery = searchQuery.trim().toLowerCase();
    const hasFocus = focusNodeId !== null;
    const hasQuery = trimmedQuery.length > 0;
    const hasTypeFilter = hiddenTypes.size > 0;
    if (!hasFocus && !hasQuery && !hasTypeFilter) return null;

    const visible = new Set<string>();

    if (hasFocus && focusNodeId) {
      // N-hop BFS from the focused node.
      visible.add(focusNodeId);
      let frontier: string[] = [focusNodeId];
      for (let hop = 0; hop < focusDepth; hop += 1) {
        const next: string[] = [];
        for (const id of frontier) {
          const neighbors = adjacency.get(id);
          if (!neighbors) continue;
          for (const n of neighbors) {
            if (!visible.has(n)) {
              visible.add(n);
              next.push(n);
            }
          }
        }
        if (next.length === 0) break;
        frontier = next;
      }
    }

    if (hasQuery) {
      for (const node of initialNodes) {
        const label = String(node.data?.label ?? "").toLowerCase();
        if (label.includes(trimmedQuery)) visible.add(node.id);
      }
    }

    if (!hasFocus && !hasQuery) {
      // Only type-filter active: start with all nodes visible.
      for (const node of initialNodes) visible.add(node.id);
    }

    // Apply node-type filter as a final subtractive pass.
    if (hasTypeFilter) {
      for (const node of initialNodes) {
        const t = (node.data as IntelNodeData)?.nodeType;
        if (t && hiddenTypes.has(t)) visible.delete(node.id);
      }
    }

    return visible;
  }, [focusNodeId, focusDepth, searchQuery, hiddenTypes, adjacency, initialNodes]);

  // Apply opacity to nodes and edges in a stable derived array — we do not
  // mutate the underlying graph so the user's drag positions are preserved.
  const displayedNodes = useMemo<IntelNode[]>(() => {
    if (!visibleNodeIds) return nodes;
    return nodes.map((node) => {
      const visible = visibleNodeIds.has(node.id);
      return {
        ...node,
        style: { ...(node.style ?? {}), opacity: visible ? 1 : 0.15 },
      };
    });
  }, [nodes, visibleNodeIds]);

  const displayedEdges = useMemo<Edge[]>(() => {
    if (!visibleNodeIds) return edges;
    return edges.map((edge) => {
      // Both endpoints must be in the visible set for the edge to feel
      // "meaningful" — otherwise it dangles to a dimmed node.
      const live = visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target);
      // Animate the edges that directly touch the focused node — gives a
      // clear "this is what depends on / is depended on by" cue without
      // moving any other pixels.
      const touchesFocus =
        live &&
        focusNodeId !== null &&
        (edge.source === focusNodeId || edge.target === focusNodeId);
      return {
        ...edge,
        animated: touchesFocus ? true : edge.animated,
        style: { ...(edge.style ?? {}), opacity: live ? 1 : 0.08 },
      };
    });
  }, [edges, visibleNodeIds, focusNodeId]);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      // Toggle focus: clicking the focused node clears it; clicking any other
      // node moves focus there. Route selection callback fires independently
      // so the host dashboard can still react to route picks.
      setFocusNodeId((prev) => (prev === node.id ? null : node.id));
      if (node.id.startsWith("route::") && onRouteSelect) {
        const path = node.id.replace("route::", "");
        onRouteSelect(path);
      }
    },
    [onRouteSelect]
  );

  // Click on empty canvas clears focus — the standard "escape selection"
  // gesture in graph tools.
  const onPaneClick = useCallback(() => {
    setFocusNodeId(null);
  }, []);

  const modes: { id: GraphMode; label: string; description: string }[] = [
    { id: "route-overview", label: "Route Map", description: "All routes with shared components" },
    { id: "route-detail", label: "Route Detail", description: "Selected route's dependency tree" },
    { id: "component-reuse", label: "Reuse Map", description: "Which routes share components" },
    { id: "full-architecture", label: "Architecture", description: "Full route → component graph" },
  ];

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <ReactFlow
        nodes={displayedNodes}
        edges={displayedEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.35 }}
        minZoom={0.05}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{
          type: "smoothstep",
          style: { strokeWidth: 1.5 },
        }}
      >
        <Background color="var(--c-border)" gap={20} size={1} />
        <Controls
          position="bottom-right"
          style={{ background: "var(--c-surface)", borderRadius: "8px", border: "1px solid var(--c-border)" }}
        />
        <MiniMap
          position="bottom-left"
          nodeColor={(node) => {
            const nType = (node.data as IntelNodeData)?.nodeType ?? "component";
            return NODE_STYLES[nType]?.border ?? "#9ca3af";
          }}
          style={{
            background: "var(--c-surface-alt)",
            borderRadius: "8px",
            border: "1px solid var(--c-border)",
          }}
          maskColor="rgba(0,0,0,0.05)"
        />

        {/* Mode Selector Panel */}
        <Panel position="top-left">
          <div
            style={{
              background: "var(--c-surface)",
              borderRadius: "8px",
              border: "1px solid var(--c-border)",
              padding: "8px",
              display: "flex",
              flexDirection: "column",
              gap: "4px",
              boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
            }}
          >
            <div
              style={{
                fontSize: "10px",
                fontWeight: 600,
                color: "var(--c-text-faint)",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                padding: "0 4px 4px",
              }}
            >
              View Mode
            </div>
            {modes.map((m) => (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                style={{
                  padding: "6px 10px",
                  borderRadius: "6px",
                  border: "none",
                  background: mode === m.id ? "var(--c-accent-bg)" : "transparent",
                  color: mode === m.id ? "var(--c-accent)" : "var(--c-text)",
                  cursor: "pointer",
                  fontSize: "12px",
                  fontWeight: mode === m.id ? 600 : 400,
                  textAlign: "left",
                  transition: "background 0.15s",
                }}
                title={m.description}
              >
                {m.label}
              </button>
            ))}

            {/* Route picker — visible in Route Map and Route Detail. Selecting
                a route from the dropdown jumps to Route Detail view for that
                route. Picking the blank option from Route Detail returns to
                the full Route Map overview. */}
            {(mode === "route-overview" || mode === "route-detail") && (
              <div
                style={{
                  borderTop: "1px solid var(--c-border)",
                  marginTop: "4px",
                  paddingTop: "6px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "4px",
                }}
              >
                <label
                  htmlFor="route-picker"
                  style={{
                    fontSize: "10px",
                    fontWeight: 600,
                    color: "var(--c-text-faint)",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    padding: "0 4px",
                  }}
                >
                  Focus Route
                </label>
                <select
                  id="route-picker"
                  data-testid="route-picker"
                  value={mode === "route-detail" && selectedRoute ? selectedRoute : ""}
                  onChange={(event) => {
                    const path = event.target.value;
                    if (!path) {
                      setMode("route-overview");
                      return;
                    }
                    onRouteSelect?.(path);
                    setMode("route-detail");
                  }}
                  style={{
                    padding: "4px 8px",
                    borderRadius: "6px",
                    border: "1px solid var(--c-border)",
                    background: "var(--c-surface)",
                    color: "var(--c-text)",
                    fontSize: "11px",
                    fontFamily: "monospace",
                    maxWidth: "220px",
                    cursor: "pointer",
                  }}
                >
                  <option value="">— all routes —</option>
                  {Object.values(manifest.routeIntelligence)
                    .slice()
                    .sort((a, b) => a.path.localeCompare(b.path))
                    .map((route) => (
                      <option key={route.path} value={route.path}>
                        {route.path}
                      </option>
                    ))}
                </select>
              </div>
            )}
          </div>
        </Panel>

        {/* Legend Panel — each row is a clickable filter. Hidden types get a
            strikethrough + reduced opacity and are removed from the visible
            set, but stay listed so the user can re-enable them. */}
        <Panel position="top-right">
          <div
            style={{
              background: "#fff",
              borderRadius: "8px",
              border: "1px solid #e5e7eb",
              padding: "8px 10px",
              boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
              fontSize: "10px",
              display: "flex",
              flexDirection: "column",
              gap: "3px",
            }}
          >
            <div
              style={{
                fontWeight: 600,
                color: "#9ca3af",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                marginBottom: "2px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "8px",
              }}
            >
              <span>Legend</span>
              {hiddenTypes.size > 0 && (
                <button
                  type="button"
                  onClick={() => setHiddenTypes(new Set())}
                  style={{
                    border: "none",
                    background: "transparent",
                    color: "#6b7280",
                    fontSize: "9px",
                    cursor: "pointer",
                    padding: 0,
                    textTransform: "none",
                    letterSpacing: 0,
                  }}
                  title="Show all node types"
                >
                  show all
                </button>
              )}
            </div>
            {Object.entries(NODE_STYLES)
              .filter(([key]) => !["group", "loading", "error"].includes(key))
              .map(([key, style]) => {
                const hidden = hiddenTypes.has(key);
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() =>
                      setHiddenTypes((prev) => {
                        const next = new Set(prev);
                        if (next.has(key)) next.delete(key);
                        else next.add(key);
                        return next;
                      })
                    }
                    title={hidden ? `Show ${key} nodes` : `Hide ${key} nodes`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      border: "none",
                      background: "transparent",
                      padding: "2px 4px",
                      borderRadius: "4px",
                      cursor: "pointer",
                      opacity: hidden ? 0.4 : 1,
                      textAlign: "left",
                    }}
                  >
                    <span
                      style={{
                        width: "10px",
                        height: "10px",
                        borderRadius: "3px",
                        background: style.bg,
                        border: `1px solid ${style.border}`,
                        display: "inline-block",
                      }}
                    />
                    <span
                      style={{
                        color: "#6b7280",
                        textDecoration: hidden ? "line-through" : "none",
                      }}
                    >
                      {key}
                    </span>
                  </button>
                );
              })}
          </div>
        </Panel>

        {/* Search + focus controls. Compact so they don't overlap the mode
            panel (top-left) or legend (top-right). */}
        <Panel position="top-center">
          <div
            style={{
              background: "var(--c-surface)",
              borderRadius: "8px",
              border: "1px solid var(--c-border)",
              padding: "6px 8px",
              boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <input
              ref={searchInputRef}
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Filter nodes...  ( / )"
              style={{
                width: "180px",
                padding: "4px 8px",
                borderRadius: "6px",
                border: "1px solid var(--c-border)",
                fontSize: "11px",
                outline: "none",
                background: "var(--c-surface)",
                color: "var(--c-text)",
              }}
              data-testid="graph-search"
            />
            {focusNodeId && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "2px",
                  borderLeft: "1px solid var(--c-border)",
                  paddingLeft: "6px",
                }}
                title="Focus depth — how many hops out from the focused node to keep visible"
              >
                <span
                  style={{
                    fontSize: "9px",
                    color: "var(--c-text-faint)",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  hops
                </span>
                {[1, 2, 3].map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setFocusDepth(d as 1 | 2 | 3)}
                    style={{
                      padding: "2px 6px",
                      borderRadius: "4px",
                      border: "1px solid var(--c-border)",
                      background:
                        focusDepth === d ? "var(--c-accent-bg)" : "transparent",
                      color:
                        focusDepth === d ? "var(--c-accent)" : "var(--c-text-muted)",
                      cursor: "pointer",
                      fontSize: "10px",
                      fontWeight: focusDepth === d ? 700 : 500,
                      minWidth: "22px",
                    }}
                  >
                    {d}
                  </button>
                ))}
              </div>
            )}
            {(focusNodeId || searchQuery || hiddenTypes.size > 0) && (
              <button
                type="button"
                onClick={() => {
                  setFocusNodeId(null);
                  setSearchQuery("");
                  setHiddenTypes(new Set());
                }}
                style={{
                  padding: "4px 8px",
                  borderRadius: "6px",
                  border: "1px solid var(--c-border)",
                  background: "var(--c-surface)",
                  color: "var(--c-text-muted)",
                  cursor: "pointer",
                  fontSize: "10px",
                  fontWeight: 600,
                }}
                title="Clear focus, filter, and type visibility  ( Esc )"
              >
                Clear
              </button>
            )}
            {visibleNodeIds && (
              <span
                style={{
                  fontSize: "10px",
                  color: "var(--c-text-faint)",
                  fontFamily: "monospace",
                  whiteSpace: "nowrap",
                }}
                title="Visible nodes / total nodes"
              >
                {visibleNodeIds.size} / {initialNodes.length}
              </span>
            )}
            {focusNodeId && (
              <span
                style={{
                  fontSize: "10px",
                  color: "var(--c-text-faint)",
                  fontFamily: "monospace",
                  maxWidth: "180px",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={focusNodeId}
              >
                focus: {focusNodeId.replace(/^(route|comp|reusable)::/, "")}
              </span>
            )}
          </div>
        </Panel>

        {/* Info Panel */}
        {mode === "route-detail" && !selectedIntel && (
          <Panel position="top-center">
            <div
              style={{
                background: "#fffbeb",
                border: "1px solid #fbbf24",
                borderRadius: "8px",
                padding: "8px 14px",
                fontSize: "12px",
                color: "#92400e",
              }}
            >
              Select a route from the left panel to see its dependency graph
            </div>
          </Panel>
        )}
      </ReactFlow>
    </div>
  );
}
