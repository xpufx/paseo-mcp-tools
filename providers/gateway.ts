import http from "node:http";
import type { McpProbe, ProbeContext, ProbeResult, DiagnosticStep } from "../discovery/types";
import type { McpServer } from "../mcp.shared";

interface UpstreamServerItem {
  name: string;
  status: string;
  transportType?: string;
  command?: string;
  serverUrl?: string;
  config_source?: string;
  capabilities?: {
    tools?: Array<{ name: string; description?: string }>;
  };
  uptime?: number;
}

interface HubResponse {
  servers?: UpstreamServerItem[];
}

function fetchJson<T>(urlStr: string, timeoutMs = 800): Promise<T | null> {
  return new Promise((resolve) => {
    try {
      const url = new URL(urlStr);
      const req = http.get(
        {
          hostname: url.hostname,
          port: url.port,
          path: url.pathname,
          timeout: timeoutMs,
        },
        (res) => {
          if (res.statusCode !== 200) {
            resolve(null);
            return;
          }
          let body = "";
          res.on("data", (chunk) => {
            body += chunk;
          });
          res.on("end", () => {
            try {
              resolve(JSON.parse(body) as T);
            } catch {
              resolve(null);
            }
          });
        }
      );
      req.on("error", () => resolve(null));
      req.on("timeout", () => {
        req.destroy();
        resolve(null);
      });
    } catch {
      resolve(null);
    }
  });
}

export const gatewayProbe: McpProbe = {
  id: "gateway",
  label: "MCP Gateway · Fleet",
  matches: (provider) => provider === "gateway" || provider === "mcp-hub" || provider === "hub",
  async probe(_ctx: ProbeContext): Promise<ProbeResult> {
    const steps: DiagnosticStep[] = [];
    const servers: McpServer[] = [];

    const hubPort = process.env.MCP_GATEWAY_PORT || "37373";
    const controlPort = process.env.MCP_CONTROL_PORT || "37374";

    // 1. Probe Gateway API
    const hubData = await fetchJson<HubResponse>(`http://127.0.0.1:${hubPort}/api/servers`, 1200);

    if (!hubData || !Array.isArray(hubData.servers)) {
      steps.push({
        target: `MCP Gateway (: ${hubPort})`,
        status: "missing",
        details: `Gateway is offline. Launch it via .gateway/start.sh or npx mcp-hub --port ${hubPort}`,
        contentPreview: null,
      });

      return {
        servers: [],
        steps,
        error: null,
      };
    }

    const upstreamList = hubData.servers;
    steps.push({
      target: `MCP Gateway (: ${hubPort})`,
      status: "found",
      details: `Gateway is ONLINE with ${upstreamList.length} upstream servers detected.`,
      contentPreview: JSON.stringify(
        {
          hubPort,
          controlPort,
          upstreamCount: upstreamList.length,
          servers: upstreamList.map((s) => ({ name: s.name, status: s.status, tools: s.capabilities?.tools?.length || 0 })),
        },
        null,
        2
      ),
    });

    // 2. Primary Aggregated Gateway Endpoint
    servers.push({
      id: "gateway:hub",
      name: "🌐 MCP Gateway (Aggregated Fleet)",
      transport: "sse",
      command: null,
      url: `http://localhost:${hubPort}/mcp`,
      description: `Aggregated MCP endpoint multiplexing ${upstreamList.length} servers into one unified schema`,
      hasSecrets: false,
      source: {
        kind: "global",
        label: "Gateway (Aggregated)",
        path: `http://localhost:${hubPort}/mcp`,
      },
      configPreview: JSON.stringify(
        {
          endpoint: `http://localhost:${hubPort}/mcp`,
          events: `http://localhost:${hubPort}/api/events`,
          controlPlane: `http://localhost:${controlPort}`,
          upstreamCount: upstreamList.length,
        },
        null,
        2
      ),
    });

    // 3. Upstream targets
    for (const s of upstreamList) {
      const origTransport = s.transportType === "sse" ? "sse" : s.transportType === "stdio" ? "stdio" : "http";
      const toolCount = s.capabilities?.tools?.length || 0;
      const statusLabel = s.status ? s.status.toUpperCase() : "UNKNOWN";

      servers.push({
        id: `gateway:${s.name}`,
        name: `gateway · ${s.name}`,
        transport: "sse",
        command: s.command || null,
        url: `http://localhost:${hubPort}/mcp`,
        description: `[Gateway] Status: ${statusLabel} | Tools: ${toolCount} | Transport: ${origTransport}`,
        hasSecrets: false,
        source: {
          kind: "global",
          label: `Gateway · ${statusLabel}`,
          path: s.config_source || `http://localhost:${hubPort}/api/servers`,
        },
        configPreview: JSON.stringify(s, null, 2),
      });
    }

    return {
      servers,
      steps,
      error: null,
    };
  },
};

export default gatewayProbe;
