import { McpClient } from "paseo-plugin-helper/mcp";
import { withTimeout } from "paseo-plugin-helper/shared";
import type { McpServer } from "../mcp.shared";

// GTD: generic health check that works with *every* MCP.
// This is a CLIENT — we are not an MCP server, we just dial MCP servers.
// Runs on the Paseo daemon (Node, can spawn), no extra daemon needed.
// All transports (stdio, HTTP, SSE) go through the zero-dependency
// helper McpClient — no @modelcontextprotocol/sdk required.

export type HealthStatus = "healthy" | "degraded" | "down" | "unknown";

export interface ToolInfo {
  name: string;
  description?: string;
  inputSchema?: {
    type?: string;
    properties?: Record<string, {
      type?: string;
      description?: string;
      default?: unknown;
      enum?: string[];
      items?: { type?: string };
    }>;
    required?: string[];
  };
}

export interface HealthResult {
  serverId: string;
  name: string;
  status: HealthStatus;
  latencyMs: number;
  toolCount: number | null;
  tools: string[] | null;
  toolDetails?: ToolInfo[] | null;
  instructions: string | null;
  error: string | null;
  checkedAt: string;
}

export interface ToolCallResult {
  content: Array<{ type: string; text?: string; [key: string]: unknown }>;
  isError?: boolean;
}

export interface HealthCheckOptions {
  timeoutMs?: number; // default 7000
  includeTools?: boolean; // default true (list_tools)
}

type HelperClient = ReturnType<typeof McpClient.forStdio> | ReturnType<typeof McpClient.forHttp>;

// command is e.g. "npx -y some-mcp" stored as string — first token is the
// executable, the rest are args.
function splitCommand(command: string): { command: string; args: string[] } {
  const parts = command.trim().split(/\s+/);
  return { command: parts[0], args: parts.slice(1) };
}

function dial(server: McpServer, timeoutMs: number): HelperClient | null {
  const clientInfo = { name: "paseo-mcp-health", version: "1.0.0" };
  if (server.url) {
    return McpClient.forHttp(server.url, { timeoutMs, clientInfo });
  }
  if (server.command) {
    const { command, args } = splitCommand(server.command);
    return McpClient.forStdio(command, args, undefined, { timeoutMs, clientInfo });
  }
  return null;
}

function readInstructions(client: HelperClient): string | null {
  const raw = client.instructions;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

function stderrOf(client: HelperClient): string | null {
  if ("getStderr" in client && typeof client.getStderr === "function") {
    try {
      const text = (client.getStderr as () => string)();
      return text?.trim() ? text : null;
    } catch {
      return null;
    }
  }
  return null;
}

function toToolDetails(list: Array<{ name: string; description?: string; inputSchema?: unknown }>): {
  tools: string[];
  toolDetails: ToolInfo[];
} {
  return {
    tools: list.map((t) => t.name),
    toolDetails: list.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema as ToolInfo["inputSchema"],
    })),
  };
}

export async function checkMcpServerHealth(
  server: McpServer,
  opts: HealthCheckOptions = {},
): Promise<HealthResult> {
  const timeoutMs = opts.timeoutMs ?? 7000;
  const started = Date.now();
  const checkedAt = new Date().toISOString();

  const client = dial(server, timeoutMs);
  if (!client) {
    return {
      serverId: server.id,
      name: server.name,
      status: "unknown",
      latencyMs: 0,
      toolCount: null,
      tools: null,
      instructions: null,
      error: "No command or url to dial — unknown transport",
      checkedAt,
    };
  }

  const down = (base: string, includeStderr: boolean): HealthResult => {
    const stderr = includeStderr ? stderrOf(client) : null;
    return {
      serverId: server.id,
      name: server.name,
      status: "down",
      latencyMs: Date.now() - started,
      toolCount: null,
      tools: null,
      toolDetails: null,
      instructions: null,
      error: stderr ? `${base}\nRecent stderr:\n${stderr}` : base,
      checkedAt,
    };
  };

  try {
    if (opts.includeTools !== false) {
      try {
        const list = await withTimeout(client.listTools(), timeoutMs, "listTools");
        const { tools, toolDetails } = toToolDetails(list);
        const result: HealthResult = {
          serverId: server.id,
          name: server.name,
          status: "healthy",
          latencyMs: Date.now() - started,
          toolCount: tools.length,
          tools,
          toolDetails,
          instructions: readInstructions(client),
          error: null,
          checkedAt,
        };
        try {
          await client.close();
        } catch {}
        return result;
      } catch (e) {
        // Connected but can't list tools = degraded. Verify reachability first.
        try {
          const ping = await withTimeout(client.ping(), timeoutMs, "ping");
          if (ping.healthy) {
            const result: HealthResult = {
              serverId: server.id,
              name: server.name,
              status: "degraded",
              latencyMs: Date.now() - started,
              toolCount: null,
              tools: null,
              toolDetails: null,
              instructions: readInstructions(client),
              error: e instanceof Error ? e.message : String(e),
              checkedAt,
            };
            try {
              await client.close();
            } catch {}
            return result;
          }
        } catch {}
        const result = down(e instanceof Error ? e.message : String(e), true);
        try {
          await client.close();
        } catch {}
        return result;
      }
    }

    const ping = await withTimeout(client.ping(), timeoutMs, "ping");
    const latencyMs = Date.now() - started;
    const result: HealthResult = ping.healthy
      ? {
        serverId: server.id,
        name: server.name,
        status: "healthy",
        latencyMs,
        toolCount: null,
        tools: null,
        toolDetails: null,
        instructions: readInstructions(client),
        error: null,
        checkedAt,
      }
      : {
        serverId: server.id,
        name: server.name,
        status: "down",
        latencyMs,
        toolCount: null,
        tools: null,
        toolDetails: null,
        instructions: null,
        error: ping.error ?? "ping failed",
        checkedAt,
      };
    try {
      await client.close();
    } catch {}
    return result;
  } catch (e) {
    const result = down(e instanceof Error ? e.message : String(e), true);
    try {
      await client.close();
    } catch {}
    return result;
  }
}

export async function callMcpServerTool(
  server: McpServer,
  toolName: string,
  args: Record<string, unknown> = {},
  timeoutMs = 15000,
): Promise<ToolCallResult> {
  const client = dial(server, timeoutMs);
  if (!client) {
    throw new Error(`Cannot execute tool on ${server.name}: unknown transport`);
  }
  try {
    const result = await withTimeout(client.callTool(toolName, args), timeoutMs, `callTool:${toolName}`);
    return result as ToolCallResult;
  } finally {
    try {
      await client.close();
    } catch {}
  }
}

// Batch helper — parallel with concurrency cap so we don't fork-bomb the daemon.
export async function checkMany(
  servers: McpServer[],
  opts: HealthCheckOptions & { concurrency?: number } = {},
): Promise<HealthResult[]> {
  const concurrency = opts.concurrency ?? 4;
  const out: HealthResult[] = [];
  for (let i = 0; i < servers.length; i += concurrency) {
    const chunk = servers.slice(i, i + concurrency);
    const results = await Promise.all(chunk.map((s) => checkMcpServerHealth(s, opts)));
    out.push(...results);
  }
  return out;
}
