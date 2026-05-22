"use client";

import { useMemo, useCallback, useState } from "react";
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
  [key: string]: unknown;
}

type IntelNode = Node<IntelNodeData>;

function RouteNode({ data }: NodeProps<IntelNode>) {
  const style = NODE_STYLES[data.nodeType] ?? NODE_STYLES.component;
  return (
    <div
      style={{
        background: style.bg,
        border: `2px solid ${style.border}`,
        borderRadius: "10px",
        padding: "12px 16px",
        minWidth: "180px",
        maxWidth: "260px",
        boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
        fontFamily: "system-ui, sans-serif",
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
      <Handle type="source" position={Position.Bottom} style={{ background: style.border }} />
    </div>
  );
}

function CompactNode({ data }: NodeProps<IntelNode>) {
  const style = NODE_STYLES[data.nodeType] ?? NODE_STYLES.component;
  return (
    <div
      style={{
        background: style.bg,
        border: `1.5px solid ${style.border}`,
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
      }}
    >
      <Handle type="target" position={Position.Top} style={{ background: style.border, width: 6, height: 6 }} />
      <span style={{ fontSize: "12px" }}>{style.icon}</span>
      <span>{data.label}</span>
      {data.isReusable && <span style={{ color: "#059669", fontSize: "10px" }}>♻</span>}
      <Handle type="source" position={Position.Bottom} style={{ background: style.border, width: 6, height: 6 }} />
    </div>
  );
}

const nodeTypes: NodeTypes = {
  routeNode: RouteNode,
  compactNode: CompactNode,
};

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

  // Position routes in a grid
  const cols = Math.ceil(Math.sqrt(routes.length));
  const colWidth = 300;
  const rowHeight = 200;

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
      const parentExists = routes.some((r) => r.path === route.parentRoute);
      if (parentExists) {
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
  for (const [name, usage] of Object.entries(manifest.componentUsage)) {
    if (usage.usedInRoutes.length > 1) {
      // Connect routes that share this component via dashed lines
      for (let i = 0; i < usage.usedInRoutes.length - 1; i++) {
        for (let j = i + 1; j < usage.usedInRoutes.length; j++) {
          const routeA = usage.usedInRoutes[i]!;
          const routeB = usage.usedInRoutes[j]!;
          const edgeId = `shared::${name}::${routeA}->${routeB}`;
          if (!edges.some((e) => e.id === edgeId)) {
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

  // Root route node at top
  nodes.push({
    id: `route::${route.path}`,
    type: "routeNode",
    position: { x: 300, y: 0 },
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
    { type: "component", items: route.components.filter((c) => !route.dialogs.includes(c) && !route.grids.includes(c) && !route.charts.includes(c) && !route.providers.includes(c)) },
    { type: "dialog", items: route.dialogs },
    { type: "grid", items: route.grids },
    { type: "chart", items: route.charts },
    { type: "hook", items: route.hooks },
    { type: "util", items: route.utils },
  ];

  let yOffset = 140;

  for (const group of groups) {
    if (group.items.length === 0) continue;

    const totalWidth = group.items.length * 180;
    const startX = 300 - totalWidth / 2 + 90;

    group.items.forEach((item, idx) => {
      const nodeId = `${group.type}::${item}`;
      if (addedNodes.has(nodeId)) return;
      addedNodes.add(nodeId);

      const comp = Object.values(allComponents).find((c) => c.name === item);
      const usage = componentUsage[item];
      const isReusable = usage ? usage.usedInRoutes.length > 1 : false;

      nodes.push({
        id: nodeId,
        type: "compactNode",
        position: { x: startX + idx * 180, y: yOffset },
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
        const renderEdges = graph.edges.filter(
          (e) => e.source === comp.id && e.relationship === "renders"
        );
        for (const re of renderEdges) {
          const target = allComponents[re.target];
          if (target && route.components.includes(target.name)) {
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

    yOffset += 120;
  }

  return { nodes, edges };
}

function buildComponentReuseGraph(
  manifest: IntelligenceManifest
): { nodes: IntelNode[]; edges: Edge[] } {
  const nodes: IntelNode[] = [];
  const edges: Edge[] = [];

  const reusable = Object.entries(manifest.componentUsage)
    .filter(([, u]) => u.usedInRoutes.length > 1)
    .sort((a, b) => b[1].usedInRoutes.length - a[1].usedInRoutes.length);

  if (reusable.length === 0) {
    return { nodes, edges };
  }

  // Place reusable components in center column
  const centerX = 400;
  reusable.forEach(([name, usage], idx) => {
    nodes.push({
      id: `reusable::${name}`,
      type: "routeNode",
      position: { x: centerX, y: idx * 160 },
      data: {
        label: name,
        nodeType: usage.type,
        isReusable: true,
        metrics: [{ label: "routes", value: usage.usedInRoutes.length }],
      },
    });
  });

  // Place routes on both sides
  const routePaths = new Set(reusable.flatMap(([, u]) => u.usedInRoutes));
  const routeList = Array.from(routePaths);
  const leftRoutes = routeList.slice(0, Math.ceil(routeList.length / 2));
  const rightRoutes = routeList.slice(Math.ceil(routeList.length / 2));

  leftRoutes.forEach((path, idx) => {
    nodes.push({
      id: `route::${path}`,
      type: "compactNode",
      position: { x: 0, y: idx * 80 },
      data: { label: path, nodeType: "route" },
    });
  });

  rightRoutes.forEach((path, idx) => {
    nodes.push({
      id: `route::${path}`,
      type: "compactNode",
      position: { x: 800, y: idx * 80 },
      data: { label: path, nodeType: "route" },
    });
  });

  // Connect routes to reusable components
  for (const [name, usage] of reusable) {
    for (const routePath of usage.usedInRoutes) {
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

  return { nodes, edges };
}

function buildFullArchitectureGraph(
  manifest: IntelligenceManifest
): { nodes: IntelNode[]; edges: Edge[] } {
  const nodes: IntelNode[] = [];
  const edges: Edge[] = [];

  const routes = Object.values(manifest.routeIntelligence);

  // Routes as top row
  routes.forEach((route, idx) => {
    nodes.push({
      id: `route::${route.path}`,
      type: "routeNode",
      position: { x: idx * 280, y: 0 },
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

  // Components as middle row
  const compList = Array.from(allCompNames).sort();
  compList.forEach((name, idx) => {
    const usage = manifest.componentUsage[name];
    nodes.push({
      id: `comp::${name}`,
      type: "compactNode",
      position: { x: idx * 160, y: 250 },
      data: {
        label: name,
        nodeType: usage?.type ?? "component",
        isReusable: usage ? usage.usedInRoutes.length > 1 : false,
      },
    });
  });

  // Route → Component edges
  for (const route of routes) {
    for (const comp of route.components) {
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

  const selectedIntel = selectedRoute
    ? manifest.routeIntelligence[selectedRoute] ?? null
    : null;

  // Build graph based on mode
  const { initialNodes, initialEdges } = useMemo(() => {
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

    return { initialNodes: result.nodes, initialEdges: result.edges };
  }, [mode, manifest, selectedIntel]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Update nodes/edges when mode or selection changes
  useMemo(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      if (node.id.startsWith("route::") && onRouteSelect) {
        const path = node.id.replace("route::", "");
        onRouteSelect(path);
      }
    },
    [onRouteSelect]
  );

  const modes: { id: GraphMode; label: string; description: string }[] = [
    { id: "route-overview", label: "Route Map", description: "All routes with shared components" },
    { id: "route-detail", label: "Route Detail", description: "Selected route's dependency tree" },
    { id: "component-reuse", label: "Reuse Map", description: "Which routes share components" },
    { id: "full-architecture", label: "Architecture", description: "Full route → component graph" },
  ];

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.1}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{
          type: "smoothstep",
          style: { strokeWidth: 1.5 },
        }}
      >
        <Background color="#e5e7eb" gap={20} size={1} />
        <Controls
          position="bottom-right"
          style={{ background: "#fff", borderRadius: "8px", border: "1px solid #e5e7eb" }}
        />
        <MiniMap
          position="bottom-left"
          nodeColor={(node) => {
            const nType = (node.data as IntelNodeData)?.nodeType ?? "component";
            return NODE_STYLES[nType]?.border ?? "#9ca3af";
          }}
          style={{
            background: "#fafafa",
            borderRadius: "8px",
            border: "1px solid #e5e7eb",
          }}
          maskColor="rgba(0,0,0,0.05)"
        />

        {/* Mode Selector Panel */}
        <Panel position="top-left">
          <div
            style={{
              background: "#fff",
              borderRadius: "8px",
              border: "1px solid #e5e7eb",
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
                color: "#9ca3af",
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
                  background: mode === m.id ? "#eff6ff" : "transparent",
                  color: mode === m.id ? "#2563eb" : "#374151",
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
          </div>
        </Panel>

        {/* Legend Panel */}
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
              }}
            >
              Legend
            </div>
            {Object.entries(NODE_STYLES)
              .filter(([key]) => !["group", "loading", "error"].includes(key))
              .map(([key, style]) => (
                <div key={key} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
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
                  <span style={{ color: "#6b7280" }}>{key}</span>
                </div>
              ))}
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
