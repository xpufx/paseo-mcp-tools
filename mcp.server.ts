import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { McpServerSchema } from "./mcp.shared";
import { z } from "zod";
import { probeForProvider } from "./providers/registry.server";
// Bundled health — SDK inlined so `paseo plugin add` doesn't need to resolve @modelcontextprotocol/sdk
import { checkMany, checkMcpServerHealth } from "./health/health.bundled.mjs";

type McpServer = z.infer<typeof McpServerSchema>;

const PASEO_TOOLS: Array<{ name: string; description: string; category: string }> = [
  { name: "create_agent", description: "Create an agent, optionally in a workspace", category: "Agents" },
  { name: "send_agent_prompt", description: "Send a task to a running agent", category: "Agents" },
  { name: "get_agent_status", description: "Return latest snapshot for an agent", category: "Agents" },
  { name: "list_agents", description: "List recent agents as compact metadata", category: "Agents" },
  { name: "archive_agent", description: "Soft-delete an agent", category: "Agents" },
  { name: "create_workspace", description: "Create a local or worktree-isolated workspace", category: "Workspaces" },
  { name: "list_workspaces", description: "List active workspaces", category: "Workspaces" },
  { name: "archive_workspace", description: "Archive a workspace and its sessions", category: "Workspaces" },
  { name: "list_workspace_scripts", description: "List configured workspace scripts", category: "Scripts" },
  { name: "start_workspace_script", description: "Start a configured script", category: "Scripts" },
  { name: "stop_workspace_script", description: "Stop a running script", category: "Scripts" },
  { name: "list_terminals", description: "List terminal sessions", category: "Terminals" },
  { name: "create_terminal", description: "Create a terminal session", category: "Terminals" },
  { name: "capture_terminal", description: "Capture terminal output", category: "Terminals" },
  { name: "send_terminal_keys", description: "Send keys to a terminal", category: "Terminals" },
  { name: "list_providers", description: "List configured agent providers", category: "Providers" },
  { name: "list_models", description: "List models for a provider", category: "Providers" },
  { name: "inspect_provider", description: "Inspect provider capabilities", category: "Providers" },
];

