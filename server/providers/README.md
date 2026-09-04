# Provider Probes — Contract-First

You don't test people's probe logic, you test that they satisfy the interface. Adding a new provider only touches **one file + 1 line in catalog**.

## Contract

`discovery/types.ts: McpProbe`

```ts
interface McpProbe {
  id: string;                      // key in registry, e.g. "opencode"
  label: string;                   // human, e.g. "opencode · live"
  matches(provider: string): bool  // does this probe handle this Paseo provider id?
  probe(ctx: ProbeContext): Promise<ProbeResult> // live probe run
}

interface ProbeContext { agentId: string; provider: string; cwd: string; sessionId?: string | null }
interface ProbeResult { servers: McpServer[]; error?: string | null; steps?: DiagnosticStep[] }
```

`McpServer` is `mcp.shared.ts: McpServerSchema` — `id, name, transport, source{kind,label,path}, command, url, description, hasSecrets, configPreview`.

## Adding a provider

1. Create `providers/<id>.ts`:
   ```ts
   import type { McpProbe, ProbeContext } from "../discovery/types";

   const myProbe: McpProbe = {
     id: "mycli",
     label: "mycli · live",
     matches: (p) => p === "mycli",
     async probe(ctx: ProbeContext) {
       // discover servers
       return { servers: [...], error: null };
     },
   };

   export default myProbe;
   ```

2. Add 1 line to `providers/catalog.ts`:
   ```ts
   export { default as mycli } from "./mycli";
   ```

3. Done. The probe is automatically indexed into `probes`, used by `probeForProvider`, reported in diagnostics, and validated by `npm test`.

## Tests

`providers/providers.test.ts` checks contract compliance — `id` format, `probe` execution, and Zod validation for every returned server.
