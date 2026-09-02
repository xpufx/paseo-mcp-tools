import type { McpProbe } from "./types.server";
import { opencodeProbe } from "./opencode.server";
import { claudeProbe } from "./claude.server";
import { codexProbe } from "./codex.server";
import { piProbe } from "./pi.server";

export const probes: McpProbe[] = [opencodeProbe, claudeProbe, codexProbe, piProbe];

export const probeRegistry: Record<string, McpProbe> = Object.fromEntries(
  probes.map((p) => [p.id, p]),
);

export function probeForProvider(provider: string): McpProbe | null {
  return probes.find((p) => p.matches(provider)) ?? null;
}
