import type {
  ComponentMeta,
  CanonicalIdentity,
} from "../../../intelligence-types/src/index";
import { buildCanonicalId } from "../../../intelligence-types/src/index";
import type { CompositeGroup } from "./composite-detector";

/**
 * Result of canonicalization: normalized components and lookup maps.
 */
export interface CanonicalizationResult {
  /** All components with canonical identities resolved */
  components: ComponentMeta[];
  /** Map of canonical ID → ComponentMeta */
  byCanonicalId: Map<string, ComponentMeta>;
  /** Map of display name → canonical ID (may have collisions — use byCanonicalId for exact lookup) */
  nameToCanonicalId: Map<string, string>;
  /** Map of sub-component full name → root canonical ID */
  subToRootMap: Map<string, string>;
  /** Set of all sub-component full names (for filtering from route-level reporting) */
  subComponentNames: Set<string>;
  /** Map of old ID format → canonical ID (for migration) */
  idMigrationMap: Map<string, string>;
}

/**
 * Canonicalization Phase.
 *
 * This is a DEDICATED normalization phase that runs BEFORE graph construction.
 * It ensures all downstream systems operate on canonical identities.
 *
 * Pipeline position:
 *   Raw AST Discovery
 *   → Symbol Resolution
 *   → Composite Ownership Resolution
 *   → **Canonicalization** ← HERE
 *   → Graph Construction
 *   → Runtime Reconciliation
 *
 * Responsibilities:
 * 1. Assign canonical IDs to all components
 * 2. Collapse composite sub-components to their root identity
 * 3. Build lookup maps for downstream systems
 * 4. Normalize: DataGridContainer → DataGrid
 *               DataGridTable → DataGrid
 *               DataGridPagination → DataGrid
 */
export class Canonicalizer {
  /**
   * Run the canonicalization phase.
   *
   * @param components - All discovered components (pre-canonicalization)
   * @param composites - Composite groups from CompositeDetector
   * @returns CanonicalizationResult with normalized data
   */
  static canonicalize(
    components: ComponentMeta[],
    composites: Map<string, CompositeGroup>
  ): CanonicalizationResult {
    const byCanonicalId = new Map<string, ComponentMeta>();
    const nameToCanonicalId = new Map<string, string>();
    const subToRootMap = new Map<string, string>();
    const subComponentNames = new Set<string>();
    const idMigrationMap = new Map<string, string>();

    // Build the sub-component → root mapping from composites
    for (const [rootName, group] of composites) {
      for (const fullName of group.fullNames) {
        subToRootMap.set(fullName, group.rootCanonicalId);
        subComponentNames.add(fullName);
      }
      for (const sub of group.subComponents) {
        // Also map short sub-component names with root prefix
        subToRootMap.set(`${rootName}${sub}`, group.rootCanonicalId);
      }
    }

    // Process each component
    const canonicalized: ComponentMeta[] = [];

    for (const comp of components) {
      // Ensure canonical identity exists
      const canonicalId = buildCanonicalId(comp.relativePath, comp.name);
      const identity: CanonicalIdentity = comp.identity ?? {
        canonicalId,
        sourceFile: comp.relativePath,
        exportName: comp.name,
        absolutePath: comp.filePath,
        compositeRoot: null,
      };

      // Check if this component is a sub-component of a composite
      const compositeRootId = subToRootMap.get(comp.name) ?? null;
      if (compositeRootId) {
        identity.compositeRoot = compositeRootId;
      }

      // Migrate old ID format (relativePath::name → relativePath#name)
      const oldId = comp.id;
      const newId = identity.canonicalId;
      if (oldId !== newId) {
        idMigrationMap.set(oldId, newId);
      }

      const updated: ComponentMeta = {
        ...comp,
        id: newId,
        identity,
      };

      canonicalized.push(updated);
      byCanonicalId.set(newId, updated);
      nameToCanonicalId.set(comp.name, newId);
    }

    // Apply composite metadata to root components
    for (const [rootName, group] of composites) {
      const rootComp = canonicalized.find((c) => c.name === rootName);
      if (rootComp) {
        rootComp.isComposite = true;
        rootComp.subComponents = group.subComponents;
        rootComp.subComponentIds = group.subComponentIds;
      }
    }

    return {
      components: canonicalized,
      byCanonicalId,
      nameToCanonicalId,
      subToRootMap,
      subComponentNames,
      idMigrationMap,
    };
  }

  /**
   * Resolve a component name to its canonical identity.
   * If the name is a sub-component, returns the root's canonical ID.
   */
  static resolveToCanonical(
    name: string,
    result: CanonicalizationResult
  ): string | null {
    // Check if it's a sub-component that should collapse to root
    const rootId = result.subToRootMap.get(name);
    if (rootId) return rootId;

    // Check direct name mapping
    return result.nameToCanonicalId.get(name) ?? null;
  }

  /**
   * Check if a component name is a sub-component that should be filtered
   * from route-level reporting.
   */
  static isSubComponent(
    name: string,
    result: CanonicalizationResult
  ): boolean {
    return result.subComponentNames.has(name);
  }

  /**
   * Get the canonical components for a route (filtering sub-components).
   * Sub-components are collapsed into their root's identity.
   */
  static getCanonicalComponentsForRoute(
    componentNames: string[],
    result: CanonicalizationResult
  ): string[] {
    const canonical = new Set<string>();

    for (const name of componentNames) {
      // If it's a sub-component, add the root instead
      const rootId = result.subToRootMap.get(name);
      if (rootId) {
        // Find the root's display name
        const rootComp = result.byCanonicalId.get(rootId);
        if (rootComp) {
          canonical.add(rootComp.name);
        }
        continue;
      }

      // If it's a dotted name (DataGrid.Header), add the root
      if (name.includes(".")) {
        const rootName = name.split(".")[0]!;
        canonical.add(rootName);
        continue;
      }

      // Not a sub-component, add directly
      if (!result.subComponentNames.has(name)) {
        canonical.add(name);
      }
    }

    return Array.from(canonical).sort();
  }
}
