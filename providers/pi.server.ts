import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { McpProbe, McpServer, ProbeContext } from "./types.server";

function redact(text: string): string {
  return text
    .replace(/"([^"]*(?:token|secret|key|password|auth)[^"]*)"\s*:\s*"[^"]*"/gi, '"$1": "•••"')
    .replace(/(token|secret|key|password|auth)=[^\s"']+/gi, "$1=•••");
}

function stripComments(s: string): string {
  // minimal — pi allows trailing commas & comments via strip-json-comments but we survive without it
  return s.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

async function readServers(filePath: string): Promise<Record<string, unknown>> {
  if (!existsSync(filePath)) return {};
  try {
    const raw = stripComments(await readFile(filePath, "utf8"));
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const mcp = (parsed.mcpServers ?? parsed["mcp-servers"] ?? {}) as Record<string, unknown>;
    if (!mcp || typeof mcp !== "object" || Array.isArray(mcp)) return {};
    return mcp;
  } catch {
    return {};
  }
}

function toMcpServer(name: string, defRaw: unknown, sourcePath: string, sourceLabel: string): McpServer | null {
  if (!defRaw || typeof defRaw !== "object") return null;
  const def = defRaw as Record<string, unknown>;
  if (def.disabled === true) return null;
  const url = typeof def.url === "string" ? def.url : null;
  const command = typeof def.command === "string" ? def.command : null;
  const socket = typeof def.socket === "string" ? def.socket : null;
  return {
    id: `session:pi:${name}`,
    name,
    transport: url ? "http" : command || socket ? "stdio" : "unknown",
    source: { kind: "session", label: sourceLabel, path: sourcePath },
    command: command ?? socket,
    url,
    description: url ?? command ?? socket ?? "",
    hasSecrets: Boolean(def.env || def.headers || def.bearerToken || def.auth),
    configPreview: redact(JSON.stringify(def, null, 2)),
  };
}

export const piProbe: McpProbe = {
  id: "pi",
  label: "pi · live",
  matches: (provider) => provider === "pi",
  async probe(ctx: ProbeContext) {
    const home = os.homedir();
    const agentDir = process.env.PI_CODING_AGENT_DIR?.trim()
      ? path.resolve(process.env.PI_CODING_AGENT_DIR.trim().replace(/^~\//, `${home}/`))
      : path.join(home, ".pi", "agent");

    // Precedence low -> high (later wins), same as pi-mcp-adapter README
    const candidates: Array<{ path: string; label: string }> = [
      { path: path.join(home, ".config", "mcp", "mcp.json"), label: "pi · global shared" },
      { path: path.join(home, ".agents", "mcp.json"), label: "pi · agents global" },
      { path: path.join(home, ".agents", "mcp", "mcp.json"), label: "pi · agents nested" },
      { path: path.join(agentDir, "mcp.json"), label: "pi · global override" },
      { path: path.join(ctx.cwd, ".mcp.json"), label: "pi · project shared" },
      { path: path.join(ctx.cwd, ".pi", "mcp.json"), label: "pi · project override" },
    ];

    const merged = new Map<string, { def: unknown; source: (typeof candidates)[number] }>();
    for (const cand of candidates) {
      const servers = await readServers(cand.path);
      for (const [name, def] of Object.entries(servers)) {
        merged.set(name, { def, source: cand });
      }
    }

    const servers: McpServer[] = [];
    for (const [name, { def, source }] of merged) {
      const s = toMcpServer(name, def, source.path, source.label);
      if (s) servers.push(s);
    }

    return { servers, error: null };
  },
};
