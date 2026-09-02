# paseo-mcp-tools

Provides an inline UI for checking MCP servers available to an agent session with additional functionality per MCP. Uses the most authoritative list per provider CLI and verifies actual session inclusion with live probes.

(**Paseo** is an agent orchestrator: AI coding agents run on paseo daemons, each managing workspaces, tools, and permissions.)

## What it does

- **Pill** above the composer shows `MCP n` (live servers for that agent). Badge updates via `mcp.list`, shared between pill and modal.
- **Live discovery** per-CLI via isolated `providers/<id>.server.ts` (opencode → `opencode mcp list`, claude → `~/.claude.json` live, etc.) + Paseo-injected `StoredAgentRecord.mcpServers`. Groups by `source.label`, dedupes by name.
- **Paseo catalog** collapsed at bottom (18 tools) — tap to expand.
- **Search** filters servers + tools client-side.
- **Detail** tap → `mcp.read` (redacted) + live `mcp.health` → `instructions` + `tools` via generic health client.

## Layout

| File | Owns |
|---|---|
| `index.ts` | Wiring only — `handle(mcp.list)`, `handle(mcp.read)`, `handle(mcp.health)`, `addClientSide` |
| `mcp.shared.ts` | zod RPC contracts |
| `mcp.server.ts` | `discoverLiveServers()` + PASEO_TOOLS, handlers |
| `providers/<id>.server.ts` | Per-CLI live probe — isolated, contract `McpProbe` |
| `providers/health.server.ts` | Generic `Client` health (stdio/http) — `instructions` + `tools` |
| `mcp-query.client.tsx` | `useMcpQuery` shared pill/modal, 30m timer + manual Refresh |
| `pill.client.tsx` | Pill + `McpModal` (search, Last check, Refresh, detail, collapsed Paseo) |

## Install

```bash
# from this checkout (keeps path-linked, reload on start)
paseo plugin install "$PWD"

# or from git
paseo plugin add <repo> --path paseo-mcp-monitor
```

`pluginsEnabled: true` required. `paseo plugin reload mcp-monitor` after edits; `paseo plugin logs mcp-monitor` for errors. Failed reload stays failed (Paseo doesn't restore).
