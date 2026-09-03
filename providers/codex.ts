import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { McpProbe, McpServer, ProbeContext } from "../discovery/types";

export const codexProbe: McpProbe = {
  id: "codex",
  label: "codex · live",
  matches: (provider) => provider === "codex",
  async probe(ctx: ProbeContext) {
    const home = os.homedir();
    const candidatePaths = [
      { path: path.join(home, ".codex", "config.toml"), label: "codex · user global" },
      { path: path.join(ctx.cwd, ".codex", "config.toml"), label: "codex · project override" },
    ];

    const merged = new Map<string, McpServer>();
    const steps: Array<{ target: string; status: "found" | "missing" | "error" | "skipped"; details: string; contentPreview: string | null }> = [];

    for (const cand of candidatePaths) {
      if (!existsSync(cand.path)) {
        steps.push({
          target: cand.path,
          status: "missing",
          details: `${cand.label} does not exist`,
          contentPreview: null,
        });
        continue;
      }
      try {
        const text = await readFile(cand.path, "utf8");
        const sections = text.split(/^\s*\[mcp_servers\./gm).slice(1);
        let count = 0;
        for (const sec of sections) {
          const lines = sec.split("\n");
          const name = (lines[0] || "").replace(/\][\s\S]*$/, "").trim();
          if (!name) continue;
          count++;
          const body = lines.slice(1).join("\n");
          const cmdMatch = body.match(/^\s*command\s*=\s*"([^"]+)"/m);
          const urlMatch = body.match(/^\s*url\s*=\s*"([^"]+)"/m);
          const command = cmdMatch ? cmdMatch[1] : null;
          const url = urlMatch ? urlMatch[1] : null;
          const transport = url ? ("http" as const) : command ? ("stdio" as const) : ("unknown" as const);

          merged.set(name, {
            id: `session:codex:${name}`,
            name,
            transport,
            source: { kind: "session" as const, label: cand.label, path: cand.path },
            command,
            url,
            description: url ?? command ?? "codex mcp (toml)",
            hasSecrets: /env|token|key|secret/i.test(body),
            configPreview: `[mcp_servers.${name}]\n${body.slice(0, 500).trim()}`,
          });
        }
        steps.push({
          target: cand.path,
          status: "found",
          details: `${cand.label} (${text.length} bytes) · Valid TOML with ${count} MCP server(s)`,
          contentPreview: text.slice(0, 1000),
        });
      } catch (e) {
        steps.push({
          target: cand.path,
          status: "error",
          details: `${cand.label} failed to read: ${e instanceof Error ? e.message : String(e)}`,
          contentPreview: null,
        });
        return { servers: [], error: e instanceof Error ? e.message : String(e), steps };
      }
    }

    return {
      servers: [...merged.values()],
      error: null,
      steps,
    };
  },
};

export default codexProbe;
