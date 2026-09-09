import { describe, expect, it } from "vitest";
import { checkMcpServerHealth } from "./health";
import type { McpServer } from "../../shared/mcp";

describe("generic health client — works with every MCP without being a server", () => {
  it("returns unknown for unknown transport", async () => {
    const s: McpServer = {
      id: "test:unknown",
      name: "unknown",
      transport: "unknown",
      source: { kind: "session", label: "test", path: "/tmp" },
      command: null,
      url: null,
      description: "no transport",
      hasSecrets: false,
      configPreview: "{}",
    };
    const r = await checkMcpServerHealth(s, { timeoutMs: 1000, includeTools: false });
    expect(r.status).toBe("unknown");
    expect(r.error).toMatch(/No command or url/);
  });

  it("returns down for bogus stdio command (proves it actually dials)", async () => {
    const s: McpServer = {
      id: "test:bogus",
      name: "bogus",
      transport: "stdio",
      source: { kind: "session", label: "test", path: "/tmp" },
      command: "this-command-does-not-exist-xyz",
      url: null,
      description: "bogus",
      hasSecrets: false,
      configPreview: "{}",
    };
    const r = await checkMcpServerHealth(s, { timeoutMs: 1500, includeTools: false });
    expect(r.status).toBe("down");
    expect(r.error).toBeTruthy();
    expect(r.latencyMs).toBeGreaterThan(0);
  });

  it("health-checks a stdio server defined as command plus separate args", async () => {
    const script = [
      'const readline = require("node:readline");',
      "const rl = readline.createInterface({ input: process.stdin });",
      'rl.on("line", (line) => {',
      "  let msg;",
      "  try { msg = JSON.parse(line); } catch { return; }",
      '  if (msg.method && msg.method.startsWith("notifications/")) return;',
      "  let result = {};",
      '  if (msg.method === "initialize") result = { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "test-stdio-args" } };',
      '  else if (msg.method === "tools/list") result = { tools: [{ name: "echo", description: "echo tool" }] };',
      "  if (msg.id !== undefined) console.log(JSON.stringify({ jsonrpc: \"2.0\", id: msg.id, result }));",
      "});",
    ].join("\n");
    const s: McpServer = {
      id: "test:args",
      name: "args",
      transport: "stdio",
      source: { kind: "session", label: "test", path: "/tmp" },
      command: "node",
      args: ["-e", script],
      url: null,
      description: "command plus args",
      hasSecrets: false,
      configPreview: "{}",
    };
    const r = await checkMcpServerHealth(s, { timeoutMs: 10000 });
    expect(r.status).toBe("healthy");
    expect(r.tools).toContain("echo");
  }, 15000);

  it("callMcpServerTool throws gracefully on unknown transport", async () => {    const { callMcpServerTool } = await import("./health");
    const s: McpServer = {
      id: "test:unknown",
      name: "unknown",
      transport: "unknown",
      source: { kind: "session", label: "test", path: "/tmp" },
      command: null,
      url: null,
      description: "no transport",
      hasSecrets: false,
      configPreview: "{}",
    };
    await expect(callMcpServerTool(s, "any_tool", {})).rejects.toThrow(/unknown transport/);
  });
});
