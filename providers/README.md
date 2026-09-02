# Provider probes — contract-first

You don't test people's probe logic, you test that they satisfy the interface. PRs that add a CLI only touch **one file + registry**.

## Contract

`providers/types.server.ts: McpProbe`

```ts
interface McpProbe {
  id: string;                      // key in registry, e.g. "opencode"
  label: string;                   // human, e.g. "opencode · live"
  matches(provider: string): bool  // does this probe handle this Paseo provider id?
  probe(ctx: ProbeContext): Promise<ProbeResult> // live, per-agent, no filesystem prediction
}

interface ProbeContext { agentId, provider, cwd, sessionId? }
interface ProbeResult { servers: McpServer[], error?: string|null }
```

`McpServer` is `mcp.shared.ts: McpServerSchema` — `id, name, transport, source{kind,label,path}, command, url, description, hasSecrets, configPreview`.

## Adding a provider

1. Create `providers/<id>.server.ts`:
   ```ts
   export const myProbe: McpProbe = {
     id: "mycli",
     label: "mycli · live",
     matches: (p) => p === "mycli",
     async probe(ctx) {
       // talk to the live CLI session via SDK, HTTP, CLI command, NOT config files
       // return { servers: [...], error: null }
     },
   };
   ```
2. Add to `providers/registry.server.ts`:
   ```ts
   import { myProbe } from "./mycli.server";
   export const probes = [opencodeProbe, claudeProbe, codexProbe, piProbe, myProbe];
   ```
3. Done. `mcp.server.ts: discoverLiveServers` will call it for any agent where `matches(provider)` is true. No central if/else to modify.

## What "live" means

Not `readFile("~/.claude.json")` as prediction — call the CLI's own session RPC/HTTP/CLI that lists *registered* MCP servers for `ctx.agentId`/`ctx.sessionId`. See `providers/opencode.server.ts` (currently file fallback until opencode exposes `mcp.list`) and `providers/pi.server.ts` stub.

## Tests

`providers/registry.test.ts` only checks the contract — `id` format, `probe` returns `servers[]` with required fields. It never asserts probe *logic*. Merge if that passes.
