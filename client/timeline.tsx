import type { PluginClientContext, PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Text, View } from "react-native";
import { z } from "zod";
import { PLUGIN_ATTRIBUTION, splitNamespacedTool } from "../shared/mcp";
import type { PluginTheme } from "@getpaseo/plugin";

export function ViaMcpTools({ colors }: { colors: PluginTheme["colors"] }) {
  return (
    <Text style={{ color: colors.foregroundMuted, fontSize: 10 }}>
      {PLUGIN_ATTRIBUTION}
    </Text>
  );
}

export const McpToolCallCardSchema = z.object({
  server: z.string(),
  tool: z.string(),
  status: z.string(),
  phase: z.enum(["streaming", "complete"]),
});

export type McpToolCallCardData = z.infer<typeof McpToolCallCardSchema>;

export const McpHealthDigestCardSchema = z.object({
  healthy: z.number(),
  degraded: z.number(),
  down: z.number(),
  total: z.number(),
  updatedAt: z.string(),
});

export type McpHealthDigestCardData = z.infer<typeof McpHealthDigestCardSchema>;

export const McpSlashResultCardSchema = z.object({
  title: z.string(),
  body: z.string(),
});

export type McpSlashResultCardData = z.infer<typeof McpSlashResultCardSchema>;

export function McpToolCallCard({ item, theme }: PluginTimelineItemProps<McpToolCallCardData>) {
  const dot =
    item.data.status === "failed"
      ? theme.colors.statusDanger
      : item.data.status === "completed"
        ? theme.colors.statusSuccess
        : theme.colors.foregroundMuted;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <Text style={{ color: dot, fontSize: 13 }}>{"\u25CF"}</Text>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "600", fontFamily: "monospace" }}>
          {item.data.server}{"__"}{item.data.tool}
        </Text>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
          MCP tool call {item.data.status}{item.data.phase === "streaming" ? " (running)" : ""}
        </Text>
        <ViaMcpTools colors={theme.colors} />
      </View>
    </View>
  );
}

export function McpHealthDigestCard({ item, theme }: PluginTimelineItemProps<McpHealthDigestCardData>) {
  const d = item.data;
  const summary = `${d.healthy} healthy / ${d.degraded} degraded / ${d.down} down of ${d.total}`;
  return (
    <View style={{ gap: 2 }}>
      <Text style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "600" }}>
        MCP fleet health: {summary}
      </Text>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
        Checked {d.updatedAt}
      </Text>
      <ViaMcpTools colors={theme.colors} />
    </View>
  );
}

export function McpSlashResultCard({ item, theme }: PluginTimelineItemProps<McpSlashResultCardData>) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "600" }}>
        {item.data.title}
      </Text>
      <Text selectable style={{ color: theme.colors.foreground, fontSize: 12, fontFamily: "monospace" }}>
        {item.data.body}
      </Text>
      <ViaMcpTools colors={theme.colors} />
    </View>
  );
}

export function registerMcpTimeline(client: PluginClientContext): () => void {
  const removers = [
    client.addTimelineTransformer({
      id: "mcp-tool",
      query: { itemType: "tool_call" },
      transform({ item, phase }) {
        const split = splitNamespacedTool(item.name);
        if (!split) return undefined;
        return {
          items: [
            {
              type: "plugin",
              kind: "mcp-tool-call",
              version: 1,
              data: { server: split.server, tool: split.tool, status: item.status, phase },
            },
          ],
        };
      },
    }),
    client.addTimelineRenderer({
      kind: "mcp-tool-call",
      version: 1,
      schema: McpToolCallCardSchema,
      Component: McpToolCallCard,
    }),
    client.addTimelineRenderer({
      kind: "mcp-health-digest",
      version: 1,
      schema: McpHealthDigestCardSchema,
      Component: McpHealthDigestCard,
    }),
    client.addTimelineRenderer({
      kind: "mcp-slash-result",
      version: 1,
      schema: McpSlashResultCardSchema,
      Component: McpSlashResultCard,
    }),
  ];
  return () => {
    removers.forEach((remove) => remove());
  };
}
