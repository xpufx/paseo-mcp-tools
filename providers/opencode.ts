import os from "node:os";
import path from "node:path";
import { safeSpawn } from "paseo-plugin-helper/server";
import { stripAnsi } from "paseo-plugin-helper/shared";
import type { McpProbe, ProbeContext, McpServer } from "../discovery/types";
import { redact } from "../discovery/extract";

function parseOpencodeMcpList(output: string, cfgPath: string): McpServer[] {
  const clean = stripAnsi(output);
  const lines = clean.split("\n");
  const servers: McpServer[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const m = line.match(/^[●○•]\s*[✓✗○●]?\s*(\S+)\s+(connected|disabled|failed|connecting)?/);
    if (!m) continue;
    const name = m[1];
    const status = m[2] ?? "unknown";
    const next = lines[i + 1]?.trim().replace(/^│\s*/, "") ?? "";
    const isUrl = next.startsWith("http");
    const isDisabled = status === "disabled";
    if (isDisabled) continue;
    const url = isUrl ? next : null;
    const command = !isUrl && next ? next : null;
    const transport: McpServer["transport"] = url ? "http" : command ? "stdio" : "unknown";
    servers.push({
      id: `session:opencode:${name}`,
      name,
      transport,
      source: { kind: "session", label: "opencode · live", path: cfgPath },
      command,
      url,
      description: `${next} [${status}]`,
      hasSecrets: false,
      configPreview: redact(next),
    });
  }
  return servers;
}

export const opencodeProbe: McpProbe = {
  id: "opencode",
  label: "opencode · live",
  matches: (provider) => provider.startsWith("opencode"),
  async probe(ctx: ProbeContext) {
    const cfgPath = path.join(os.homedir(), ".config", "opencode", "opencode.jsonc");
    const target = "opencode mcp list (CLI)";
    let out: string;
    try {
      const res = await safeSpawn("opencode", ["mcp", "list"], { cwd: ctx.cwd, timeoutMs: 5000 });
      out = res.stdout;
      if (res.code !== 0 && !out) {
        const msg = res.stderr || `opencode mcp list exited ${res.code}`;
        return {
          servers: [],
          error: msg,
          steps: [{ target, status: "error" as const, details: msg, contentPreview: null }],
        };
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        servers: [],
        error: msg,
        steps: [{ target, status: "error" as const, details: msg, contentPreview: null }],
      };
    }
    try {
      const servers = parseOpencodeMcpList(out, cfgPath);
      return {
        servers,
        error: null,
        steps: [
          {
            target,
            status: "found" as const,
            details: `CLI returned ${servers.length} active server(s)`,
            contentPreview: redact(out.slice(0, 1000)),
          },
        ],
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        servers: [],
        error: msg,
        steps: [{ target, status: "error" as const, details: msg, contentPreview: redact(out.slice(0, 1000)) }],
      };
    }
  },
};

export default opencodeProbe;
