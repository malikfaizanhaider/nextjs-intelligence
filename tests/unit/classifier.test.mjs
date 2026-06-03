import test from "node:test";
import assert from "node:assert/strict";

import { classifyComponent } from "../../dist/tools/intelligence-core/src/analyzer/classifier.js";

test("classifyComponent gives provider naming precedence over dialog keywords", () => {
  assert.equal(
    classifyComponent("DialogProvider", [], [], "src/components/dialog-provider.tsx"),
    "provider"
  );
});

test("classifyComponent detects chart components from imports and JSX tags", () => {
  assert.equal(
    classifyComponent("RevenuePanel", ["recharts"], [], "src/components/revenue-panel.tsx"),
    "chart"
  );

  assert.equal(
    classifyComponent("RevenuePanel", [], ["ResponsiveContainer"], "src/components/revenue-panel.tsx"),
    "chart"
  );
});

test("classifyComponent detects Next.js special file conventions", () => {
  assert.equal(classifyComponent("Page", [], [], "src/app/users/page.tsx"), "page");
  assert.equal(classifyComponent("RootLayout", [], [], "src/app/layout.tsx"), "layout");
  assert.equal(classifyComponent("Loading", [], [], "src/app/users/loading.tsx"), "loading");
});

test("classifyComponent supports custom rules before built-in rules", () => {
  assert.equal(
    classifyComponent(
      "InvoiceWidget",
      [],
      [],
      "src/components/invoice-widget.tsx",
      [{ type: "grid", namePatterns: [/Widget$/], importPatterns: [], jsxTagPatterns: [] }]
    ),
    "grid"
  );
});

test("classifyComponent detects provider factories from createContext source text", () => {
  assert.equal(
    classifyComponent(
      "ThemeState",
      [],
      [],
      "src/components/theme-state.tsx",
      [],
      "const ThemeContext = createContext<Theme | null>(null);"
    ),
    "provider"
  );
});
