import { z, type ZodType } from "zod";

export interface PluginRpcContract<
  InputSchema extends ZodType = ZodType,
  OutputSchema extends ZodType = ZodType,
> {
  name: string;
  input: InputSchema;
  output: OutputSchema;
}

export function defineRpc<InputSchema extends ZodType, OutputSchema extends ZodType>(definition: {
  name: string;
  input: InputSchema;
  output: OutputSchema;
}): PluginRpcContract<InputSchema, OutputSchema> {
  return definition;
}

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

export const listMcp = defineRpc({
  name: "mcp.list",
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
  type: z.string().optional(),
  description: z.string().optional(),
  default: z.any().optional(),
  enum: z.array(z.string()).optional(),
  items: z.object({ type: z.string().optional() }).optional(),
});

export const ToolInfoSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  inputSchema: z.object({
    type: z.string().optional(),
    properties: z.record(z.string(), ToolPropertySchema).optional(),
    required: z.array(z.string()).optional(),
  }).optional(),
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

export const checkMcpHealth = defineRpc({
  name: "mcp.health",
  input: z.object({ agentId: z.string(), serverId: z.string().optional() }),
  output: z.object({
    results: z.array(HealthResultSchema),
    error: z.string().nullable(),
  }),
});

export const callMcpTool = defineRpc({
  name: "mcp.call_tool",
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

export const readMcp = defineRpc({
  name: "mcp.read",
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

export const diagnoseMcp = defineRpc({
  name: "mcp.diagnose",
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
