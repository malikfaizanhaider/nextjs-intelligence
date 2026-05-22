"use client";

import { useEffect } from "react";
import { useIntelligenceContext } from "./provider";

/**
 * Hook to sync current route path with the intelligence runtime.
 * Place this in your root layout or a route-tracking component.
 *
 * Usage:
 * ```tsx
 * function Layout({ children }) {
 *   useRouteTracking();
 *   return <>{children}</>;
 * }
 * ```
 */
export function useRouteTracking(): void {
  const { setCurrentRoute } = useIntelligenceContext();

  useEffect(() => {
    // Use window.location for route tracking
    const updateRoute = () => {
      setCurrentRoute(window.location.pathname);
    };

    updateRoute();

    // Listen for route changes via popstate
    window.addEventListener("popstate", updateRoute);

    // MutationObserver to detect Next.js client-side navigations
    // that update the URL without triggering popstate
    const observer = new MutationObserver(() => {
      const currentPath = window.location.pathname;
      updateRoute();
    });

    observer.observe(document.head, {
      childList: true,
      subtree: true,
    });

    return () => {
      window.removeEventListener("popstate", updateRoute);
      observer.disconnect();
    };
  }, [setCurrentRoute]);
}
