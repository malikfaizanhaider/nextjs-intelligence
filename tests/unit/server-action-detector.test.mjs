import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Project } from "ts-morph";
import { ServerActionDetector } from "../../dist/tools/intelligence-core/src/index.js";

async function makeProject(files) {
  const root = await mkdtemp(join(tmpdir(), "intelligence-server-actions-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(root, rel);
    await mkdir(join(full, ".."), { recursive: true });
    await writeFile(full, content);
  }
  const project = new Project({ useInMemoryFileSystem: false });
  for (const rel of Object.keys(files)) {
    project.addSourceFileAtPath(join(root, rel));
  }
  return { root, project };
}

test("ServerActionDetector finds file-level 'use server' directive", async () => {
  const { root, project } = await makeProject({
    "actions/users.ts": `"use server";
export async function createUser(input: { name: string }) {
  return { id: 1, ...input };
}
export async function deleteUser(id: number) {
  return { ok: true };
}
`,
  });

  try {
    const detector = new ServerActionDetector(project, root);
    const actions = detector.detect();

    // Module-scope sentinel + each named export
    assert.equal(actions.length, 3);
    const byName = Object.fromEntries(actions.map((a) => [a.exportName, a]));
    assert.equal(byName.__module__.scope, "module");
    assert.equal(byName.createUser.scope, "module");
    assert.equal(byName.deleteUser.scope, "module");
    assert.equal(byName.createUser.canonicalId, "actions/users.ts#createUser");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ServerActionDetector finds function-level 'use server' directives", async () => {
  const { root, project } = await makeProject({
    "actions/mixed.ts": `export async function publicAction() {
  "use server";
  return 42;
}
export async function notAnAction() {
  return 0;
}
export const arrowAction = async () => {
  "use server";
  return true;
};
`,
  });

  try {
    const detector = new ServerActionDetector(project, root);
    const actions = detector.detect();

    assert.equal(actions.length, 2);
    const names = actions.map((a) => a.exportName).sort();
    assert.deepEqual(names, ["arrowAction", "publicAction"]);
    for (const action of actions) {
      assert.equal(action.scope, "function");
      assert.ok(action.line > 0);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ServerActionDetector ignores files without the directive", async () => {
  const { root, project } = await makeProject({
    "regular.ts": `export async function helper() { return 1; }
`,
  });

  try {
    const detector = new ServerActionDetector(project, root);
    const actions = detector.detect();
    assert.deepEqual(actions, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ServerActionDetector.getFilesWithActions returns unique file paths", async () => {
  const { root, project } = await makeProject({
    "actions/a.ts": `"use server";
export async function a() {}
`,
    "actions/b.ts": `export async function b() { "use server"; }
`,
    "lib/util.ts": `export function util() { return 1; }
`,
  });

  try {
    const detector = new ServerActionDetector(project, root);
    detector.detect();
    const files = Array.from(detector.getFilesWithActions()).sort();
    assert.deepEqual(files, ["actions/a.ts", "actions/b.ts"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
