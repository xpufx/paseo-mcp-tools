import os from "node:os";
import path from "node:path";
import { discoverFromCandidates } from "../discovery/extract";
import type { McpProbe, ProbeContext } from "../discovery/types";

export const antigravityProbe: McpProbe = {
  id: "antigravity",
  label: "antigravity · live",
  matches: (provider) => provider === "antigravity" || provider === "antigravity-acp",
  async probe(ctx: ProbeContext) {
    const home = os.homedir();
    return discoverFromCandidates("antigravity", [
      { path: path.join(home, ".gemini", "config", "mcp_config.json"), label: "antigravity · user global" },
      { path: path.join(home, ".gemini", "antigravity", "mcp_config.json"), label: "antigravity · app global" },
      { path: path.join(ctx.cwd, ".gemini", "mcp_config.json"), label: "antigravity · project config" },
      { path: path.join(ctx.cwd, "mcp_config.json"), label: "antigravity · project root" },
    ]);
  },
};

export default antigravityProbe;
