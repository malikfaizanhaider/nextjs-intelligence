import { resolve } from "node:path";
import { runIntelligencePipeline } from "@i2c/intelligence-core/pipeline";

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
 * Usage in next.config.js:
 * ```js
 * import { withIntelligence } from "@i2c/intelligence-compiler/next-plugin";
 *
 * export default withIntelligence({
 *   reactStrictMode: true,
 * });
 * ```
 *
 * With options:
 * ```js
 * export default withIntelligence(
 *   { reactStrictMode: true },
 *   { appDir: "src/app", outputDir: ".generated/intelligence" }
 * );
 * ```
 */
export function withIntelligence(
  nextConfig: NextConfig = {},
  pluginOptions: IntelligencePluginOptions = {}
): NextConfig {
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

  // Run the intelligence pipeline before the build starts.
  // We use a top-level promise that blocks the config.
  const analysisPromise = runIntelligencePipeline({
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
    // Hook into the webpack config to ensure analysis completes before build
    webpack: (config: Record<string, unknown>, context: Record<string, unknown>) => {
      // Ensure analysis is complete
      if (typeof (globalThis as Record<string, unknown>).__intelligenceReady === "undefined") {
        (globalThis as Record<string, unknown>).__intelligenceReady = analysisPromise.then(() => {
          (globalThis as Record<string, unknown>).__intelligenceReady = true;
        });
      }

      // Apply user's webpack config if provided
      if (typeof nextConfig.webpack === "function") {
        return (nextConfig.webpack as (config: unknown, context: unknown) => unknown)(config, context);
      }

      return config;
    },
  };
}

export default withIntelligence;
