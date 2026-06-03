import type { IntelligenceManifest, Diagnostic } from "../../intelligence-types/src/index";

/**
 * Structured delta between two {@link IntelligenceManifest} snapshots.
 *
 * Used by the CLI's `--diff` flag and by CI consumers that want to gate
 * merges on intelligence changes (e.g. "fail if any route disappears").
 * Intentionally schema-stable: keep field shapes additive — the diff JSON
 * is a public artifact downstream tools may parse.
 */
export interface ManifestDiff {
  routes: {
    added: string[];
    removed: string[];
    /** Routes present in both but whose dependency tree changed. */
    changed: Array<{
      path: string;
      dependencyCountBefore: number;
      dependencyCountAfter: number;
      componentsAdded: string[];
      componentsRemoved: string[];
    }>;
  };
  components: {
    added: string[];
    removed: string[];
  };
  diagnostics: {
    /** Net change by severity. Positive = more in current run. */
    errorDelta: number;
    warningDelta: number;
    infoDelta: number;
    /** Diagnostics present in `curr` but absent from `prev` (matched by
     *  category + file + message). */
    added: Diagnostic[];
    /** Diagnostics resolved since `prev`. */
    resolved: Diagnostic[];
  };
}

/** Stable identity for a single diagnostic, used to detect added/resolved. */
function diagKey(d: Diagnostic): string {
  return `${d.category}|${d.severity}|${d.file ?? ""}|${d.message}`;
}

function sortedDiff(prev: Set<string>, curr: Set<string>): {
  added: string[];
  removed: string[];
} {
  const added: string[] = [];
  const removed: string[] = [];
  for (const x of curr) if (!prev.has(x)) added.push(x);
  for (const x of prev) if (!curr.has(x)) removed.push(x);
  return { added: added.sort(), removed: removed.sort() };
}

/**
 * Compute a deterministic delta between two manifests. Both inputs are
 * trusted (already validated via {@link validateManifest}); shape mismatches
 * surface as missing entries rather than thrown errors so callers can diff
 * partial manifests during development.
 */
export function diffManifests(
  prev: IntelligenceManifest,
  curr: IntelligenceManifest
): ManifestDiff {
  // ── Routes ────────────────────────────────────────────────────────────
  const prevRoutes = new Set(Object.keys(prev.routeIntelligence ?? {}));
  const currRoutes = new Set(Object.keys(curr.routeIntelligence ?? {}));
  const { added: routesAdded, removed: routesRemoved } = sortedDiff(prevRoutes, currRoutes);

  const routesChanged: ManifestDiff["routes"]["changed"] = [];
  for (const path of currRoutes) {
    if (!prevRoutes.has(path)) continue;
    const before = prev.routeIntelligence![path]!;
    const after = curr.routeIntelligence![path]!;
    const beforeComps = new Set(before.components ?? []);
    const afterComps = new Set(after.components ?? []);
    const { added: compsAdded, removed: compsRemoved } = sortedDiff(beforeComps, afterComps);
    if (
      before.dependencyCount !== after.dependencyCount ||
      compsAdded.length > 0 ||
      compsRemoved.length > 0
    ) {
      routesChanged.push({
        path,
        dependencyCountBefore: before.dependencyCount,
        dependencyCountAfter: after.dependencyCount,
        componentsAdded: compsAdded,
        componentsRemoved: compsRemoved,
      });
    }
  }
  // Deterministic order — paths sort lexicographically.
  routesChanged.sort((a, b) => a.path.localeCompare(b.path));

  // ── Components ────────────────────────────────────────────────────────
  const prevComps = new Set(Object.keys(prev.components ?? {}));
  const currComps = new Set(Object.keys(curr.components ?? {}));
  const { added: compsAdded, removed: compsRemoved } = sortedDiff(prevComps, currComps);

  // ── Diagnostics ───────────────────────────────────────────────────────
  const prevDiags = prev.diagnostics ?? [];
  const currDiags = curr.diagnostics ?? [];
  const prevKeys = new Map(prevDiags.map((d) => [diagKey(d), d]));
  const currKeys = new Map(currDiags.map((d) => [diagKey(d), d]));

  const addedDiags: Diagnostic[] = [];
  const resolvedDiags: Diagnostic[] = [];
  for (const [k, d] of currKeys) if (!prevKeys.has(k)) addedDiags.push(d);
  for (const [k, d] of prevKeys) if (!currKeys.has(k)) resolvedDiags.push(d);

  const countBy = (diags: Diagnostic[], sev: Diagnostic["severity"]): number =>
    diags.filter((d) => d.severity === sev).length;

  return {
    routes: { added: routesAdded, removed: routesRemoved, changed: routesChanged },
    components: { added: compsAdded, removed: compsRemoved },
    diagnostics: {
      errorDelta: countBy(currDiags, "error") - countBy(prevDiags, "error"),
      warningDelta: countBy(currDiags, "warning") - countBy(prevDiags, "warning"),
      infoDelta: countBy(currDiags, "info") - countBy(prevDiags, "info"),
      added: addedDiags,
      resolved: resolvedDiags,
    },
  };
}

