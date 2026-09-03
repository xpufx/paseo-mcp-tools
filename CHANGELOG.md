# Changelog

All notable changes to `paseo-mcp-tools` are documented in this file.

## [v0.1.3] - 2026-09-03

### Added
- **Paseo Built-in Host MCP Discovery & Execution** (`providers/paseo.ts`):
  - Added dedicated probe discovering Paseo's live host daemon control plane (`/mcp/agents?callerAgentId=...`).
  - Displays as a first-class MCP server (`Paseo (Builtin)`) with live health checks and latency.
  - Exposes all 61 live Paseo tools (workspaces, terminals, schedules, browser automation, agent orchestration) with full interactive execution in the Tool Runner.
- **Real-Time Tool Search on Server Detail Page** (`pill.client.tsx`):
  - Added sticky search/filter box above the tools list to filter tools instantly by name and description.
  - Displays dynamic match counter (`(X of Y)`) and clear button.
- **Testing & Methodology Documentation** (`docs/TEST_METHODOLOGY.md`):
  - Comprehensive documentation covering adapter contracts, configuration precedence, transport checks, and live reload flows.

### Fixed
- **JSON Schema Draft-07 Union Type Support** (`mcp.shared.ts` & `pill.client.tsx`):
  - Updated `ToolPropertySchema` to support array/union types (e.g. `["string", "null"]`) and `.passthrough()`, preventing Zod RPC rejection on rich schemas like `update_schedule`.
  - Cleaned up parameter UI rendering and argument parsing for union types (`(string | null)`).
- Removed legacy static, non-functional 18-tool Paseo accordion in favor of the live server detail page.

## [v0.1.2] - 2026-09-03

### Added
- **Antigravity Provider Probe** (`providers/antigravity.ts`):
  - Automatically discovers MCP servers from global `~/.gemini/config/mcp_config.json` and fallback `~/.antigravity/mcp_config.json`.
  - Supports both `antigravity` and `antigravity-acp` provider identifiers.
- **1-Line Provider Catalog Architecture** (`providers/catalog.ts`):
  - Streamlined provider registration to a single `export { default as <id> } from "./<id>"`.
  - Probes are automatically aggregated, indexed, verified, and exposed without manual array maintenance or hardcoded if/else branching.
- **Polymorphic Host Diagnostics** (`discovery/extract.ts` & `mcp.server.ts`):
  - Every probe emits diagnostic inspection steps dynamically.
  - JSON Diagnostic Report includes self-describing fields (`report`, `version`, `provider`, `cwd`, `steps`, `discoveredServerCount`).
- **Offline Build-Time Versioning** (`scripts/version.mjs`):
  - Resolves git tag or short commit hash at build time into `version.ts`.
  - Integrated into Paseo plugin build lifecycle (`paseo-plugin.json`) and npm scripts (`pretest`, `pretypecheck`).
  - Displays version in modal header, subtitle, and diagnostics drawer.

### Changed
- Refactored `discovery/` engine into clean, dedicated modules (`discovery/extract.ts`, `discovery/types.ts`).
- Updated `write-mcp-provider` skill and `README.md` documentation to reflect 1-line catalog architecture.
- Replaced legacy `.server.ts` provider files with clean default-export provider modules.
