import { z } from "zod";

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

export interface ProbeContext {
  agentId: string;
  provider: string;
  cwd: string;
  sessionId?: string | null;
}

export interface ProbeResult {
  servers: McpServer[];
  error?: string | null;
}

export interface McpProbe {
  id: string;
  label: string;
  matches(provider: string): boolean;
  probe(ctx: ProbeContext): Promise<ProbeResult>;
}
