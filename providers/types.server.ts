import type { z } from "zod";
import type { McpServerSchema } from "../mcp.shared";

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
