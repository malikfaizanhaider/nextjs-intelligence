import { SyntaxKind, type SourceFile, type Project } from "ts-morph";
import type { ComponentMeta, ConfidenceMeta, EvidenceType } from "../@i2c/intelligence-types";
import { buildCanonicalId } from "../@i2c/intelligence-types";

/**
 * Detected composite (compound) component pattern.
 */
export interface CompositeGroup {
  /** Root component name, e.g. "DataGrid" */
  root: string;
  /** Root component canonical ID */
  rootCanonicalId: string;
  /** Sub-component short names, e.g. ["Container", "Table", "Pagination"] */
  subComponents: string[];
  /** Canonical IDs of sub-components */
  subComponentIds: string[];
  /** Full qualified names to filter: dotted ("DataGrid.Header") or prefixed ("DataGridTable") */
  fullNames: string[];
  /** Confidence in this composite detection */
  confidence: ConfidenceMeta;
}

/**
 * Detects composite/compound component API patterns in the codebase.
 *
 * Composite detection is SEMANTIC-FIRST, HEURISTIC-SECOND:
 *
 * Strong signals (semantic proof):
 *   - Object.assign(DataGrid, { Table, Pagination })
 *   - DataGrid.Table = Table
 *   - namespace exports
 *   - shared module ownership (same file)
 *   - JSX dot notation (<DataGrid.Table />)
 *
 * Weak signals (heuristic fallback):
 *   - naming prefixes (DataGridTable → DataGrid)
 *   - PascalCase inference
 *
 * Prefix heuristics are fallback-only. Ownership must be proven.
 */
export class CompositeDetector {
  /**
   * Scan all source files for composite component patterns.
   * Semantic signals are checked first; prefix heuristics are fallback only.
   */
  static detect(
    project: Project,
    components: ComponentMeta[]
  ): Map<string, CompositeGroup> {
    const groups = new Map<string, CompositeGroup>();

    // ── Phase 1: Semantic Detection ─────────────────────────

    // 1a: Static property assignments: DataGrid.Header = HeaderComponent
    const staticAssignments = new Map<string, Set<string>>();
    for (const sourceFile of project.getSourceFiles()) {
      const assignments = CompositeDetector.extractStaticPropertyAssignments(sourceFile);
      for (const [root, subs] of assignments) {
        const existing = staticAssignments.get(root) ?? new Set();
        for (const sub of subs) existing.add(sub);
        staticAssignments.set(root, existing);
      }
    }

    // 1b: Object.assign patterns: Object.assign(DataGrid, { Header, Body })
    const objectAssigns = new Map<string, Set<string>>();
    for (const sourceFile of project.getSourceFiles()) {
      const assigns = CompositeDetector.extractObjectAssignPatterns(sourceFile);
      for (const [root, subs] of assigns) {
        const existing = objectAssigns.get(root) ?? new Set();
        for (const sub of subs) existing.add(sub);
        objectAssigns.set(root, existing);
      }
    }

    // 1c: Dotted JSX usage: <DataGrid.Header />
    const dottedUsages = new Map<string, Set<string>>();
    for (const sourceFile of project.getSourceFiles()) {
      const fileDotted = CompositeDetector.extractDottedJsxTags(sourceFile);
      for (const [root, subs] of fileDotted) {
        const existing = dottedUsages.get(root) ?? new Set();
        for (const sub of subs) existing.add(sub);
        dottedUsages.set(root, existing);
      }
    }

    // 1d: Namespace/module co-location: components exported from the same file
    const moduleOwnership = CompositeDetector.detectModuleOwnership(components);

    // ── Merge semantic signals ──────────────────────────────

    const allRoots = new Set([
      ...staticAssignments.keys(),
      ...objectAssigns.keys(),
      ...dottedUsages.keys(),
      ...moduleOwnership.keys(),
    ]);

    for (const rootName of allRoots) {
      const evidence: EvidenceType[] = [];
      const allSubs = new Set<string>();

      if (staticAssignments.has(rootName)) {
        evidence.push("static-assignment");
        for (const s of staticAssignments.get(rootName)!) allSubs.add(s);
      }
      if (objectAssigns.has(rootName)) {
        evidence.push("object-assign");
        for (const s of objectAssigns.get(rootName)!) allSubs.add(s);
      }
      if (dottedUsages.has(rootName)) {
        evidence.push("dotted-jsx");
        for (const s of dottedUsages.get(rootName)!) allSubs.add(s);
      }
      if (moduleOwnership.has(rootName)) {
        evidence.push("module-ownership");
        for (const s of moduleOwnership.get(rootName)!) allSubs.add(s);
      }

      if (allSubs.size === 0) continue;

      const subList = Array.from(allSubs).sort();
      const rootComp = components.find((c) => c.name === rootName);
      const rootCanonicalId = rootComp?.id ?? buildCanonicalId("unknown", rootName);

      // Build sub-component canonical IDs
      const subComponentIds = subList.map((sub) => {
        const subComp = components.find(
          (c) => c.name === `${rootName}${sub}` || c.name === sub
        );
        return subComp?.id ?? buildCanonicalId("unknown", `${rootName}.${sub}`);
      });

      // Semantic confidence: at least one strong signal
      const score = evidence.length >= 2 ? 0.95 : 0.9;

      groups.set(rootName, {
        root: rootName,
        rootCanonicalId,
        subComponents: subList,
        subComponentIds,
        fullNames: [
          ...subList.map((s) => `${rootName}.${s}`),
          ...subList.map((s) => `${rootName}${s}`),
        ],
        confidence: { score, evidence },
      });
    }

    // ── Phase 2: Prefix Heuristic (fallback only) ───────────
    // Only applies to components NOT already claimed by semantic detection

    const claimed = new Set<string>();
    for (const group of groups.values()) {
      for (const full of group.fullNames) claimed.add(full);
      claimed.add(group.root);
    }

    const prefixGroups = CompositeDetector.detectPrefixPatterns(components, claimed);
    for (const [root, group] of prefixGroups) {
      if (!groups.has(root)) {
        groups.set(root, group);
      }
    }

    return groups;
  }

