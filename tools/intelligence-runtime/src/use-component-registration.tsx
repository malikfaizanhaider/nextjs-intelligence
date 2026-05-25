"use client";

import { useEffect, useRef } from "react";
import type { ComponentRegistration } from "../../intelligence-types/src/index";
import { useIntelligenceContext } from "./provider";

/**
 * Hook to register a component with the intelligence runtime.
 * Automatically tracks mounts, unmounts, and renders.
 *
 * Uses CANONICAL IDs for stable tracking across the system.
 *
 * Usage:
 * ```tsx
 * function MyComponent() {
 *   useComponentRegistration({
 *     canonicalId: "app/components/MyComponent.tsx#MyComponent",
 *     type: "component",
 *     sourceFile: "app/components/MyComponent.tsx",
 *     exportName: "MyComponent",
 *     compositeRoot: null,
 *   });
 *   return <div>...</div>;
 * }
 * ```
 */
export function useComponentRegistration(meta: ComponentRegistration): void {
  const { mount, unmount, recordRender, getCurrentRoute } = useIntelligenceContext();
  const renderStartRef = useRef<number>(0);
  const mountedRef = useRef(false);

  // Track render timing
  renderStartRef.current = performance.now();

  useEffect(() => {
    const route = getCurrentRoute();

    if (!mountedRef.current) {
      mount(meta, route);
      mountedRef.current = true;
    }

    // Record render duration
    if (renderStartRef.current > 0) {
      const duration = performance.now() - renderStartRef.current;
      recordRender(meta.canonicalId, duration);
    }

    return () => {
      unmount(meta.canonicalId);
      mountedRef.current = false;
    };
    // Only re-run on actual mount/unmount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
