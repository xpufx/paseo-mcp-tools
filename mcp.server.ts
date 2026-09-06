import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { McpServerSchema } from "./mcp.shared";
import { z } from "zod";
import { createPluginLogger, redactSecrets } from "paseo-plugin-helper/server";
import { probeForProvider } from "./providers";
import { paseo as paseoProbe, gateway as gatewayProbe } from "./providers/catalog";
import { PLUGIN_VERSION } from "./version";

export const log = createPluginLogger("mcp-tools");
// Direct source import. The helper MCP client has zero runtime deps,
// so no bundling step is needed for the daemon to resolve it.
import { checkMany, checkMcpServerHealth, callMcpServerTool } from "./health/health.server";

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
  return redactSecrets(text, { mask: "•••" });
}

function redactConfig(def: unknown): string {
  return JSON.stringify(redactSecrets(def, { mask: "•••" }), null, 2);
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

// Cache provider probe results keyed by `provider:cwd` to avoid redundant
// filesystem inspections and CLI process spawns when multiple agents share the same project/tool.
const PROBE_CACHE_TTL_MS = 60_000; // 1 minute TTL
const probeCache = new Map<string, { timestamp: number; result: { servers: McpServer[]; error: string | null } }>();

async function getCachedProviderProbe(agentId: string, provider: string, cwd: string, bypassCache = false) {
  const cacheKey = `${provider}:${cwd}`;
  const now = Date.now();
  const cached = probeCache.get(cacheKey);

  if (!bypassCache && cached && now - cached.timestamp < PROBE_CACHE_TTL_MS) {
    return cached.result;
  }

  const probe = probeForProvider(provider);
  if (!probe) {
    return { servers: [], error: null };
  }

  const res = await probe.probe({ agentId, provider, cwd });
  const result = { servers: res.servers, error: res.error ?? null };
  probeCache.set(cacheKey, { timestamp: now, result });
  return result;
}

/**
 * Live servers for THIS agent only.
 * 1) Paseo-injected `mcpServers` from StoredAgentRecord (session-scoped custom servers)
 * 2) Provider-specific live probe — cached by `provider:cwd` across concurrent agents
 */
export async function discoverLiveServers(
  agentId: string,
  context: PluginHandlerContext,
  options: { bypassCache?: boolean } = {},
): Promise<{ servers: McpServer[]; error: string | null }> {
  const agent = await loadAgent(agentId, context);
  const servers: McpServer[] = [];
  let error: string | null = null;

  try {
    const paseoRes = await paseoProbe.probe({ agentId, provider: "paseo", cwd: agent.cwd });
    for (const s of paseoRes.servers) {
      if (!servers.some((existing) => existing.id === s.id || existing.name === s.name)) {
        servers.push(s);
      }
    }

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
        configPreview: redactConfig(def),
      });
    }

    const probeResult = await getCachedProviderProbe(agentId, agent.provider, agent.cwd, options.bypassCache);
    for (const s of probeResult.servers) {
      if (servers.some((existing) => existing.name === s.name)) continue;
      servers.push(s);
    }
    if (probeResult.error) {
      error = probeResult.error;
      log.warn("Provider probe reported error", { provider: agent.provider, error });
    }
    log.info("Discovered live servers", { provider: agent.provider, count: servers.length });
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    log.error("Failed to discover live servers", { provider: agent.provider, error });
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
    let { servers } = await discoverLiveServers(input.agentId, context);
    if (input.serverId.startsWith("gateway:")) {
      try {
        const gwRes = await gatewayProbe.probe({ agentId: input.agentId, provider: "gateway", cwd: "" });
        servers = [...servers, ...gwRes.servers];
      } catch {}
    }
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
    let { servers, error } = await discoverLiveServers(input.agentId, context);
    if (input.serverId?.startsWith("gateway:")) {
      try {
        const gwRes = await gatewayProbe.probe({ agentId: input.agentId, provider: "gateway", cwd: "" });
        servers = [...servers, ...gwRes.servers];
      } catch {}
    }
    const targets = input.serverId ? servers.filter((s) => s.id === input.serverId) : servers;
    if (input.serverId && targets.length === 0) {
      throw new Error(`MCP server not found in this session: ${input.serverId}`);
    }
    const results = await checkMany(targets, { timeoutMs: 7000, includeTools: true });

    // Filter gateway sub-servers to only their specific tools
    const hubPort = process.env.MCP_GATEWAY_PORT || "37373";
    try {
      const gatewayHubRes = await fetch(`http://127.0.0.1:${hubPort}/api/servers`, { signal: AbortSignal.timeout(1200) });
      if (gatewayHubRes.ok) {
        const data = (await gatewayHubRes.json()) as {
          servers?: Array<{
            name: string;
            status?: string;
            error?: string;
            capabilities?: { tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }> };
          }>;
        };
        if (data?.servers) {
          const gatewayUpstreamMap = new Map<
            string,
            {
              status?: string;
              error?: string;
              tools: string[];
              toolDetails: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>;
            }
          >();
          for (const s of data.servers) {
            const rawTools = s.capabilities?.tools ?? [];
            gatewayUpstreamMap.set(s.name, {
              status: s.status,
              error: s.error,
              tools: rawTools.map((t) => t.name),
              toolDetails: rawTools.map((t) => ({
                name: t.name,
                description: t.description,
                inputSchema: t.inputSchema,
              })),
            });
          }

          for (const res of results) {
            const id = res.serverId;
            let subName: string | null = null;
            if (id.startsWith("gateway:") && id !== "gateway:hub") {
              subName = id.slice("gateway:".length);
            } else if (gatewayUpstreamMap.has(res.name) && res.tools && res.tools.length > 30) {
              subName = res.name;
            } else if (gatewayUpstreamMap.has(id) && res.tools && res.tools.length > 30) {
              subName = id;
            }

            if (subName) {
              const upstream = gatewayUpstreamMap.get(subName);
              if (upstream) {
                res.tools = upstream.tools;
                res.toolDetails = upstream.toolDetails;
                res.toolCount = upstream.tools.length;
                if (upstream.status === "disconnected" || upstream.error) {
                  res.status = "down";
                  if (upstream.error) res.error = upstream.error;
                } else if (upstream.status === "connecting") {
                  res.status = "unknown";
                } else if (upstream.status === "connected") {
                  res.status = "healthy";
                }
              } else {
                res.tools = [];
                res.toolDetails = [];
                res.toolCount = 0;
              }
            }
          }
        }
      }
    } catch {
      // Gateway offline or timed out
    }

    return { results, error };
  };
}

