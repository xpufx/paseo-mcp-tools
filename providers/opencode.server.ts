import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import type { McpProbe, ProbeContext, McpServer } from "./types.server";

function redact(text: string): string {
  return text
    .replace(/"([^"]*(?:token|secret|key|password|auth)[^"]*)"\s*:\s*"[^"]*"/gi, '"$1": "•••"')
    .replace(/(token|secret|key|password|auth)=[^\s"']+/gi, "$1=•••");
}

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

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
    return new Promise((resolve) => {
      const child = spawn("opencode", ["mcp", "list"], {
        cwd: ctx.cwd,
        env: process.env,
        timeout: 5000,
      });
      let out = "";
      let err = "";
      child.stdout.on("data", (d) => (out += d.toString()));
      child.stderr.on("data", (d) => (err += d.toString()));
      child.on("error", (e) => resolve({ servers: [], error: e.message }));
      child.on("close", (code) => {
        if (code !== 0 && !out) {
          resolve({ servers: [], error: err || `opencode mcp list exited ${code}` });
          return;
        }
        try {
          const servers = parseOpencodeMcpList(out, cfgPath);
          resolve({ servers, error: null });
        } catch (e) {
          resolve({ servers: [], error: e instanceof Error ? e.message : String(e) });
        }
      });
      setTimeout(() => {
        try {
          child.kill();
        } catch {}
        resolve({ servers: [], error: "opencode mcp list timeout" });
      }, 5000);
    });
  },
};