/**
 * Render a {@link ManifestDiff} as a human-readable summary suitable for the
 * CLI's `--diff` flag. Returns an empty string when there is literally no
 * change (so callers can skip noisy "No changes" output if desired).
 */
export function formatManifestDiff(diff: ManifestDiff): string {
  const lines: string[] = [];
  const { routes, components, diagnostics } = diff;

  const hasRouteChanges =
    routes.added.length > 0 || routes.removed.length > 0 || routes.changed.length > 0;
  const hasComponentChanges = components.added.length > 0 || components.removed.length > 0;
  const hasDiagChanges =
    diagnostics.added.length > 0 ||
    diagnostics.resolved.length > 0 ||
    diagnostics.errorDelta !== 0 ||
    diagnostics.warningDelta !== 0 ||
    diagnostics.infoDelta !== 0;

  if (!hasRouteChanges && !hasComponentChanges && !hasDiagChanges) {
    return "";
  }

  lines.push("");
  lines.push("Manifest diff");
  lines.push("─────────────");

  if (hasRouteChanges) {
    lines.push(
      `Routes: +${routes.added.length} added, -${routes.removed.length} removed, ~${routes.changed.length} changed`
    );
    for (const p of routes.added) lines.push(`  + ${p}`);
    for (const p of routes.removed) lines.push(`  - ${p}`);
    for (const c of routes.changed) {
      const delta = c.dependencyCountAfter - c.dependencyCountBefore;
      const deltaStr = delta >= 0 ? `+${delta}` : `${delta}`;
      lines.push(
        `  ~ ${c.path}  deps ${c.dependencyCountBefore}→${c.dependencyCountAfter} (${deltaStr})`
      );
      for (const x of c.componentsAdded) lines.push(`      + ${x}`);
      for (const x of c.componentsRemoved) lines.push(`      - ${x}`);
    }
  }

  if (hasComponentChanges) {
    lines.push(
      `Components: +${components.added.length} added, -${components.removed.length} removed`
    );
    for (const x of components.added) lines.push(`  + ${x}`);
    for (const x of components.removed) lines.push(`  - ${x}`);
  }

  if (hasDiagChanges) {
    lines.push(
      `Diagnostics: errors ${signed(diagnostics.errorDelta)}, ` +
        `warnings ${signed(diagnostics.warningDelta)}, ` +
        `info ${signed(diagnostics.infoDelta)}`
    );
    for (const d of diagnostics.added) {
      lines.push(`  + [${d.severity}] ${d.category}: ${d.message}${d.file ? ` (${d.file})` : ""}`);
    }
    for (const d of diagnostics.resolved) {
      lines.push(`  - [${d.severity}] ${d.category}: ${d.message}${d.file ? ` (${d.file})` : ""}`);
    }
  }

  return lines.join("\n");
}

function signed(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}
