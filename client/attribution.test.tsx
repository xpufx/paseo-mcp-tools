import type { PluginTheme } from "@getpaseo/plugin";
import { describe, expect, it, vi } from "vitest";
import { PLUGIN_ATTRIBUTION } from "../shared/mcp";
import {
  McpHealthDigestCard,
  McpSlashResultCard,
  McpToolCallCard,
  ViaMcpTools,
} from "./timeline";

vi.mock("react-native", () => ({
  View: "View",
  Text: "Text",
  Pressable: "Pressable",
}));

const theme = {
  colors: {
    foreground: "#000000",
    foregroundMuted: "#666666",
    statusDanger: "#ff0000",
    statusSuccess: "#00aa00",
  },
} as unknown as PluginTheme;

function expand(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(expand);
  if (node && typeof node === "object") {
    const element = node as { type?: unknown; props?: { children?: unknown } & Record<string, unknown> };
    if (typeof element.type === "function" && element.props) {
      return expand((element.type as (props: Record<string, unknown>) => unknown)(element.props));
    }
    if (element.props) {
      return { ...element, props: { ...element.props, children: expand(element.props.children) } };
    }
  }
  return node;
}

function expandedText(element: unknown): string {
  return JSON.stringify(expand(element));
}

const frame = {
  agentId: "test-agent",
  timestamp: new Date("2026-09-06T00:00:00.000Z"),
  theme,
  host: { id: "test-host", label: "Test Host" },
  layout: { compact: false, platform: "web" },
} as const;

describe("attribution labels on shared surfaces", () => {
  it("labels the via footer", () => {
    const element = ViaMcpTools({ colors: theme.colors });
    expect(expandedText(element)).toContain(PLUGIN_ATTRIBUTION);
    expect(element).toMatchSnapshot();
  });

  it("labels the MCP tool call card", () => {
    const element = McpToolCallCard({
      ...frame,
      item: {
        type: "plugin",
        kind: "mcp-tool-call",
        version: 1,
        data: { server: "forgejo", tool: "list_branches", status: "completed", phase: "complete" },
      },
    });
    expect(expandedText(element)).toContain(PLUGIN_ATTRIBUTION);
    expect(element).toMatchSnapshot();
  });

  it("labels the health digest card", () => {
    const element = McpHealthDigestCard({
      ...frame,
      item: {
        type: "plugin",
        kind: "mcp-health-digest",
        version: 1,
        data: { healthy: 3, degraded: 0, down: 1, total: 4, updatedAt: "2026-09-06T00:00:00.000Z" },
      },
    });
    expect(expandedText(element)).toContain(PLUGIN_ATTRIBUTION);
    expect(element).toMatchSnapshot();
  });

  it("labels the slash result card", () => {
    const element = McpSlashResultCard({
      ...frame,
      item: {
        type: "plugin",
        kind: "mcp-slash-result",
        version: 1,
        data: { title: "MCP probe", body: "4 servers" },
      },
    });
    expect(expandedText(element)).toContain(PLUGIN_ATTRIBUTION);
    expect(element).toMatchSnapshot();
  });
});
