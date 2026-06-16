import type { IntelligenceAnalysisService } from "../analysis-service";

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
    additionalProperties: boolean;
  };
}

type JsonObject = Record<string, unknown>;

type ToolHandler = (input: JsonObject) => Promise<unknown>;

export interface RegisteredTool extends ToolDefinition {
  handler: ToolHandler;
}

const stringProperty = (description: string): JsonObject => ({ type: "string", description });

function getString(input: JsonObject, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Tool argument '${key}' must be a non-empty string.`);
  }
  return value;
}

export function createTools(service: IntelligenceAnalysisService): RegisteredTool[] {
  return [
    {
      name: "analyze_project",
      description: "Run the Next.js Intelligence analyzer and return a project summary.",
      inputSchema: { type: "object", additionalProperties: false },
      handler: async () => service.analyzeProject(),
    },
    {
      name: "get_routes",
      description: "Return all discovered Next.js page routes.",
      inputSchema: { type: "object", additionalProperties: false },
      handler: async () => service.getRoutes(),
    },
    {
      name: "analyze_route",
      description: "Return route details, components, hooks, providers, complexity, and dependencies for a route path.",
      inputSchema: {
        type: "object",
        properties: { route: stringProperty("Route path, for example /apo-grading-exceptions.") },
        required: ["route"],
        additionalProperties: false,
      },
      handler: async (input) => service.analyzeRoute(getString(input, "route")),
    },
    {
      name: "get_api_routes",
      description: "Return all discovered Next.js Route Handler API endpoints.",
      inputSchema: { type: "object", additionalProperties: false },
      handler: async () => service.getApiRoutes(),
    },
    {
      name: "find_component_usage",
      description: "Find all usages and render relationships for a component name, canonical id, or source path.",
      inputSchema: {
        type: "object",
        properties: { component: stringProperty("Component name or canonical id, for example AppBadge.") },
        required: ["component"],
        additionalProperties: false,
      },
      handler: async (input) => service.findComponentUsage(getString(input, "component")),
    },
    {
      name: "get_dependency_graph",
      description: "Return upstream and downstream graph relationships for a component/file node.",
      inputSchema: {
        type: "object",
        properties: { node: stringProperty("Canonical component id, component name, or project-relative file path.") },
        required: ["node"],
        additionalProperties: false,
      },
      handler: async (input) => service.getDependencyGraph(getString(input, "node")),
    },
    {
      name: "find_orphans",
      description: "Return orphan/dead components discovered by existing diagnostics and derived metrics.",
      inputSchema: { type: "object", additionalProperties: false },
      handler: async () => service.findOrphans(),
    },
    {
      name: "impact_analysis",
      description: "Priority tool: return routes, components, APIs, and dependency chain affected by modifying a file.",
      inputSchema: {
        type: "object",
        properties: { file: stringProperty("Project-relative file path, for example src/components/common-components/AppBadge/AppBadge.tsx.") },
        required: ["file"],
        additionalProperties: false,
      },
      handler: async (input) => service.impactAnalysis(getString(input, "file")),
    },
  ];
}
