# Changelog

All notable changes to `paseo-mcp-tools` are documented in this file.

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
