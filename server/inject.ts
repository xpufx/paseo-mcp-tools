import type { AgentSessionConfig } from "@getpaseo/protocol/agent-types";

export const GATEWAY_SERVER_NAME = "gateway";

export interface GatewayInjectOptions {
  enabled: boolean;
  url: string;
}

type CreateRequest = { config: AgentSessionConfig; env?: Record<string, string> };

// Returns a modified agent.create request with the gateway MCP server
// injected, or undefined to keep the caller's request unchanged.
export function injectGatewayIntoCreateRequest(
  request: CreateRequest,
  opts: GatewayInjectOptions,
): CreateRequest | undefined {
  if (!opts.enabled) return undefined;
  if (!opts.url) return undefined;
  const mcpServers = request.config.mcpServers ?? {};
  if (mcpServers[GATEWAY_SERVER_NAME]) return undefined;
  return {
    ...request,
    config: {
      ...request.config,
      mcpServers: {
        ...mcpServers,
        [GATEWAY_SERVER_NAME]: { type: "http", url: opts.url },
      },
    },
  };
}
