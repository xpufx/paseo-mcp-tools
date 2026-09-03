import type { McpServer, DiagnosticStep } from "../mcp.shared";

export type { McpServer, DiagnosticStep };

export interface ProbeContext {
  agentId: string;
  provider: string;
  cwd: string;
  sessionId?: string | null;
}

export interface ProbeResult {
  servers: McpServer[];
  error?: string | null;
  steps?: DiagnosticStep[];
}

export interface McpProbe {
  id: string;
  label: string;
  matches(provider: string): boolean;
  probe(ctx: ProbeContext): Promise<ProbeResult>;
}
