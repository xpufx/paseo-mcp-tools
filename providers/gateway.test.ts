import { describe, expect, it } from "vitest";
import { gatewayProbe } from "./gateway";
import { McpServerSchema } from "../mcp.shared";
import { createGatewayStatusHandler } from "../mcp.server";

describe("MCP Gateway Fleet Probe & Control", () => {
  it("matches gateway and hub identifiers", () => {
    expect(gatewayProbe.matches("gateway")).toBe(true);
    expect(gatewayProbe.matches("mcp-hub")).toBe(true);
    expect(gatewayProbe.matches("hub")).toBe(true);
    expect(gatewayProbe.matches("random-provider")).toBe(false);
  });

  it("probes live gateway and produces valid schema-compliant McpServer definitions", async () => {
    const result = await gatewayProbe.probe({
      agentId: "test-agent",
      provider: "gateway",
      cwd: process.cwd(),
    });

    expect(result).toBeDefined();
    expect(Array.isArray(result.servers)).toBe(true);

    // If gateway is online, assert on its servers
    if (result.servers.length > 0) {
      const hubServer = result.servers.find((s) => s.id === "gateway:hub");
      expect(hubServer).toBeDefined();
      expect(hubServer?.transport).toBe("sse");
      expect(hubServer?.url).toContain("/mcp");

      // Verify each server strictly satisfies McpServerSchema
      for (const s of result.servers) {
        const parsed = McpServerSchema.safeParse(s);
        if (!parsed.success) {
          console.error("Invalid Gateway server returned:", parsed.error.format());
        }
        expect(parsed.success).toBe(true);
      }
    }
  });

  it("handles gateway status RPC gracefully", async () => {
    const handler = createGatewayStatusHandler();
    const status = await handler();

    expect(status).toBeDefined();
    expect(typeof status.online).toBe("boolean");
    expect(typeof status.hubPort).toBe("number");
    expect(typeof status.controlPort).toBe("number");
    expect(typeof status.mcpEndpoint).toBe("string");
    expect(Array.isArray(status.upstreamServers)).toBe(true);
  });

  it("filters tools for gateway sub-servers without returning the entire fleet list", async () => {
    // Check createHealthHandler tool filtering on gateway sub-server
    const hubPort = process.env.MCP_GATEWAY_PORT || "37373";
    const res = await fetch(`http://127.0.0.1:${hubPort}/api/servers`);
    if (res.ok) {
      const data = await res.json() as { servers: Array<{ name: string; capabilities?: { tools?: Array<{ name: string }> } }> };
      const deepwiki = data.servers.find((s) => s.name === "deepwiki");
      expect(deepwiki).toBeDefined();
      expect(deepwiki?.capabilities?.tools?.length).toBe(3);
      expect(deepwiki?.capabilities?.tools?.map((t) => t.name)).toContain("ask_question");

      const ddgSearch = data.servers.find((s) => s.name === "ddg-search");
      expect(ddgSearch).toBeDefined();
      expect(ddgSearch?.capabilities?.tools?.length).toBe(2);
      expect(ddgSearch?.capabilities?.tools?.map((t) => t.name)).toEqual(["search", "fetch_content"]);
    }
  });
});
