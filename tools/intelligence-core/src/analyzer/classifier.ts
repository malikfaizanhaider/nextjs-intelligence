import type { ClassificationRule, ComponentType } from "../@i2c/intelligence-types";

/**
 * Provider detection patterns beyond name matching.
 * These detect Context.Provider, createContext, and provider-like wrappers.
 */
export const PROVIDER_AST_PATTERNS: readonly RegExp[] = [
  /\.Provider\s*[>\/]/,         // <SomeContext.Provider> in JSX
  /createContext\s*[<(]/,       // createContext() or createContext<Type>()
  /Context\.Provider/,          // Context.Provider usage
  /\.Provider\s*value=/,        // <X.Provider value={...}>
];

/**
 * Check if source text contains provider-like patterns.
 */
export function containsProviderPattern(sourceText: string): boolean {
  return PROVIDER_AST_PATTERNS.some((pattern) => pattern.test(sourceText));
}

/**
 * Default classification rules for auto-detecting component types
 * based on name patterns, import paths, and JSX tags.
 */
export const DEFAULT_CLASSIFICATION_RULES: ClassificationRule[] = [
  // Provider rules FIRST — a name ending in Provider/Context must be classified as provider
  // even if it also contains "dialog", "drawer", etc.
  {
    type: "provider",
    namePatterns: [
      /Provider$/i,
      /Context$/i,
      /ConsumerProvider$/i,
      /ContextProvider$/i,
    ],
    importPatterns: [],
    jsxTagPatterns: [],
  },
  {
    type: "dialog",
    namePatterns: [/dialog/i, /modal/i, /sheet/i, /drawer/i, /popover/i, /alert-?dialog/i],
    importPatterns: [
      "@radix-ui/react-dialog",
      "@radix-ui/react-alert-dialog",
      "@radix-ui/react-popover",
      "@headlessui/react",
    ],
    jsxTagPatterns: ["Dialog", "Modal", "Sheet", "AlertDialog", "Drawer", "Popover"],
  },
  {
    type: "grid",
    namePatterns: [/grid/i, /table/i, /data-?grid/i, /data-?table/i, /ag-?grid/i],
    importPatterns: [
      "@tanstack/react-table",
      "ag-grid-react",
      "@ag-grid-community",
      "@mui/x-data-grid",
    ],
    jsxTagPatterns: ["DataGrid", "AgGridReact", "Table", "DataTable"],
  },
  {
    type: "chart",
    namePatterns: [/chart/i, /graph(?!ql)/i, /sparkline/i, /visualization/i],
    importPatterns: [
      "recharts",
      "echarts",
      "apexcharts",
      "react-apexcharts",
      "echarts-for-react",
      "victory",
      "@nivo",
      "chart.js",
      "react-chartjs-2",
      "d3",
    ],
    jsxTagPatterns: [
      "BarChart",
      "LineChart",
      "PieChart",
      "AreaChart",
      "RadarChart",
      "ScatterChart",
      "ResponsiveContainer",
      "Chart",
    ],
  },
];

/**
 * Classify a component based on its name, imports, JSX tags, and optionally source text.
 * Returns the first matching classification or falls back to conventions.
 */
export function classifyComponent(
  name: string,
  imports: string[],
  jsxTags: string[],
  filePath: string,
  customRules: ClassificationRule[] = [],
  sourceText?: string
): ComponentType {
  const allRules = [...customRules, ...DEFAULT_CLASSIFICATION_RULES];

  for (const rule of allRules) {
    // Check name patterns
    for (const pattern of rule.namePatterns) {
      if (pattern.test(name)) {
        return rule.type;
      }
    }

    // Check import patterns
    for (const importPath of imports) {
      for (const pattern of rule.importPatterns) {
        if (importPath.includes(pattern)) {
          return rule.type;
        }
      }
    }

    // Check JSX tag patterns
    for (const tag of jsxTags) {
      for (const pattern of rule.jsxTagPatterns) {
        if (tag === pattern || tag.includes(pattern)) {
          return rule.type;
        }
      }
    }
  }

  // AST-based provider detection: if component body calls createContext, it's a provider factory
  // Only use createContext as signal — Context.Provider JSX usage alone is not enough
  // (layouts and wrappers commonly render Context.Provider without being providers themselves)
  if (sourceText && /createContext\s*[<(]/.test(sourceText)) {
    return "provider";
  }

  // File-convention based classification for Next.js
  const fileName = filePath.split("/").pop()?.replace(/\.(tsx?|jsx?)$/, "") ?? "";
  switch (fileName) {
    case "page":
      return "page";
    case "layout":
      return "layout";
    case "loading":
      return "loading";
    case "error":
      return "error";
    case "template":
      return "template";
    default:
      return "component";
  }
}
