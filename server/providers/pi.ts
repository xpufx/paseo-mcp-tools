import os from "node:os";
import path from "node:path";
import { discoverFromCandidates } from "../discovery/extract";
import type { McpProbe, ProbeContext } from "../discovery/types";

export const piProbe: McpProbe = {
  id: "pi",
  label: "pi · live",
  matches: (provider) => provider === "pi",
  async probe(ctx: ProbeContext) {
    const home = os.homedir();
    const envDir = process.env.PI_CODING_AGENT_DIR?.trim()
      ? path.resolve(process.env.PI_CODING_AGENT_DIR.trim().replace(/^~\//, `${home}/`))
      : null;

    // Precedence: lower index = base default, higher index = override wins
    return discoverFromCandidates("pi", [
      { path: path.join(home, ".config", "mcp", "mcp.json"), label: "pi · global shared" },
      { path: path.join(home, ".agents", "mcp.json"), label: "pi · agents global" },
      { path: path.join(home, ".agents", "mcp", "mcp.json"), label: "pi · agents nested" },
      { path: path.join(home, ".pi", "agent", "mcp.json"), label: "pi · agent global" },
      { path: path.join(home, ".pi", "mcp.json"), label: "pi · user config" },
      { path: path.join(home, ".pi", ".mcp.json"), label: "pi · user config" },
      ...(envDir
        ? [
            { path: path.join(envDir, "mcp.json"), label: "pi · env config" },
            { path: path.join(envDir, ".mcp.json"), label: "pi · env config" },
          ]
        : []),
      { path: path.join(ctx.cwd, "mcp.json"), label: "pi · project shared" },
      { path: path.join(ctx.cwd, ".mcp.json"), label: "pi · project shared" },
      { path: path.join(ctx.cwd, ".pi", "mcp.json"), label: "pi · project override" },
      { path: path.join(ctx.cwd, ".pi", ".mcp.json"), label: "pi · project override" },
    ]);
  },
};

export default piProbe;
