# paseo-mcp-monitor

Pill → Modal inspector for MCP, modeled on [`gpambrozio/paseo-plugins/skills`](https://github.com/gpambrozio/paseo-plugins/tree/main/skills) but intentionally **not** a full workspace panel.

Skills ships a `addWorkspacePanel` + `addCommandCenterItem`. This ships a `addComposerPill` + `Modal`.

## What it does

- **Pill** above the composer shows `MCP n` (servers discovered for that agent's `cwd`). Badge updates via `mcp.list` query, shared between pill and modal.
- **Modal** (via `Modal` from `@getpaseo/plugin/react-native`) opens on pill press — not `client.openPanel`. Managed via a per-`agentId` opener registry so `contributeClient.onPress` can drive `useState` inside the pill's React tree.
- **Discovery** mirrors `skills` but for MCP: walks up from `agent.cwd` for `.mcp.json`, plus `~/.claude.json`, `~/.codex/config.toml`, `~/.cursor/mcp.json`. Groups by `source.label` (project / repo / personal). Deduplicates by name (first-wins, same as `skill-entry`).
- **Paseo tools** section lists the daemon's own MCP catalog (Agents / Workspaces / Terminals / etc.) — the static equivalent of `reported` in skills (live `agent.commands()` without filesystem file).
- **Search** filters both sections client-side, same `term` logic as `panel.client.tsx`.
- **Detail** taps a server → `mcp.read` (re-reads the file for that `id`, redacts secrets) with copy-path + back.

## Layout (cf. skills layout table)

| File | Owns |
|---|---|
| `index.ts` | Wiring only — `handle(mcp.list)`, `handle(mcp.read)`, `addClientSide` |
| `mcp.shared.ts` | zod RPC contracts (imported by both runtimes) |
| `mcp.server.ts` | `discoverFilesystem()` + PASEO_TOOLS static list, `createListMcpHandler` / `createReadMcpHandler` |
| `mcp-query.client.tsx` | `useMcpQuery` shared by pill and modal |
| `pill.client.tsx` | Pill + `McpModal` (search, grouped list, detail, redact), opener registry |

No `panel.client.tsx`, no `addWorkspacePanel`, no `docs/design.md` — the modal *is* the surface.

## Install

```bash
# from this checkout (keeps path-linked, reload on start)
paseo plugin install "$PWD"

# or from git
paseo plugin add <repo> --path paseo-mcp-monitor
```

`pluginsEnabled: true` required. `paseo plugin reload mcp-monitor` after edits; `paseo plugin logs mcp-monitor` for errors. Failed reload stays failed (Paseo doesn't restore).

## Why modal not panel

"Frankly, my dear, I don't give a damn" about a full page — the pill is the anchor, the modal is transient inspector, no navigation stack. Keeps the agent's composer in view, like `itsjustanks/paseo-mcp`'s inline editors vs skills' dedicated panel.
