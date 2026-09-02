import { useQuery } from "@tanstack/react-query";
import { useRpc } from "@getpaseo/plugin";
import { listMcp } from "./mcp.shared";

export function useMcpQuery(agentId: string) {
  const callList = useRpc(listMcp);
  return useQuery({
    queryKey: ["mcp", agentId],
    queryFn: () => callList({ agentId }),
    staleTime: 30 * 60_000,
    gcTime: 35 * 60_000,
    refetchInterval: 30 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
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