  /**
   * Detect components co-located in the same module as potential composite sub-components.
   * If a file exports: DataGrid, DataGridTable, DataGridPagination
   * and DataGrid is the shortest name, it's likely the root.
   */
  private static detectModuleOwnership(
    components: ComponentMeta[]
  ): Map<string, Set<string>> {
    const result = new Map<string, Set<string>>();
    const byFile = new Map<string, ComponentMeta[]>();

    for (const comp of components) {
      const existing = byFile.get(comp.relativePath) ?? [];
      existing.push(comp);
      byFile.set(comp.relativePath, existing);
    }

    for (const [, fileComponents] of byFile) {
      if (fileComponents.length < 3) continue; // Need at least root + 2 subs

      // Sort by name length — shortest is potential root
      const sorted = [...fileComponents].sort(
        (a, b) => a.name.length - b.name.length
      );

      for (const potentialRoot of sorted) {
        const rootName = potentialRoot.name;
        if (rootName.length < 4) continue;

        const subs: string[] = [];
        for (const comp of fileComponents) {
          if (comp === potentialRoot) continue;
          if (
            comp.name.startsWith(rootName) &&
            comp.name.length > rootName.length &&
            /[A-Z]/.test(comp.name[rootName.length]!)
          ) {
            const suffix = comp.name.slice(rootName.length);
            if (suffix !== "Provider" && suffix !== "Context") {
              subs.push(suffix);
            }
          }
        }

        if (subs.length >= 2) {
          const existing = result.get(rootName) ?? new Set();
          for (const s of subs) existing.add(s);
          result.set(rootName, existing);
        }
      }
    }

    return result;
  }

  /**
   * Detect prefix-based compound component patterns (HEURISTIC FALLBACK).
   *
   * Only for components not already claimed by semantic detection.
   * Requires at least 2 sub-components to qualify.
   */
  private static detectPrefixPatterns(
    components: ComponentMeta[],
    claimed: Set<string>
  ): Map<string, CompositeGroup> {
    const groups = new Map<string, CompositeGroup>();
    const componentNames = new Set(components.map((c) => c.name));

    const potentialRoots = components
      .map((c) => c.name)
      .filter(
        (name) =>
          name.length >= 4 &&
          /^[A-Z][a-z]/.test(name) &&
          !claimed.has(name)
      );

    potentialRoots.sort((a, b) => a.length - b.length);
    const localClaimed = new Set<string>();

    for (const rootName of potentialRoots) {
      if (localClaimed.has(rootName)) continue;

      const subs: string[] = [];
      const fullNames: string[] = [];

      for (const name of componentNames) {
        if (name === rootName) continue;
        if (localClaimed.has(name)) continue;
        if (claimed.has(name)) continue;

        if (
          name.startsWith(rootName) &&
          name.length > rootName.length &&
          /[A-Z]/.test(name[rootName.length]!)
        ) {
          const suffix = name.slice(rootName.length);
          if (suffix === "Provider" || suffix === "Context") continue;
          subs.push(suffix);
          fullNames.push(name);
        }
      }

      if (subs.length >= 2) {
        for (const full of fullNames) localClaimed.add(full);

        const rootComp = components.find((c) => c.name === rootName);
        const rootCanonicalId =
          rootComp?.id ?? buildCanonicalId("unknown", rootName);

        const subComponentIds = fullNames.map((fn) => {
          const comp = components.find((c) => c.name === fn);
          return comp?.id ?? buildCanonicalId("unknown", fn);
        });

        groups.set(rootName, {
          root: rootName,
          rootCanonicalId,
          subComponents: subs.sort(),
          subComponentIds,
          fullNames: [
            ...subs.map((s) => `${rootName}.${s}`),
            ...fullNames,
          ].sort(),
          confidence: {
            score: 0.6,
            evidence: ["prefix-heuristic"],
          },
        });
      }
    }

    return groups;
  }

