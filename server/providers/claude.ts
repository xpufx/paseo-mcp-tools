import os from "node:os";
import path from "node:path";
import { discoverFromCandidates } from "../discovery/extract";
import type { McpProbe, ProbeContext } from "../discovery/types";

export const claudeProbe: McpProbe = {
  id: "claude",
  label: "claude · live",
  matches: (provider) => provider === "claude",
  async probe(ctx: ProbeContext) {
    const home = os.homedir();
    return discoverFromCandidates("claude", [
      { path: path.join(home, ".claude.json"), label: "claude · user global" },
      { path: path.join(home, ".claude", "settings.json"), label: "claude · settings global" },
      { path: path.join(ctx.cwd, ".claude.json"), label: "claude · project shared" },
    ]);
  },
};

export default claudeProbe;
