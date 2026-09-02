import { describe, expect, it } from "vitest";
import { checkMcpServerHealth } from "./health.server";
import type { McpServer } from "./types.server";

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
});
