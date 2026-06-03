import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import fg from "fast-glob";

export interface AppDirectoryResolution {
  primaryAppDir: string;
  candidateAppDirs: string[];
  source: string[];
}

const NEXT_CONFIG_FILES = ["next.config.ts", "next.config.js", "next.config.mjs", "next.config.cjs"];

function normalizeRelative(root: string, target: string): string {
  const abs = isAbsolute(target) ? target : resolve(root, target);
  const rel = relative(root, abs).replace(/\\/g, "/");
  return rel === "" ? "." : rel;
}

function pushUnique(values: string[], value: string): void {
  if (!values.includes(value)) values.push(value);
}

function extractStringLiteral(raw: string, key: string): string | null {
  const pattern = new RegExp(`${key}\\s*:\\s*['\"]([^'\"]+)['\"]`);
  const match = raw.match(pattern);
  return match?.[1] ?? null;
}

export async function resolveAppDirectories(
  projectRoot: string,
  explicitAppDir?: string
): Promise<AppDirectoryResolution> {
  const candidates: string[] = [];
  const source: string[] = [];

  if (explicitAppDir) {
    pushUnique(candidates, normalizeRelative(projectRoot, explicitAppDir));
    source.push("explicit-config");
  }

  for (const configFile of NEXT_CONFIG_FILES) {
    const fullPath = join(projectRoot, configFile);
    if (!existsSync(fullPath)) continue;
    const raw = readFileSync(fullPath, "utf8");
    const srcDir = extractStringLiteral(raw, "srcDir");
    if (srcDir) {
      pushUnique(candidates, normalizeRelative(projectRoot, join(srcDir, "app")));
      source.push(`next-config:${configFile}:srcDir`);
    }
    const appDir = extractStringLiteral(raw, "appDir");
    if (appDir) {
      pushUnique(candidates, normalizeRelative(projectRoot, appDir));
      source.push(`next-config:${configFile}:appDir`);
    }
  }

  const defaultCandidates = ["app", "src/app"];
  for (const candidate of defaultCandidates) {
    if (existsSync(join(projectRoot, candidate))) {
      pushUnique(candidates, candidate);
      source.push("filesystem");
    }
  }

  const workspacePackageJson = await fg(["**/package.json"], {
    cwd: projectRoot,
    absolute: false,
    ignore: ["**/node_modules/**", "**/.next/**", "**/dist/**", "**/.turbo/**"],
  });

  for (const pkgPath of workspacePackageJson) {
    const pkgDir = dirname(pkgPath).replace(/\\/g, "/");
    const nestedApp = pkgDir === "." ? "app" : `${pkgDir}/app`;
    const nestedSrcApp = pkgDir === "." ? "src/app" : `${pkgDir}/src/app`;
    if (existsSync(join(projectRoot, nestedApp))) {
      pushUnique(candidates, nestedApp);
      source.push("workspace-scan");
    }
    if (existsSync(join(projectRoot, nestedSrcApp))) {
      pushUnique(candidates, nestedSrcApp);
      source.push("workspace-scan");
    }
  }

  if (candidates.length === 0) {
    pushUnique(candidates, "app");
    source.push("fallback-default");
  }

  return {
    primaryAppDir: candidates[0]!,
    candidateAppDirs: candidates,
    source,
  };
}
