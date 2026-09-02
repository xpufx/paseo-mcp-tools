import type { PluginContext } from "@getpaseo/plugin";
import { contributeClient } from "./pill.client";
import { createListMcpHandler, createReadMcpHandler, discoverLiveServers } from "./mcp.server";
import { checkMcpHealth, listMcp, readMcp } from "./mcp.shared";
import { checkMany, checkMcpServerHealth } from "./providers/health.server";

export default function contribute(plugin: PluginContext) {
  plugin.handle(listMcp, createListMcpHandler());
  plugin.handle(readMcp, createReadMcpHandler());
  plugin.handle(checkMcpHealth, async (input: { agentId: string; serverId?: string }, ctx) => {
    const { servers } = await discoverLiveServers(input.agentId, ctx as never);
    const targets = input.serverId ? servers.filter((s) => s.id === input.serverId || s.name === input.serverId) : servers;
    if (targets.length === 0) return { results: [], error: input.serverId ? `server not found: ${input.serverId}` : null };
    const results = targets.length === 1 ? [await checkMcpServerHealth(targets[0])] : await checkMany(targets);
    return { results, error: null };
  });
  plugin.addClientSide(contributeClient);
  return () => {};
}