export function createCallMcpToolHandler() {
  return async (
    input: { agentId: string; serverId: string; toolName: string; arguments: Record<string, unknown> },
    context: PluginHandlerContext,
  ) => {
    let { servers } = await discoverLiveServers(input.agentId, context);
    if (input.serverId.startsWith("gateway:")) {
      try {
        const gwRes = await gatewayProbe.probe({ agentId: input.agentId, provider: "gateway", cwd: "" });
        servers = [...servers, ...gwRes.servers];
      } catch {}
    }
    const server = servers.find((s) => s.id === input.serverId);
    if (!server) {
      throw new Error(`MCP server not found in this session: ${input.serverId}`);
    }

    let targetServer = server;
    let targetToolName = input.toolName;
    const hubPort = process.env.MCP_GATEWAY_PORT || "37373";

    if (server.id.startsWith("gateway:")) {
      targetServer = {
        ...server,
        transport: "sse",
        url: `http://localhost:${hubPort}/mcp`,
      };
      if (server.id !== "gateway:hub") {
        const subName = server.id.slice("gateway:".length);
        const safeName = subName.replace(/[^a-zA-Z0-9]/g, "_");
        if (!targetToolName.startsWith(`${safeName}__`)) {
          targetToolName = `${safeName}__${targetToolName}`;
        }
      }
    }

    try {
      const result = await (callMcpServerTool as (s: McpServer, t: string, a: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text?: string; [key: string]: unknown }>; isError?: boolean }>)(
        targetServer,
        targetToolName,
        input.arguments,
      );
      return {
        content: result.content ?? [],
        isError: result.isError,
        error: null,
      };
    } catch (e) {
      return {
        content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }],
        isError: true,
        error: e instanceof Error ? e.message : String(e),
      };
    }
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
          contentPreview: redactConfig(cfg.mcpServers ?? {}),
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

    // 2. Run Provider Probe & Collect Diagnostic Steps Polymorphically
    const probe = probeForProvider(agent.provider);
    let discoveredServerCount = 0;
    let probeError: string | null = null;

    if (probe) {
      try {
        const result = await probe.probe({
          agentId: input.agentId,
          provider: agent.provider,
          cwd: agent.cwd,
          sessionId: (agent as Record<string, unknown>).sessionId as string | undefined,
        });
        discoveredServerCount = result.servers.length;
        if (result.error) probeError = result.error;
        if (result.steps && result.steps.length > 0) {
          steps.push(...result.steps);
        }
      } catch (e) {
        probeError = e instanceof Error ? e.message : String(e);
        steps.push({
          target: `Provider Probe (${probe.id})`,
          status: "error",
          details: probeError,
          contentPreview: null,
        });
      }
    } else {
      steps.push({
        target: `Provider Probe (${agent.provider})`,
        status: "missing",
        details: "No probe found matching this provider in registry",
        contentPreview: null,
      });
    }

    return {
      report: "Paseo Provider MCP Probe Diagnostic",
      version: PLUGIN_VERSION,
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

async function requestControl<T>(pathname: string, method = "GET", body?: unknown): Promise<T | null> {
  const controlPort = process.env.MCP_CONTROL_PORT || "37374";
  return new Promise((resolve) => {
    try {
      const dataStr = body ? JSON.stringify(body) : undefined;
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port: controlPort,
          path: pathname,
          method,
          headers: {
            "Content-Type": "application/json",
            ...(dataStr ? { "Content-Length": Buffer.byteLength(dataStr) } : {}),
          },
          timeout: 2500,
        },
        (res) => {
          let chunks = "";
          res.on("data", (c) => (chunks += c));
          res.on("end", () => {
            try {
              resolve(JSON.parse(chunks) as T);
            } catch {
              resolve(null);
            }
          });
        }
      );
      req.on("error", () => resolve(null));
      req.on("timeout", () => {
        req.destroy();
        resolve(null);
      });
      if (dataStr) req.write(dataStr);
      req.end();
    } catch {
      resolve(null);
    }
  });
}

