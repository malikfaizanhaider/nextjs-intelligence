import { IntelligenceRegistry } from "../registry";

/**
 * Migration-safe adapter that keeps existing singleton behavior while enabling
 * explicit session injection at call sites.
 */
export class RegistryAdapter {
  static resolve(registry?: IntelligenceRegistry): IntelligenceRegistry {
    return registry ?? IntelligenceRegistry.getInstance();
  }
}
