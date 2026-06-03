import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCanonicalId,
  isBuiltinHook,
  parseCanonicalId,
} from "../../dist/tools/intelligence-types/src/index.js";

test("buildCanonicalId uses the shared sourceFile#exportName format", () => {
  assert.equal(
    buildCanonicalId("src/components/data-grid.tsx", "DataGrid"),
    "src/components/data-grid.tsx#DataGrid"
  );
});

test("parseCanonicalId splits from the last hash", () => {
  assert.deepEqual(parseCanonicalId("src/hash#folder/widget.tsx#Widget"), {
    sourceFile: "src/hash#folder/widget.tsx",
    exportName: "Widget",
  });
});

test("parseCanonicalId falls back to default export when no hash exists", () => {
  assert.deepEqual(parseCanonicalId("src/app/page.tsx"), {
    sourceFile: "src/app/page.tsx",
    exportName: "default",
  });
});

test("isBuiltinHook filters React and Next.js built-in hooks", () => {
  assert.equal(isBuiltinHook("useEffect"), true);
  assert.equal(isBuiltinHook("useSearchParams"), true);
  assert.equal(isBuiltinHook("useCustomerFilters"), false);
});