  /**
   * Extract dotted JSX tag names (e.g. DataGrid.Header) from a source file.
   */
  private static extractDottedJsxTags(
    sourceFile: SourceFile
  ): Map<string, Set<string>> {
    const result = new Map<string, Set<string>>();

    const processTag = (tagText: string) => {
      const match = tagText.match(
        /^([A-Z][a-zA-Z0-9]*)\.([A-Z][a-zA-Z0-9]*)$/
      );
      if (match) {
        const root = match[1]!;
        const sub = match[2]!;
        const existing = result.get(root) ?? new Set();
        existing.add(sub);
        result.set(root, existing);
      }
    };

    for (const el of sourceFile.getDescendantsOfKind(
      SyntaxKind.JsxOpeningElement
    )) {
      processTag(el.getTagNameNode().getText());
    }
    for (const el of sourceFile.getDescendantsOfKind(
      SyntaxKind.JsxSelfClosingElement
    )) {
      processTag(el.getTagNameNode().getText());
    }

    return result;
  }

  /**
   * Detect static property assignment patterns:
   *   DataGrid.Header = HeaderComponent;
   */
  private static extractStaticPropertyAssignments(
    sourceFile: SourceFile
  ): Map<string, Set<string>> {
    const result = new Map<string, Set<string>>();
    const text = sourceFile.getFullText();

    const assignmentPattern = /([A-Z][a-zA-Z0-9]*)\.([A-Z][a-zA-Z0-9]*)\s*=/g;
    let match: RegExpExecArray | null;

    while ((match = assignmentPattern.exec(text)) !== null) {
      const root = match[1]!;
      const sub = match[2]!;
      if (
        [
          "React",
          "Object",
          "Array",
          "Promise",
          "JSON",
          "Math",
          "Number",
          "String",
          "Map",
          "Set",
          "Error",
          "Date",
          "RegExp",
          "Symbol",
          "WeakMap",
          "WeakSet",
          "Proxy",
          "Reflect",
          "Intl",
          "console",
          "document",
          "window",
          "globalThis",
          "process",
        ].includes(root)
      ) {
        continue;
      }
      const existing = result.get(root) ?? new Set();
      existing.add(sub);
      result.set(root, existing);
    }

    return result;
  }

  /**
   * Detect Object.assign patterns:
   *   Object.assign(DataGrid, { Header, Body, Row });
   */
  private static extractObjectAssignPatterns(
    sourceFile: SourceFile
  ): Map<string, Set<string>> {
    const result = new Map<string, Set<string>>();
    const text = sourceFile.getFullText();

    const objectAssignPattern =
      /Object\.assign\(\s*([A-Z][a-zA-Z0-9]*)\s*,\s*\{([^}]+)\}/g;
    let match: RegExpExecArray | null;

    while ((match = objectAssignPattern.exec(text)) !== null) {
      const root = match[1]!;
      const propsText = match[2]!;
      const propNames = propsText
        .split(",")
        .map((p) => p.trim().split(":")[0]!.trim())
        .filter((p) => /^[A-Z][a-zA-Z0-9]*$/.test(p));

      const existing = result.get(root) ?? new Set();
      for (const prop of propNames) {
        existing.add(prop);
      }
      result.set(root, existing);
    }

    return result;
  }

  /**
   * Apply composite detection results to component metadata.
   * - Marks root components as composite
   * - Populates subComponents and subComponentIds
   * - Returns the set of sub-component full names for filtering
   */
  static applyToComponents(
    components: ComponentMeta[],
    composites: Map<string, CompositeGroup>
  ): Set<string> {
    const subComponentFullNames = new Set<string>();

    for (const [rootName, group] of composites) {
      const rootComp = components.find((c) => c.name === rootName);
      if (rootComp) {
        rootComp.isComposite = true;
        rootComp.subComponents = group.subComponents;
        rootComp.subComponentIds = group.subComponentIds;
      }

      for (const fullName of group.fullNames) {
        subComponentFullNames.add(fullName);
      }
    }

    return subComponentFullNames;
  }
}
