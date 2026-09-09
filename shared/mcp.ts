import { z } from "zod";
import { defineContract, defineSettingsContract } from "paseo-plugin-helper/shared";

export const McpSourceSchema = z.object({
  kind: z.enum(["project", "repo", "personal", "global", "paseo", "session"]),
  label: z.string(),
  path: z.string(),
});

export const McpServerSchema = z.object({
  id: z.string(),
  name: z.string(),
  transport: z.enum(["stdio", "http", "sse", "unknown"]),
  source: McpSourceSchema,
  command: z.string().nullable(),
  url: z.string().nullable(),
  description: z.string(),
  hasSecrets: z.boolean(),
  configPreview: z.string(),
});

export type McpServer = z.infer<typeof McpServerSchema>;

export const PaseoToolSchema = z.object({
  name: z.string(),
  description: z.string(),
  category: z.string(),
});

export const listMcp = defineContract({
  name: "mcp.list",
  description: "Lists live MCP servers for this agent session",
  input: z.object({ agentId: z.string() }),
  output: z.object({
    provider: z.string(),
    cwd: z.string().nullable(),
    servers: z.array(McpServerSchema),
    paseoTools: z.array(PaseoToolSchema),
    error: z.string().nullable(),
  }),
});

export const ToolPropertySchema = z.object({
  type: z.union([z.string(), z.array(z.string())]).optional(),
  description: z.string().optional(),
  default: z.any().optional(),
  enum: z.array(z.any()).optional(),
  items: z.any().optional(),
}).passthrough();

export const ToolInfoSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  inputSchema: z.object({
    type: z.string().optional(),
    properties: z.record(z.string(), ToolPropertySchema).optional(),
    required: z.array(z.string()).optional(),
  }).passthrough().optional(),
});

export type ToolInfo = z.infer<typeof ToolInfoSchema>;

export const HealthResultSchema = z.object({
  serverId: z.string(),
  name: z.string(),
  status: z.enum(["healthy", "degraded", "down", "unknown"]),
  latencyMs: z.number(),
  toolCount: z.number().nullable(),
  tools: z.array(z.string()).nullable(),
  toolDetails: z.array(ToolInfoSchema).nullable().optional(),
  instructions: z.string().nullable(),
  error: z.string().nullable(),
  checkedAt: z.string(),
});

export const checkMcpHealth = defineContract({
  name: "mcp.health",
  description: "Health-checks MCP servers via initialize + tools/list",
  input: z.object({ agentId: z.string(), serverId: z.string().optional() }),
  output: z.object({
    results: z.array(HealthResultSchema),
    error: z.string().nullable(),
  }),
});

// Compact health snapshot persisted to PluginStorage after each health
// check so other plugins can read fleet status without re-probing.
export interface McpStatusSnapshot {
  updatedAt: string; // ISO timestamp
  total: number;
  healthy: number;
  degraded: number;
  down: number;
  servers: Array<{
    name: string;
    status: "healthy" | "degraded" | "down" | "unknown";
    latencyMs: number;
  }>;
}

export const callMcpTool = defineContract({
  name: "mcp.call_tool",
  description: "Executes a tool on an MCP server",
  input: z.object({
    agentId: z.string(),
    serverId: z.string(),
    toolName: z.string(),
    arguments: z.record(z.string(), z.any()),
  }),
  output: z.object({
    content: z.array(z.any()),
    isError: z.boolean().optional(),
    error: z.string().nullable().optional(),
  }),
});

export const readMcp = defineContract({
  name: "mcp.read",
  description: "Reads redacted config detail for an MCP server",
  input: z.object({ agentId: z.string(), serverId: z.string() }),
  output: z.object({
    name: z.string(),
    transport: z.string(),
    source: McpSourceSchema,
    path: z.string(),
    raw: z.string(),
    redacted: z.string(),
  }),
});

export const DiagnosticStepSchema = z.object({
  target: z.string(),
  status: z.enum(["found", "missing", "error", "skipped"]),
  details: z.string(),
  contentPreview: z.string().nullable(),
});

export type DiagnosticStep = z.infer<typeof DiagnosticStepSchema>;

export const diagnoseMcp = defineContract({
  name: "mcp.diagnose",
  description: "Runs provider probe diagnostics for an agent",
  input: z.object({ agentId: z.string() }),
  output: z.object({
    report: z.string(),
    version: z.string(),
    provider: z.string(),
    cwd: z.string(),
    probeId: z.string().nullable(),
    probeLabel: z.string().nullable(),
    steps: z.array(DiagnosticStepSchema),
    discoveredServerCount: z.number(),
    error: z.string().nullable(),
  }),
});

export const McpToolsSettingsSchema = z.object({
  healthPollingRate: z.enum(["1s", "2s", "5s", "10s", "15s", "30s", "60s", "5m", "paused"]).default("30s"),
  healthDigestRows: z.boolean().default(false),
  gatewayInject: z.boolean().default(true),
  gatewayUrl: z.string().default("http://127.0.0.1:37374/mcp"),
  flairRadius: z.enum(["sharp", "rounded", "pill"]).default("rounded"),
  flairDensity: z.enum(["compact", "comfortable", "spacious"]).default("comfortable"),
  flairSurface: z.enum(["flat", "tinted", "elevated"]).default("flat"),
  flairAccentColor: z.string().default("#6366f1"),
});

export type McpToolsSettings = z.infer<typeof McpToolsSettingsSchema>;

export const mcpToolsSettingsContract = defineSettingsContract({
  name: "mcp-tools.settings",
  schema: McpToolsSettingsSchema,
  description: "mcp-tools cache, polling and visual flair settings",
});

// Short source label rendered on everything this plugin puts into
// shared Paseo surfaces, so plugin output is never mistaken for core.
export const PLUGIN_ATTRIBUTION = "via mcp-tools";

// Splits a gateway multiplexed tool name ("forgejo__list_branches")
// into its upstream server and tool. Returns null for bare names.
export function splitNamespacedTool(name: string): { server: string; tool: string } | null {
  const sep = name.indexOf("__");
  if (sep <= 0 || sep === name.length - 2) return null;
  return { server: name.slice(0, sep), tool: name.slice(sep + 2) };
}

export interface McpHealthDigestData {
  [key: string]: number | string;
  healthy: number;
  degraded: number;
  down: number;
  total: number;
  updatedAt: string;
}

// Builds the daemon health digest payload shared by the timeline row
// and the slash command verdict. Stable id lets replays replace it.
export function buildHealthDigest(snapshot: {
  healthy: number;
  degraded: number;
  down: number;
  total: number;
}): McpHealthDigestData {
  return { ...snapshot, updatedAt: new Date().toISOString() };
}
