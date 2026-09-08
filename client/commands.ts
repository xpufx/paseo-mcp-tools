import type { PluginAgentCommandContext, PluginClientContext } from "@getpaseo/plugin/client";
import { buildHealthDigest } from "../shared/mcp";
import { callMcpTool, checkMcpHealth, listMcp } from "../shared/mcp";

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}... (truncated)`;
}

async function appendSlashResult(
  ctx: PluginAgentCommandContext,
  title: string,
  body: string,
): Promise<void> {
  await ctx.paseo.agents.ref(ctx.agent.id).timeline.append({
    type: "plugin",
    id: "mcp-slash",
    kind: "mcp-slash-result",
    version: 1,
    data: { title, body: truncate(body, 4000) },
  });
}

export function registerMcpCommands(client: PluginClientContext): () => void {
  const removers = [
    client.addSlashCommand({
      name: "mcp",
      description: "Probe servers, check health, or run an MCP tool",
      argumentHint: "[probe|health [server]|run server tool [json-args]]",
      context: "agent",
      async onSubmit(ctx) {
        const { args, agent, paseo, rpc } = ctx;
        const agentId = agent.id;
        const [sub, ...rest] = args.trim().split(/\s+/);
        try {
          if (!sub || sub === "probe") {
            const res = await rpc(listMcp, { agentId });
            await appendSlashResult(
              ctx,
              "MCP probe",
              `${res.servers.length} server(s) via ${res.provider}: ${res.servers.map((s) => s.name).join(", ") || "none"}`,
            );
            return;
          }
          if (sub === "health") {
            const filter = rest[0]?.toLowerCase();
            const res = await rpc(checkMcpHealth, { agentId });
            const rows = filter
              ? res.results.filter((r) => r.name.toLowerCase().includes(filter))
              : res.results;
            const counts = {
              healthy: rows.filter((r) => r.status === "healthy").length,
              degraded: rows.filter((r) => r.status === "degraded").length,
              down: rows.filter((r) => r.status === "down").length,
              total: rows.length,
            };
            await paseo.agents.ref(agentId).timeline.append({
              type: "plugin",
              id: "mcp-health",
              kind: "mcp-health-digest",
              version: 1,
              data: buildHealthDigest(counts),
            });
            return;
          }
          if (sub === "run") {
            const [serverRef, toolName, ...argParts] = rest;
            const list = await rpc(listMcp, { agentId });
            const server = list.servers.find((s) => s.id === serverRef || s.name === serverRef);
            if (!server || !toolName) {
              await appendSlashResult(ctx, "MCP run", "Usage: /mcp run <server> <tool> [json-args]");
              return;
            }
            let parsed: Record<string, unknown> = {};
            if (argParts.length > 0) {
              try {
                parsed = JSON.parse(argParts.join(" ")) as Record<string, unknown>;
              } catch {
                await appendSlashResult(ctx, "MCP run", "Arguments must be a JSON object.");
                return;
              }
            }
            const out = await rpc(callMcpTool, {
              agentId,
              serverId: server.id,
              toolName,
              arguments: parsed,
            });
            const text = out.content.map((c) => String((c as { text?: unknown }).text ?? JSON.stringify(c))).join("\n\n");
            await appendSlashResult(ctx, `MCP run ${toolName}`, out.isError ? `Error:\n${text}` : text || "(empty result)");
            return;
          }
          await appendSlashResult(ctx, "MCP", "Usage: /mcp [probe|health [server]|run server tool [json-args]]");
        } catch (e) {
          await appendSlashResult(ctx, "MCP error", e instanceof Error ? e.message : String(e));
        }
      },
    }),
    client.addCommandCenterItem({
      id: "reprobe-mcp",
      title: "Re-probe MCP servers",
      icon: "Plug",
      keywords: ["mcp", "refresh", "health"],
      context: "agent",
      async onSelect({ agent, rpc }) {
        await rpc(listMcp, { agentId: agent.id });
      },
    }),
  ];
  return () => {
    removers.forEach((remove) => remove());
  };
}
