import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { McpServer } from "./types.server";

export interface CandidatePath {
  path: string;
  label: string;
}

/**
 * Redacts tokens, keys, passwords, and sensitive auth data.
 */
export function redact(text: string): string {
  return text
    .replace(/"([^"]*(?:token|secret|key|password|auth)[^"]*)"\s*:\s*"[^"]*"/gi, '"$1": "•••"')
    .replace(/(token|secret|key|password|auth)=[^\s"']+/gi, "$1=•••");
}

/**
 * Universal JSON / JSONC / Trailing-comma tolerant parser.
 * Crucially preserves URLs containing "http://" or "https://".
 */
export function parseJsonc(raw: string): unknown | null {
  if (!raw || typeof raw !== "string") return null;

  // 1. Native fast parse
  try {
    return JSON.parse(raw);
  } catch {}

  // 2. Trailing comma stripping
  try {
    const withoutTrailingCommas = raw.replace(/,\s*([}\]])/g, "$1");
    return JSON.parse(withoutTrailingCommas);
  } catch {}

  // 3. Comment stripper (line by line, only if // is outside quotes)
  try {
    const lines = raw.split("\n").map((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("/*")) return "";
      return line;
    });
    return JSON.parse(lines.join("\n").replace(/,\s*([}\]])/g, "$1"));
  } catch {
    return null;
  }
}

/**
 * Heuristically finds the container holding MCP server definitions in arbitrary JSON.
 */
function findServersContainer(data: unknown): Record<string, unknown> | Array<unknown> | null {
  if (!data || typeof data !== "object") return null;

  if (Array.isArray(data)) {
    return data;
  }

  const obj = data as Record<string, unknown>;

  // Common root key heuristics across all ecosystem tools
  const candidateKeys = [
    "mcpServers",
    "mcp-servers",
    "mcp_servers",
    "servers",
    "mcp",
    "plugins",
  ];

  for (const key of candidateKeys) {
    if (key in obj && obj[key] && typeof obj[key] === "object") {
      return obj[key] as Record<string, unknown> | Array<unknown>;
    }
  }

  // Heuristic: Is the root object itself a map of servers?
  // Check if properties look like server definitions (have command, url, type, transport, args, or module)
  const entries = Object.entries(obj);
  if (entries.length > 0) {
    const looksLikeServers = entries.every(([_, val]) => {
      if (!val || typeof val !== "object" || Array.isArray(val)) return false;
      const v = val as Record<string, unknown>;
      return Boolean(v.command || v.url || v.type || v.transport || v.args || v.module || v.entrypoint);
    });
    if (looksLikeServers) {
      return obj;
    }
  }

  return null;
}

/**
 * Normalizes an arbitrary server definition entry into a standard McpServer.
 */
export function normalizeMcpServer(
  idPrefix: string,
  nameHint: string,
  defRaw: unknown,
  sourcePath: string,
  sourceLabel: string,
): McpServer | null {
  if (!defRaw || typeof defRaw !== "object" || Array.isArray(defRaw)) return null;
  const def = defRaw as Record<string, unknown>;

  // Check disabled heuristics
  if (def.disabled === true || def.enabled === false || def.active === false) {
    return null;
  }

  const name = typeof def.name === "string" && def.name.trim() ? def.name.trim() : nameHint;
  if (!name) return null;

  // Extract URL
  const url = typeof def.url === "string" ? def.url : typeof def.endpoint === "string" ? def.endpoint : null;

  // Extract command & args
  let command: string | null = null;
  if (typeof def.command === "string") {
    const args = Array.isArray(def.args) ? def.args.filter((a) => typeof a === "string").join(" ") : "";
    command = args ? `${def.command} ${args}` : def.command;
  } else if (typeof def.socket === "string") {
    command = def.socket;
  } else if (typeof def.module === "string") {
    command = `node ${def.module}`;
  }

  // Determine transport
  let transport: McpServer["transport"] = "unknown";
  if (url) {
    const isSse = def.type === "sse" || def.transport === "sse" || url.includes("/sse");
    transport = isSse ? "sse" : "http";
  } else if (command) {
    transport = "stdio";
  } else if (def.transport === "stdio" || def.transport === "http" || def.transport === "sse") {
    transport = def.transport;
  }

  // Detect secrets
  const hasSecrets = Boolean(
    def.env ||
    def.headers ||
    def.auth ||
    def.bearerToken ||
    def.apiKey ||
    def.token ||
    def.secret
  );

  // Description heuristic
  const description =
    (typeof def.description === "string" && def.description) ||
    url ||
    command ||
    "";

  return {
    id: `session:${idPrefix}:${name}`,
    name,
    transport,
    source: {
      kind: "session",
      label: sourceLabel,
      path: sourcePath,
    },
    command,
    url,
    description,
    hasSecrets,
    configPreview: redact(JSON.stringify(def, null, 2)),
  };
}

/**
 * Extracts all valid MCP servers from raw JSON/JSONC text using heuristics.
 */
export function extractMcpServersFromText(
  rawText: string,
  idPrefix: string,
  sourcePath: string,
  sourceLabel: string,
): McpServer[] {
  const parsed = parseJsonc(rawText);
  if (!parsed) return [];

  const container = findServersContainer(parsed);
  if (!container) return [];

  const servers: McpServer[] = [];

  if (Array.isArray(container)) {
    for (let i = 0; i < container.length; i++) {
      const item = container[i];
      const s = normalizeMcpServer(idPrefix, `server-${i + 1}`, item, sourcePath, sourceLabel);
      if (s) servers.push(s);
    }
  } else {
    for (const [name, item] of Object.entries(container)) {
      const s = normalizeMcpServer(idPrefix, name, item, sourcePath, sourceLabel);
      if (s) servers.push(s);
    }
  }

  return servers;
}

/**
 * Discovers MCP servers across multiple candidate paths with low -> high precedence merging.
 */
export async function discoverFromCandidates(
  idPrefix: string,
  candidates: CandidatePath[],
): Promise<{ servers: McpServer[]; error: string | null }> {
  const merged = new Map<string, { def: unknown; name: string; source: CandidatePath }>();

  for (const cand of candidates) {
    if (!existsSync(cand.path)) continue;
    try {
      const raw = await readFile(cand.path, "utf8");
      const parsed = parseJsonc(raw);
      if (!parsed) continue;

      const container = findServersContainer(parsed);
      if (!container) continue;

      if (Array.isArray(container)) {
        for (let i = 0; i < container.length; i++) {
          const item = container[i];
          const name = (item && typeof item === "object" && typeof (item as Record<string, unknown>).name === "string")
            ? (item as Record<string, unknown>).name as string
            : `server-${i + 1}`;
          merged.set(name, { def: item, name, source: cand });
        }
      } else {
        for (const [name, item] of Object.entries(container)) {
          merged.set(name, { def: item, name, source: cand });
        }
      }
    } catch {}
  }

  const servers: McpServer[] = [];
  for (const [_, { def, name, source }] of merged) {
    const s = normalizeMcpServer(idPrefix, name, def, source.path, source.label);
    if (s) servers.push(s);
  }

  return { servers, error: null };
}