function redact(text: string): string {
  return text
    .replace(/"([^"]*(?:token|secret|key|password|auth)[^"]*)"\s*:\s*"[^"]*"/gi, '"$1": "•••"')
    .replace(/(token|secret|key|password|auth)=[^\s"']+/gi, "$1=•••");
}

async function loadAgent(agentId: string, context: PluginHandlerContext) {
  const handle = context.paseo.agents.ref(agentId);
  const refreshed = await handle.refresh();
  const agent = refreshed?.agent ?? handle.current();
  if (!agent) throw new Error(`Agent not found: ${agentId}`);
  return { provider: agent.provider, cwd: agent.cwd, handle, snapshot: agent };
}

async function findStoredRecord(agentId: string): Promise<Record<string, unknown> | null> {
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

/**
 * Live servers for THIS agent only.
 * 1) Paseo-injected `mcpServers` from StoredAgentRecord (session-scoped custom servers)
 * 2) Provider-specific live probe — entire logic lives in providers/<id>.server.ts, selected via registry
 */
export async function discoverLiveServers(agentId: string, context: PluginHandlerContext): Promise<{ servers: McpServer[]; error: string | null }> {
  const agent = await loadAgent(agentId, context);
  const servers: McpServer[] = [];
  let error: string | null = null;

  try {
    const record = await findStoredRecord(agentId);
    const cfg = (record?.config ?? {}) as Record<string, unknown>;
    const mcpServers = (cfg.mcpServers ?? {}) as Record<string, unknown>;
    for (const [name, defRaw] of Object.entries(mcpServers)) {
      if (!defRaw || typeof defRaw !== "object" || name === "paseo") continue;
      const def = defRaw as Record<string, unknown>;
      const url = typeof def.url === "string" ? def.url : null;
      const command = typeof def.command === "string" ? def.command : null;
      servers.push({
        id: `session:paseo:${name}`,
        name,
        transport: url ? "http" : command ? "stdio" : "unknown",
        source: { kind: "session", label: `session · ${agent.provider}`, path: `agent:${agentId}` },
        command,
        url,
        description: url ?? command ?? JSON.stringify(def).slice(0, 80),
        hasSecrets: Boolean(def.env || def.headers),
        configPreview: redact(JSON.stringify(def, null, 2)),
      });
    }

    const probe = probeForProvider(agent.provider);
    if (probe) {
      const result = await probe.probe({ agentId, provider: agent.provider, cwd: agent.cwd });
      for (const s of result.servers) {
        if (servers.some((existing) => existing.name === s.name)) continue;
        servers.push(s);
      }
      if (result.error) error = result.error;
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return { servers, error };
}

export function createListMcpHandler() {
  return async (input: { agentId: string }, context: PluginHandlerContext) => {
    const agent = await loadAgent(input.agentId, context);
    const { servers, error } = await discoverLiveServers(input.agentId, context);
    return { provider: agent.provider, cwd: agent.cwd, servers, paseoTools: PASEO_TOOLS, error };
  };
}

export function createReadMcpHandler() {
  return async (input: { agentId: string; serverId: string }, context: PluginHandlerContext) => {
    const { servers } = await discoverLiveServers(input.agentId, context);
    const entry = servers.find((s) => s.id === input.serverId);
    if (!entry) throw new Error(`MCP server not found in this session: ${input.serverId}`);
    return {
      name: entry.name,
      transport: entry.transport,
      source: entry.source,
      path: entry.source.path,
      raw: entry.configPreview,
      redacted: entry.configPreview,
    };
  };
}

export function createHealthHandler() {
  return async (input: { agentId: string; serverId?: string }, context: PluginHandlerContext) => {
    const { servers, error } = await discoverLiveServers(input.agentId, context);
    const targets = input.serverId ? servers.filter((s) => s.id === input.serverId) : servers;
    if (input.serverId && targets.length === 0) {
      throw new Error(`MCP server not found in this session: ${input.serverId}`);
    }
    const results = await checkMany(targets, { timeoutMs: 7000, includeTools: true });
    return { results, error };
  };
}

export function createDiagnoseMcpHandler() {
  return async (input: { agentId: string }, context: PluginHandlerContext) => {
    const agent = await loadAgent(input.agentId, context);
    const steps: Array<{ target: string; status: "found" | "missing" | "error" | "skipped"; details: string; contentPreview: string | null }> = [];
    const home = os.homedir();

    // 1. Check Paseo stored agent record
    try {
      const record = await findStoredRecord(input.agentId);
      if (record) {
        const cfg = (record.config ?? {}) as Record<string, unknown>;
        const mcpServers = (cfg.mcpServers ?? {}) as Record<string, unknown>;
        const names = Object.keys(mcpServers);
        steps.push({
          target: `Paseo Agent Record (${input.agentId})`,
          status: "found",
          details: `Found record with ${names.length} MCP server(s): ${names.join(", ") || "none"}`,
          contentPreview: redact(JSON.stringify(cfg.mcpServers ?? {}, null, 2)),
        });
      } else {
        steps.push({
          target: `Paseo Agent Record (${input.agentId})`,
          status: "missing",
          details: "No stored record file found in ~/.paseo/agents",
          contentPreview: null,
        });
      }
    } catch (e) {
      steps.push({
        target: `Paseo Agent Record (${input.agentId})`,
        status: "error",
        details: e instanceof Error ? e.message : String(e),
        contentPreview: null,
      });
    }

    // 2. Check Provider Probe & File Candidates
    const probe = probeForProvider(agent.provider);
    let discoveredServerCount = 0;
    let probeError: string | null = null;

    if (probe) {
      // Gather file candidates for known file-based providers
      const candidatePaths: string[] = [];
      if (agent.provider === "pi") {
        candidatePaths.push(
          path.join(home, ".config", "mcp", "mcp.json"),
          path.join(home, ".agents", "mcp.json"),
          path.join(home, ".agents", "mcp", "mcp.json"),
          path.join(home, ".pi", "agent", "mcp.json"),
          path.join(home, ".pi", "mcp.json"),
          path.join(home, ".pi", ".mcp.json"),
          path.join(agent.cwd, "mcp.json"),
          path.join(agent.cwd, ".mcp.json"),
          path.join(agent.cwd, ".pi", "mcp.json"),
          path.join(agent.cwd, ".pi", ".mcp.json"),
        );
      } else if (agent.provider === "claude") {
        candidatePaths.push(
          path.join(home, ".claude.json"),
          path.join(home, ".claude", "settings.json"),
          path.join(agent.cwd, ".claude.json"),
        );
      } else if (agent.provider === "codex") {
        candidatePaths.push(path.join(home, ".codex", "config.toml"));
      }

      for (const cp of candidatePaths) {
        const exists = existsSync(cp);
        if (exists) {
          try {
            const raw = await readFile(cp, "utf8");
            let parseInfo = "";
            try {
              if (cp.endsWith(".json")) {
                const parsed = JSON.parse(raw) as Record<string, unknown>;
                const mcp = (parsed.mcpServers ?? parsed["mcp-servers"] ?? {}) as Record<string, unknown>;
                const names = Object.keys(mcp);
                parseInfo = ` · Valid JSON (${names.length} server(s): ${names.join(", ") || "none"})`;
              } else if (cp.endsWith(".toml")) {
                const names = [...raw.matchAll(/^\s*\[mcp_servers\.([^\]\s]+)/gm)].map((m) => m[1]);
                parseInfo = ` · Valid TOML (${names.length} server(s): ${names.join(", ") || "none"})`;
              }
            } catch (syntaxErr) {
              parseInfo = ` · ⚠️ Syntax/Parse Warning: ${syntaxErr instanceof Error ? syntaxErr.message : String(syntaxErr)}`;
            }

            steps.push({
              target: cp,
              status: "found",
              details: `File exists (${raw.length} bytes)${parseInfo}`,
              contentPreview: redact(raw.slice(0, 1000)),
            });
          } catch (e) {
            steps.push({
              target: cp,
              status: "error",
              details: e instanceof Error ? e.message : String(e),
              contentPreview: null,
            });
          }
        } else {
          steps.push({
            target: cp,
            status: "missing",
            details: "File not found",
            contentPreview: null,
          });
        }
      }

      try {
        const result = await probe.probe({ agentId: input.agentId, provider: agent.provider, cwd: agent.cwd });
        discoveredServerCount = result.servers.length;
        if (result.error) probeError = result.error;
      } catch (e) {
        probeError = e instanceof Error ? e.message : String(e);
      }
    }

    return {
      provider: agent.provider,
      cwd: agent.cwd,
      probeId: probe?.id ?? null,
      probeLabel: probe?.label ?? null,
      steps,
      discoveredServerCount,
      error: probeError,
    };
  };
}
