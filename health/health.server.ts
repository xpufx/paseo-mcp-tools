import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { McpServer } from "../providers/types.server";

// GTD: generic health check that works with *every* MCP.
// This is a CLIENT — we are not an MCP server, we just dial MCP servers.
// Runs on the Paseo daemon (Node, can spawn), no extra daemon needed.

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

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: NodeJS.Timeout;
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      t = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms);
    }),
  ]).finally(() => clearTimeout(t));
}

// Resolve transport from McpServer's command/url.
// For stdio we need env — but we redact in configPreview. For health we try
// without extra env first; Paseo's server already has process.env.
// If server has secrets, caller can pass resolved env via options later.
function transportFor(server: McpServer): { transport: InstanceType<typeof StdioClientTransport> | InstanceType<typeof SSEClientTransport> | InstanceType<typeof StreamableHTTPClientTransport>; kind: string } | null {
  if (server.url) {
    // Prefer StreamableHTTP, fallback to SSE inside SDK handles it.
    // SDK's StreamableHTTPClientTransport takes URL object.
    try {
      return {
        transport: new StreamableHTTPClientTransport(new URL(server.url)) as unknown as InstanceType<typeof StreamableHTTPClientTransport>,
        kind: "http",
      };
    } catch {
      return {
        transport: new SSEClientTransport(new URL(server.url)) as unknown as InstanceType<typeof SSEClientTransport>,
        kind: "sse",
      };
    }
  }
  if (server.command) {
    // command is e.g. "npx -y some-mcp" stored as string in mcp.server.ts
    // We need to split it — mcp.server.ts stores raw command string, not args.
    // Heuristic: first token is command, rest is args.
    const parts = server.command.trim().split(/\s+/);
    const command = parts[0];
    const args = parts.slice(1);
    return {
      transport: new StdioClientTransport({ command, args, env: process.env as Record<string, string> }) as unknown as InstanceType<typeof StdioClientTransport>,
      kind: "stdio",
    };
  }
  return null;
}

export async function checkMcpServerHealth(
  server: McpServer,
  opts: HealthCheckOptions = {},
): Promise<HealthResult> {
  const timeoutMs = opts.timeoutMs ?? 7000;
  const started = Date.now();
  const checkedAt = new Date().toISOString();

  const resolved = transportFor(server);
  if (!resolved) {
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

  const client = new Client({ name: "paseo-mcp-health", version: "1.0.0" }, { capabilities: {} });

  try {
    await withTimeout(client.connect(resolved.transport as never), timeoutMs, "connect");

    // Capture server instructions from initialize — free, no tool call needed.
    let instructions: string | null = null;
    try {
      const raw = (client as unknown as { getInstructions?: () => string | undefined }).getInstructions?.();
      if (typeof raw === "string" && raw.trim()) instructions = raw.trim();
    } catch {}

    // Healthy means we got initialize + tools/list. Degraded means connected but list failed.
    let tools: string[] | null = null;
    let toolDetails: ToolInfo[] | null = null;
    let toolCount: number | null = null;
    let status: HealthStatus = "healthy";
    let error: string | null = null;

    if (opts.includeTools !== false) {
      try {
        const res = await withTimeout(client.listTools(), timeoutMs, "listTools");
        const list = (res as { tools?: Array<{ name: string; description?: string; inputSchema?: ToolInfo["inputSchema"] }> }).tools ?? [];
        tools = list.map((t) => t.name);
        toolDetails = list.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        }));
        toolCount = tools.length;
      } catch (e) {
        // Connected but can't list tools = degraded
        status = "degraded";
        error = e instanceof Error ? e.message : String(e);
      }
    }

    const latencyMs = Date.now() - started;
    // Ensure clean close — transport close is best-effort.
    try {
      await client.close();
    } catch {}

    return {
      serverId: server.id,
      name: server.name,
      status,
      latencyMs,
      toolCount,
      tools,
      toolDetails,
      instructions,
      error,
      checkedAt,
    };
  } catch (e) {
    const latencyMs = Date.now() - started;
    try {
      await client.close();
    } catch {}
    return {
      serverId: server.id,
      name: server.name,
      status: "down",
      latencyMs,
      toolCount: null,
      tools: null,
      toolDetails: null,
      instructions: null,
      error: e instanceof Error ? e.message : String(e),
      checkedAt,
    };
  }
}

export async function callMcpServerTool(
  server: McpServer,
  toolName: string,
  args: Record<string, unknown> = {},
  timeoutMs = 15000,
): Promise<ToolCallResult> {
  const resolved = transportFor(server);
  if (!resolved) {
    throw new Error(`Cannot execute tool on ${server.name}: unknown transport`);
  }

  const client = new Client({ name: "paseo-mcp-runner", version: "1.0.0" }, { capabilities: {} });
  try {
    await withTimeout(client.connect(resolved.transport as never), timeoutMs, "connect");
    const result = await withTimeout(
      client.callTool({ name: toolName, arguments: args }),
      timeoutMs,
      `callTool:${toolName}`,
    );
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
