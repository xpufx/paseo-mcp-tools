import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { McpProbe, ProbeContext } from "./types.server";

export const codexProbe: McpProbe = {
  id: "codex",
  label: "codex · live",
  matches: (provider) => provider === "codex",
  async probe(ctx) {
    const p = path.join(os.homedir(), ".codex", "config.toml");
    if (!existsSync(p)) return { servers: [], error: null };
    try {
      const text = await readFile(p, "utf8");
      const names = [...text.matchAll(/^\s*\[mcp_servers\.([^\]\s]+)/gm)].map((m) => m[1]);
      return {
        servers: names.map((name) => ({
          id: `session:codex:${name}`,
          name,
          transport: "unknown" as const,
          source: { kind: "session" as const, label: "codex · live", path: p },
          command: null,
          url: null,
          description: "codex mcp (toml)",
          hasSecrets: false,
          configPreview: `[mcp_servers.${name}]`,
        })),
        error: null,
      };
    } catch (e) {
      return { servers: [], error: e instanceof Error ? e.message : String(e) };
    }
  },
};
