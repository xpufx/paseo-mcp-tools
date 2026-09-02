import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { McpServerSchema } from "./mcp.shared";
import { z } from "zod";
import { probeForProvider } from "./providers/registry.server";
import { checkMany, checkMcpServerHealth } from "./providers/health.server";

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
