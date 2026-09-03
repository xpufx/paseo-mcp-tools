import type { McpProbe } from "../discovery/types";
import * as catalog from "./catalog";

export const probes: McpProbe[] = Object.values(catalog);

export function probeForProvider(provider: string): McpProbe | null {
  return probes.find((p) => p.matches(provider)) ?? null;
}

export * from "./catalog";