export function createGatewayStatusHandler() {
  return async () => {
    const hubPort = parseInt(process.env.MCP_GATEWAY_PORT || "37373", 10);
    const controlPort = parseInt(process.env.MCP_CONTROL_PORT || "37374", 10);

    const res = await requestControl<{
      ok: boolean;
      online: boolean;
      controlPort: number;
      hubPort: number;
      configuredServersCount: number;
      activeUpstreamServersCount: number;
      upstreamServers: Array<{ name: string; status: string; transport?: string; toolsCount: number; uptime?: number }>;
      mcpEndpoint: string;
      eventsEndpoint: string;
    }>("/api/status");

    if (!res || !res.ok) {
      return {
        online: false,
        controlPort,
        hubPort,
        mcpEndpoint: `http://localhost:${hubPort}/mcp`,
        eventsEndpoint: `http://localhost:${hubPort}/api/events`,
        configuredServersCount: 0,
        activeUpstreamServersCount: 0,
        upstreamServers: [],
      };
    }

    return {
      online: res.online,
      controlPort: res.controlPort,
      hubPort: res.hubPort,
      mcpEndpoint: res.mcpEndpoint,
      eventsEndpoint: res.eventsEndpoint,
      configuredServersCount: res.configuredServersCount,
      activeUpstreamServersCount: res.activeUpstreamServersCount,
      upstreamServers: res.upstreamServers || [],
    };
  };
}

export function createGatewayAddServerHandler() {
  return async (input: { name: string; url?: string; command?: string; args?: string[] }) => {
    const res = await requestControl<{ ok: boolean; name: string; error?: string }>("/api/config/add", "POST", input);
    if (!res) {
      return { ok: false, name: input.name, error: "Gateway control plane unreachable on :37374" };
    }
    return { ok: res.ok, name: res.name || input.name, error: res.error || null };
  };
}

export function createGatewayRemoveServerHandler() {
  return async (input: { name: string }) => {
    const res = await requestControl<{ ok: boolean; name: string }>("/api/config/remove", "POST", input);
    if (!res) {
      return { ok: false, name: input.name };
    }
    return { ok: res.ok, name: res.name || input.name };
  };
}

export function createGatewayImportHostHandler() {
  return async () => {
    const res = await requestControl<{ ok: boolean; importedCount: number; totalServers: number }>("/api/config/import", "POST", {});
    if (!res) {
      return { ok: false, importedCount: 0, totalServers: 0 };
    }
    return { ok: res.ok, importedCount: res.importedCount || 0, totalServers: res.totalServers || 0 };
  };
}
