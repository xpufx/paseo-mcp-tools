import { REFRESH_INTERVALS, useRpcQuery, type RefreshRate } from "paseo-plugin-helper/client";
import { checkMcpHealth, listMcp } from "../shared/mcp";

export function useMcpQuery(agentId: string) {
  return useRpcQuery(listMcp, { agentId }, {
    staleTime: 0,
    gcTime: 5 * 60_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    enabled: Boolean(agentId),
  });
}

export function useMcpHealthQuery(
  agentId: string,
  serverId: string | undefined,
  opts: { isOpen?: boolean; rate?: RefreshRate } = {},
) {
  const { isOpen = true, rate = "30s" } = opts;
  const interval = !isOpen ? false : (REFRESH_INTERVALS[rate] ?? false);
  return useRpcQuery(checkMcpHealth, { agentId, serverId }, {
    staleTime: 0,
    gcTime: 5 * 60_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    refetchInterval: interval,
    enabled: isOpen && Boolean(agentId),
  });
}

export function countServers(data: { servers: Array<unknown>; paseoTools: Array<unknown> } | undefined): number {
  if (!data) return 0;
  return data.servers.length + data.paseoTools.length;
}

export function countMcpOnly(data: { servers: Array<unknown> } | undefined): number {
  if (!data) return 0;
  return data.servers.length;
}
