import os from "node:os";
import path from "node:path";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import type { McpProbe, ProbeContext, ProbeResult, DiagnosticStep } from "../discovery/types";
import type { McpServer } from "../mcp.shared";

export async function findStoredAgentRecord(agentId: string): Promise<Record<string, unknown> | null> {
  const base = path.join(os.homedir(), ".paseo", "agents");
  if (!existsSync(base)) return null;
  try {
    const projects = await readdir(base, { withFileTypes: true });
    for (const ent of projects) {
      const cand = ent.isDirectory()
        ? path.join(base, ent.name, `${agentId}.json`)
        : path.join(base, ent.name);
      if (ent.isFile() && ent.name !== `${agentId}.json`) continue;
      if (existsSync(cand)) {
        try {
          return JSON.parse(await readFile(cand, "utf8")) as Record<string, unknown>;
        } catch {}
      }
    }
  } catch {}
  return null;
}

export const paseoProbe: McpProbe = {
  id: "paseo",
  label: "Paseo · Built-in",
  matches: (provider) => provider === "paseo",
  async probe(ctx: ProbeContext): Promise<ProbeResult> {
    const steps: DiagnosticStep[] = [];
    const record = await findStoredAgentRecord(ctx.agentId);
    const cfg = (record?.config ?? {}) as Record<string, unknown>;
    const meta = (record?.metadata ?? {}) as Record<string, unknown>;
    const mcpServers = ((cfg.mcpServers ?? meta.mcpServers ?? {}) as Record<string, unknown>);
    const paseoDef = mcpServers.paseo as Record<string, unknown> | undefined;

    if (record) {
      steps.push({
        target: "Paseo Agent Record",
        status: "found",
        details: paseoDef?.url ? `Active session endpoint: ${paseoDef.url}` : "Found record, no explicit paseo MCP entry",
        contentPreview: paseoDef ? JSON.stringify(paseoDef, null, 2) : null,
      });
    } else {
      steps.push({
        target: "Paseo Agent Record",
        status: "missing",
        details: `No stored agent record found for ID ${ctx.agentId}`,
        contentPreview: null,
      });
    }

    let url: string | null = null;
    let hasSecrets = false;
    if (paseoDef && typeof paseoDef.url === "string") {
      url = paseoDef.url;
      hasSecrets = Boolean(paseoDef.headers);
    } else {
      const configPath = path.join(os.homedir(), ".paseo", "config.json");
      if (existsSync(configPath)) {
        try {
          const configJson = JSON.parse(await readFile(configPath, "utf8")) as Record<string, unknown>;
          const daemon = (configJson.daemon ?? {}) as Record<string, unknown>;
          const mcp = (daemon.mcp ?? {}) as Record<string, unknown>;
          const enabled = mcp.enabled !== false && mcp.injectIntoAgents !== false;
          steps.push({
            target: "Paseo Daemon MCP Config",
            status: enabled ? "found" : "skipped",
            details: `mcp.enabled=${mcp.enabled !== false}, injectIntoAgents=${mcp.injectIntoAgents !== false}, listen=${daemon.listen ?? "default"}`,
            contentPreview: JSON.stringify(daemon.mcp, null, 2),
          });

          if (enabled) {
            const listen = typeof daemon.listen === "string" ? daemon.listen : "127.0.0.1:6767";
            url = `http://${listen}/mcp/agents?callerAgentId=${ctx.agentId}`;
          }
        } catch (e) {
          steps.push({
            target: "Paseo Daemon MCP Config",
            status: "error",
            details: e instanceof Error ? e.message : String(e),
            contentPreview: null,
          });
        }
      }
    }

    if (!url) {
      return { servers: [], steps };
    }

    const server: McpServer = {
      id: "session:paseo",
      name: "Paseo (Builtin)",
      transport: "http",
      source: { kind: "paseo", label: "Paseo · Built-in", path: url },
      command: null,
      url,
      description: "Paseo control plane, agent automation & browser tools",
      hasSecrets,
      configPreview: JSON.stringify({ name: "Paseo (Builtin)", url }, null, 2),
    };

    return { servers: [server], steps };
  },
};

export default paseoProbe;
