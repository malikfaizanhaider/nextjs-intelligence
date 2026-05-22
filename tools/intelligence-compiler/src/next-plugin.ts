import { resolve } from "node:path";
import { runIntelligencePipeline } from "../../intelligence-core/src/pipeline";

// ─── Types ──────────────────────────────────────────────────

interface NextConfig {
  reactStrictMode?: boolean;
  experimental?: Record<string, unknown>;
  webpack?: unknown;
  [key: string]: unknown;
}

interface IntelligencePluginOptions {
  /** Enable intelligence analysis during build */
  enabled?: boolean;
  /** Custom app directory (defaults to "app") */
  appDir?: string;
  /** Output directory for generated files */
  outputDir?: string;
  /** Enable incremental scanning */
  incremental?: boolean;
  /** Additional glob patterns to include */
  include?: string[];
  /** Additional glob patterns to exclude */
  exclude?: string[];
}

/**
 * Next.js plugin wrapper that integrates the intelligence engine
 * into the build pipeline.
 *
 * Supports both Webpack and Turbopack (Next.js 16 default).
 * Uses async config resolution — compatible with Next.js 14+.
 *
 * Usage in next.config.ts:
 * ```ts
 * import { withIntelligence } from "@i2c/intelligence/compiler/next-plugin";
 *
 * export default withIntelligence({
 *   reactStrictMode: true,
 * });
 * ```
 *
 * With options:
 * ```ts
 * export default withIntelligence(
 *   { reactStrictMode: true },
 *   { appDir: "src/app", outputDir: ".generated/intelligence" }
 * );
 * ```
 */
export async function withIntelligence(
  nextConfig: NextConfig = {},
  pluginOptions: IntelligencePluginOptions = {}
): Promise<NextConfig> {
  const {
    enabled = true,
    appDir = "app",
    outputDir = ".generated/intelligence",
    incremental = true,
    include = [],
    exclude = [],
  } = pluginOptions;

  if (!enabled) {
    return nextConfig;
  }

  // Run analysis as part of the config resolution
  const projectRoot = process.cwd();

  // Await the intelligence pipeline before returning config.
  // This ensures analysis completes before the build starts,
  // regardless of bundler (Webpack or Turbopack).
  await runIntelligencePipeline({
    projectRoot,
    appDir,
    outputDir,
    incremental,
    include: include.length > 0
      ? include
      : [
          `${appDir}/**/*.{tsx,ts}`,
          "components/**/*.{tsx,ts}",
          "@ui/**/*.{tsx,ts}",
          "ui/**/*.{tsx,ts}",
        ],
    exclude: [
      "**/*.test.*",
      "**/*.spec.*",
      "**/*.stories.*",
      "**/__tests__/**",
      ...exclude,
    ],
  }).catch((err) => {
    console.error("[intelligence] Analysis failed:", err);
  });

  return {
    ...nextConfig,
  };
}

export default withIntelligence;
