import { describe, expect, it } from "vitest";
import { extractMcpServersFromText, parseJsonc } from "./extract";
import { McpServerSchema } from "../mcp.shared";

describe("Universal MCP Extractor Heuristics", () => {
  it("extracts from standard Pi config format without hints", () => {
    const rawPi = `{
      // Pi user config
      "mcpServers": {
        "deepwiki": {
          "url": "https://mcp.deepwiki.com/mcp",
          "protocolVersion": "auto"
        },
        "disabled-server": {
          "command": "bad",
          "disabled": true
        }
      }
    }`;

    const servers = extractMcpServersFromText(rawPi, "pi", "~/.pi/.mcp.json", "pi · user config");
    expect(servers.length).toBe(1);
    expect(servers[0].name).toBe("deepwiki");
    expect(servers[0].transport).toBe("http");
    expect(servers[0].url).toBe("https://mcp.deepwiki.com/mcp");
    expect(McpServerSchema.safeParse(servers[0]).success).toBe(true);
  });

  it("extracts from OpenCode opencode.json format without hints", () => {
    const rawOpenCode = `{
      "$schema": "https://opencode.ai/schema.json",
      "mcp": {
        "memory": {
          "type": "stdio",
          "command": "npx",
          "args": ["-y", "@modelcontextprotocol/server-memory"]
        },
        "remote-search": {
          "type": "sse",
          "url": "https://search.example.com/sse",
          "headers": {
            "Authorization": "Bearer secret-token-xyz"
          }
        }
      }
    }`;

    const servers = extractMcpServersFromText(rawOpenCode, "opencode", "opencode.json", "opencode · config");
    expect(servers.length).toBe(2);

    const mem = servers.find((s) => s.name === "memory")!;
    expect(mem).toBeDefined();
    expect(mem.transport).toBe("stdio");
    expect(mem.command).toBe("npx -y @modelcontextprotocol/server-memory");

    const search = servers.find((s) => s.name === "remote-search")!;
    expect(search).toBeDefined();
    expect(search.transport).toBe("sse");
    expect(search.hasSecrets).toBe(true);
    expect(search.configPreview).toContain("•••");

    for (const s of servers) {
      expect(McpServerSchema.safeParse(s).success).toBe(true);
    }
  });

  it("extracts from array-based server lists without hints", () => {
    const rawArray = `{
      "servers": [
        {
          "name": "sqlite-db",
          "command": "uvx",
          "args": ["mcp-server-sqlite", "--db-path", "/data/app.db"]
        }
      ]
    }`;

    const servers = extractMcpServersFromText(rawArray, "custom", "config.json", "custom · list");
    expect(servers.length).toBe(1);
    expect(servers[0].name).toBe("sqlite-db");
    expect(servers[0].transport).toBe("stdio");
    expect(servers[0].command).toBe("uvx mcp-server-sqlite --db-path /data/app.db");
    expect(McpServerSchema.safeParse(servers[0]).success).toBe(true);
  });

  it("extracts from root-level dictionary of servers", () => {
    const rawRoot = `{
      "github": {
        "command": "npx -y @modelcontextprotocol/server-github",
        "env": {
          "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_123456"
        }
      }
    }`;

    const servers = extractMcpServersFromText(rawRoot, "root", "root.json", "root · direct");
    expect(servers.length).toBe(1);
    expect(servers[0].name).toBe("github");
    expect(servers[0].hasSecrets).toBe(true);
    expect(McpServerSchema.safeParse(servers[0]).success).toBe(true);
  });

  it("survives invalid json / empty text gracefully", () => {
    expect(extractMcpServersFromText("", "test", "path", "label")).toEqual([]);
    expect(extractMcpServersFromText("{ not json", "test", "path", "label")).toEqual([]);
    expect(extractMcpServersFromText("{}", "test", "path", "label")).toEqual([]);
  });
});

import claudeProbe from "../providers/claude";
import antigravityProbe from "../providers/antigravity";

describe("Live Local Filesystem Verification", () => {
  it("extracts real ~/.claude.json on this machine", async () => {
    const res = await claudeProbe.probe({
      agentId: "live-test",
      provider: "claude",
      cwd: process.cwd(),
    });
    console.log(`\n=== REAL CLAUDE CONFIG EXTRACTED: ${res.servers.length} SERVERS ===`);
    for (const s of res.servers) {
      console.log(`  - [${s.transport.toUpperCase()}] ${s.name} -> ${s.command || s.url} (hasSecrets: ${s.hasSecrets})`);
    }
    expect(res.servers.length).toBeGreaterThan(0);
  });

  it("extracts real Antigravity ~/.gemini/config/mcp_config.json on this machine", async () => {
    const res = await antigravityProbe.probe({
      agentId: "live-test-antigravity",
      provider: "antigravity-acp",
      cwd: process.cwd(),
    });
    console.log(`\n=== REAL ANTIGRAVITY CONFIG EXTRACTED: ${res.servers.length} SERVERS ===`);
    for (const s of res.servers) {
      console.log(`  - [${s.transport.toUpperCase()}] ${s.name} -> ${s.command || s.url} (hasSecrets: ${s.hasSecrets})`);
    }
    expect(res.servers.length).toBe(4);
    const names = res.servers.map((s) => s.name).sort();
    expect(names).toEqual(["chrome-devtools-local", "deepwiki", "forgejo", "paseo-x-comms"]);
  });
});
