---
name: write-mcp-provider
description: >-
  Instructions and guidelines for creating, testing, and registering a new CLI/tool MCP provider
  probe in paseo-mcp-tools (e.g. Cursor, Windsurf, Zed, Roo, Cline, Aider).
---

# Writing a New MCP Provider Probe

This skill guides you through adding support for a new AI coding agent CLI or editor tool (e.g., Cursor, Windsurf, Zed, Roo, Cline, Aider) in `paseo-mcp-tools`.

---

## 1. Architecture Overview

Every provider is an isolated, black-box probe that implements `McpProbe`:
- **Location**: `providers/<id>.ts`
- **Output**: Returns `Promise<{ servers: McpServer[], error?: string | null, steps?: DiagnosticStep[] }>`
- **No External Dependencies**: Use standard Node.js APIs (`path`, `os`, `node:fs/promises`, `node:child_process`) or the built-in `discoverFromCandidates` helper from `../discovery/extract`.

---

## 2. Option A: File-Based Tool (Standard JSON/JSONC/TOML)

If the tool stores its MCP configurations in standard JSON/JSONC/TOML files on disk (like Pi, Claude, Cursor, Windsurf, VS Code):

Create `providers/<id>.ts`:

```typescript
import os from "node:os";
import path from "node:path";
import { discoverFromCandidates } from "../discovery/extract";
import type { McpProbe, ProbeContext } from "../discovery/types";

export const myToolProbe: McpProbe = {
  id: "mytool",
  label: "mytool · live",
  matches: (provider) => provider === "mytool",
  async probe(ctx: ProbeContext) {
    const home = os.homedir();
    // Precedence: lower index = base default, higher index = project override
    return discoverFromCandidates("mytool", [
      { path: path.join(home, ".config", "mytool", "mcp.json"), label: "mytool · user global" },
      { path: path.join(home, ".mytool", "mcp.json"), label: "mytool · user config" },
      { path: path.join(ctx.cwd, ".mytool", "mcp.json"), label: "mytool · project override" },
      { path: path.join(ctx.cwd, "mytool.json"), label: "mytool · project config" },
    ]);
  },
};

export default myToolProbe;
```

`discoverFromCandidates` automatically handles:
- Checking file existence safely.
- JSON/JSONC comment and trailing-comma stripping without corrupting `http://` / `https://` URLs.
- Detecting root keys (`mcpServers`, `mcp-servers`, `mcp`, `servers`, or top-level dictionary).
- Resolving `stdio` (command + args), `http`, and `sse` transports.
- Redacting tokens, passwords, and sensitive environment keys.
- Emitting `steps` for the built-in Paseo MCP diagnosis report automatically.

---

## 3. Option B: CLI-Based Tool (Live Session / Subshell)

If the tool provides a live CLI subcommand that lists active session tools (like OpenCode):

Create `providers/<id>.ts`:

```typescript
import { spawn } from "node:child_process";
import type { McpProbe, ProbeContext, McpServer } from "../discovery/types";

export const myCliProbe: McpProbe = {
  id: "mycli",
  label: "mycli · live",
  matches: (provider) => provider === "mycli",
  async probe(ctx: ProbeContext) {
    return new Promise((resolve) => {
      const child = spawn("mycli", ["mcp", "list", "--json"], {
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
          resolve({ servers: [], error: err || `mycli exited with code ${code}` });
          return;
        }

        // Map output to McpServer[]
        // Return { servers: [...], error: null }
      });
    });
  },
};

export default myCliProbe;
```

---

## 4. Register the Probe (1-Liner)

Add 1 line to `providers/catalog.ts`:

```typescript
export { default as mytool } from "./mytool";
```

That's it! `providers/index.ts` automatically incorporates the new probe into `probes`, the `probeForProvider` resolver, diagnostics, and test suites.

---

## 5. Verify & Test

Run the automated contract test suite:

```bash
npm test
npm run typecheck
```

The contract test (`providers/providers.test.ts`) guarantees:
1. Valid ID format (`/^[a-z0-9_-]+$/`) and label.
2. `matches(provider)` behaves correctly.
3. Probing does not throw uncaught exceptions.
4. All returned servers strictly satisfy the runtime `McpServerSchema` (Zod validation).
