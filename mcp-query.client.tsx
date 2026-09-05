import { useRpcQuery, type RefreshRate } from "paseo-plugin-helper/client";
import { checkMcpHealth, listMcp } from "./mcp.shared";

export function useMcpQuery(agentId: string) {
  return useRpcQuery(listMcp, { agentId }, {
    staleTime: 0,
    gcTime: 5 * 60_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
  });
}

export function useMcpHealthQuery(
  agentId: string,
  serverId: string | undefined,
  opts: { isOpen?: boolean; rate?: RefreshRate } = {},
) {
  const { isOpen = true, rate = "5s" } = opts;
  const interval = !isOpen || rate === "paused"
    ? false
    : rate === "1s" ? 1000 : rate === "2s" ? 2000 : rate === "10s" ? 10_000 : 5000;
  return useRpcQuery(checkMcpHealth, { agentId, serverId }, {
    staleTime: 0,
    gcTime: 5 * 60_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    refetchInterval: interval,
    enabled: isOpen,
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
