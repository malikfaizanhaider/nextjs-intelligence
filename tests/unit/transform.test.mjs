import test from "node:test";
import assert from "node:assert/strict";

import { transformSource } from "../../dist/tools/intelligence-compiler/src/transform.js";

const projectRoot = "/repo";

test("transformSource skips server components", () => {
  const source = "export function ServerWidget() {\n  return <div />;\n}\n";

  const result = transformSource(source, `${projectRoot}/components/server-widget.tsx`, projectRoot);

  assert.equal(result.transformed, false);
  assert.deepEqual(result.componentsInjected, []);
  assert.equal(result.code, source);
});

test("transformSource injects runtime registration into client function components", () => {
  const source = '"use client";\n\nexport function ClientWidget() {\n  return <div />;\n}\n';

  const result = transformSource(source, `${projectRoot}/components/client-widget.tsx`, projectRoot);

  assert.equal(result.transformed, true);
  assert.deepEqual(result.componentsInjected, ["ClientWidget"]);
  assert.match(result.code, /import \{ useComponentRegistration \} from "@i2c\/intelligence\/runtime";/);
  assert.match(result.code, /\/\* __INTELLIGENCE_INJECTED__ \*\//);
  assert.match(result.code, /canonicalId: "components\/client-widget\.tsx#ClientWidget"/);
  assert.match(result.code, /exportName: "ClientWidget"/);
});

test("transformSource injects arrow and function expression exports once", () => {
  const source = `'use client';\n\nexport const ArrowWidget = () => {\n  return <div />;\n};\n\nexport const FunctionWidget = function() {\n  return <span />;\n};\n`;

  const result = transformSource(source, `${projectRoot}/components/widgets.tsx`, projectRoot);

  assert.equal(result.transformed, true);
  assert.deepEqual(result.componentsInjected, ["ArrowWidget", "FunctionWidget"]);
  assert.equal((result.code.match(/useComponentRegistration/g) ?? []).length, 3);
  assert.match(result.code, /widgets\.tsx#ArrowWidget/);
  assert.match(result.code, /widgets\.tsx#FunctionWidget/);
});

test("transformSource is idempotent after intelligence marker is present", () => {
  const alreadyInjected = '"use client";\n/* __INTELLIGENCE_INJECTED__ */\nexport function ClientWidget() {\n  return <div />;\n}\n';

  const result = transformSource(alreadyInjected, `${projectRoot}/components/client-widget.tsx`, projectRoot);

  assert.equal(result.transformed, false);
  assert.deepEqual(result.componentsInjected, []);
  assert.equal(result.code, alreadyInjected);
});
