"use client";

import {
  createContext,
  useContext,
  useRef,
  useCallback,
  type ReactNode,
} from "react";
import type { RuntimeMeta, ComponentRegistration } from "@i2c/intelligence-types";

// ─── Types ──────────────────────────────────────────────────

interface IntelligenceContextValue {
  /** Register a component mount */
  mount: (registration: ComponentRegistration, route: string) => void;
  /** Register a component unmount */
  unmount: (componentId: string) => void;
  /** Record a render with duration */
  recordRender: (componentId: string, durationMs: number) => void;
  /** Get all runtime data */
  getRuntimeData: () => Map<string, RuntimeMeta>;
  /** Get current route */
  getCurrentRoute: () => string;
  /** Set current route */
  setCurrentRoute: (route: string) => void;
  /** Export runtime data as serializable object */
  exportRuntimeData: () => Record<string, RuntimeMeta>;
}

// ─── Context ────────────────────────────────────────────────

const IntelligenceContext = createContext<IntelligenceContextValue | null>(null);

// ─── Provider ───────────────────────────────────────────────

interface IntelligenceProviderProps {
  children: ReactNode;
  /** Enable console logging of mount/unmount events */
  debug?: boolean;
}

/**
 * Runtime intelligence provider that tracks component mounts,
 * unmounts, renders, and route associations.
 *
 * Wrap your app's root layout with this provider:
 *
 * ```tsx
 * <IntelligenceProvider>
 *   {children}
 * </IntelligenceProvider>
 * ```
 */
export function IntelligenceProvider({ children, debug = false }: IntelligenceProviderProps) {
  const runtimeDataRef = useRef(new Map<string, RuntimeMeta>());
  const currentRouteRef = useRef("/");

  const mount = useCallback(
    (registration: ComponentRegistration, route: string) => {
      const { canonicalId } = registration;
      const existing = runtimeDataRef.current.get(canonicalId);
      const now = new Date().toISOString();

      if (existing) {
        existing.mountCount += 1;
        existing.lastMountedAt = now;
        if (!existing.mountedOnRoutes.includes(route)) {
          existing.mountedOnRoutes.push(route);
        }
      } else {
        runtimeDataRef.current.set(canonicalId, {
          componentId: canonicalId,
          mountCount: 1,
          unmountCount: 0,
          renderCount: 1,
          lastMountedAt: now,
          lastUnmountedAt: null,
          mountedOnRoutes: [route],
          averageRenderDuration: 0,
        });
      }

      if (debug) {
        console.log(`[intelligence:runtime] Mount: ${canonicalId} on ${route}`);
      }
    },
    [debug]
  );

  const unmount = useCallback(
    (componentId: string) => {
      const existing = runtimeDataRef.current.get(componentId);
      if (existing) {
        existing.unmountCount += 1;
        existing.lastUnmountedAt = new Date().toISOString();
      }

      if (debug) {
        console.log(`[intelligence:runtime] Unmount: ${componentId}`);
      }
    },
    [debug]
  );

  const recordRender = useCallback(
    (componentId: string, durationMs: number) => {
      const existing = runtimeDataRef.current.get(componentId);
      if (existing) {
        const totalDuration =
          existing.averageRenderDuration * (existing.renderCount - 1) + durationMs;
        existing.renderCount += 1;
        existing.averageRenderDuration = totalDuration / (existing.renderCount - 1);
      }
    },
    []
  );

  const getRuntimeData = useCallback(() => {
    return new Map(runtimeDataRef.current);
  }, []);

  const getCurrentRoute = useCallback(() => {
    return currentRouteRef.current;
  }, []);

  const setCurrentRoute = useCallback((route: string) => {
    currentRouteRef.current = route;
  }, []);

  const exportRuntimeData = useCallback(() => {
    const result: Record<string, RuntimeMeta> = {};
    for (const [id, meta] of runtimeDataRef.current) {
      result[id] = { ...meta, mountedOnRoutes: [...meta.mountedOnRoutes] };
    }
    return result;
  }, []);

  const value: IntelligenceContextValue = {
    mount,
    unmount,
    recordRender,
    getRuntimeData,
    getCurrentRoute,
    setCurrentRoute,
    exportRuntimeData,
  };

  return (
    <IntelligenceContext.Provider value={value}>
      {children}
    </IntelligenceContext.Provider>
  );
}

// ─── Hook: useIntelligenceContext ───────────────────────────

export function useIntelligenceContext(): IntelligenceContextValue {
  const context = useContext(IntelligenceContext);
  if (!context) {
    throw new Error(
      "useIntelligenceContext must be used within an <IntelligenceProvider>"
    );
  }
  return context;
}
