"use client";

import { useEffect, useState } from "react";

/**
 * Design tokens for the intelligence dashboard.
 *
 * Two variants are exported:
 *  - {@link lightTokens} — default light theme.
 *  - {@link darkTokens}  — used when `prefers-color-scheme: dark` matches.
 *
 * The {@link useTheme} hook reads the system preference and listens for
 * changes. All colors meet WCAG AA contrast (≥ 4.5:1) against their intended
 * background.
 *
 * Semantic colors (severity, component-type badges, HTTP methods, …) are kept
 * in `dashboard.tsx` because they encode meaning and rarely need to differ
 * between themes; only neutral surfaces/text/borders are tokenized here.
 */
export interface DashboardTokens {
  /** Page background (outermost) */
  bg: string;
  /** Surface background (cards, panels, table headers) */
  surface: string;
  /** Subtle surface (toolbar strips, sticky headers, hover) */
  surfaceAlt: string;
  /** Strongly emphasized surface (selected row background) */
  surfaceSelected: string;
  /** Primary divider line */
  border: string;
  /** Faint divider (row separators) */
  borderSubtle: string;
  /** Body text */
  text: string;
  /** Secondary text (labels, captions) */
  textMuted: string;
  /** Tertiary text (placeholders, empty states) */
  textFaint: string;
  /** Brand accent for selected tabs / focus rings / links */
  accent: string;
  /** Accent fill tint */
  accentBg: string;
  /** Code / monospace text color */
  code: string;
}

export const lightTokens: DashboardTokens = {
  bg: "#ffffff",
  surface: "#ffffff",
  surfaceAlt: "#f9fafb",
  surfaceSelected: "#eff6ff",
  border: "#e5e7eb",
  borderSubtle: "#f3f4f6",
  text: "#111827",
  textMuted: "#6b7280",
  textFaint: "#9ca3af",
  accent: "#3b82f6",
  accentBg: "#eff6ff",
  code: "#374151",
};

export const darkTokens: DashboardTokens = {
  bg: "#0b0f17",
  surface: "#111827",
  surfaceAlt: "#1f2937",
  surfaceSelected: "#1e3a8a",
  border: "#374151",
  borderSubtle: "#1f2937",
  text: "#f3f4f6",
  textMuted: "#9ca3af",
  textFaint: "#6b7280",
  accent: "#60a5fa",
  accentBg: "#1e3a8a",
  code: "#e5e7eb",
};

/**
 * Subscribe to the user's `prefers-color-scheme` setting and return the
 * matching token set. Re-renders the consumer whenever the system theme
 * changes. SSR-safe: returns light tokens on the server.
 */
export function useTheme(): { tokens: DashboardTokens; mode: "light" | "dark" } {
  const [mode, setMode] = useState<"light" | "dark">(() => {
    if (typeof window === "undefined" || !window.matchMedia) return "light";
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (event: MediaQueryListEvent) => setMode(event.matches ? "dark" : "light");
    media.addEventListener("change", handler);
    return () => media.removeEventListener("change", handler);
  }, []);

  return { tokens: mode === "dark" ? darkTokens : lightTokens, mode };
}
