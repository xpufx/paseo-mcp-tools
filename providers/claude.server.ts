import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { McpProbe, ProbeContext, McpServer } from "./types.server";

function redact(text: string): string {
  return text
    .replace(/"([^"]*(?:token|secret|key|password|auth)[^"]*)"\s*:\s*"[^"]*"/gi, '"$1": "•••"')
    .replace(/(token|secret|key|password|auth)=[^\s"']+/gi, "$1=•••");
}

export const claudeProbe: McpProbe = {
  id: "claude",
  label: "claude · live",
  matches: (provider) => provider === "claude",
  async probe(ctx: ProbeContext) {
    const p = path.join(os.homedir(), ".claude.json");
    if (!existsSync(p)) return { servers: [], error: null };
    try {
      const raw = JSON.parse(await readFile(p, "utf8")) as Record<string, unknown>;
      const mcp = (raw.mcpServers ?? {}) as Record<string, unknown>;
      const servers: McpServer[] = [];
      for (const [name, defRaw] of Object.entries(mcp)) {
        if (!defRaw || typeof defRaw !== "object") continue;
        const def = defRaw as Record<string, unknown>;
        const url = typeof def.url === "string" ? def.url : null;
        const command = typeof def.command === "string" ? def.command : null;
        servers.push({
          id: `session:claude:${name}`,
          name,
          transport: url ? "http" : command ? "stdio" : "unknown",
          source: { kind: "session", label: "claude · live", path: p },
          command,
          url,
          description: url ?? command ?? "",
          hasSecrets: Boolean(def.env || def.headers),
          configPreview: redact(JSON.stringify(def, null, 2)),
        });
      }
      return { servers, error: null };
    } catch (e) {
      return { servers: [], error: e instanceof Error ? e.message : String(e) };
    }
  },
};
