import { defineRpc } from "@getpaseo/plugin/server";
import { z } from "zod";
import { McpServerSchema, McpSourceSchema } from "./providers/types.server";

export { McpSourceSchema, McpServerSchema };

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

export const HealthResultSchema = z.object({
  serverId: z.string(),
  name: z.string(),
  status: z.enum(["healthy", "degraded", "down", "unknown"]),
  latencyMs: z.number(),
  toolCount: z.number().nullable(),
  tools: z.array(z.string()).nullable(),
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
