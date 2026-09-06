# MCP Gateway Architecture & Monitor Integration

## Overview

The **MCP Gateway** is a standalone, host-level multiplexer and control plane that aggregates multiple local (stdio) and remote (SSE / HTTP) Model Context Protocol servers into a single endpoint:
- **Unified Client Endpoint**: `http://localhost:37373/mcp`
- **Live Event Stream**: `http://localhost:37373/api/events`
- **Programmatic Control Plane**: `http://127.0.0.1:37374`

This architecture decouples MCP servers from individual agent sessions and allows any agent or tool on the host to access a shared, fleet-wide catalog of tools without spawning multiple duplicate background processes.

---

## Key Capabilities

1. **Zero Raw File Writes**:
   - Upstream servers can be registered, toggled, and removed via the REST Control API or CLI.
   - Saves are atomic (using temporary files and atomic renames) to prevent file corruption.
   - `mcp-hub` hot-reloads configuration dynamically within ~1-2 seconds without disconnecting active sessions.

2. **1-Click Host Discovery & Auto-Import**:
   - Scans existing host configurations (`~/.gemini/config/mcp_config.json`, `~/.claude.json`, `~/.config/mcp/mcp.json`, etc.).
   - Discovers stdio and remote MCP servers already configured on the machine and imports them into the gateway fleet with a single click.

3. **Paseo MCP Monitor Integration**:
   - **Gateway Probe (`providers/gateway.ts`)**: Automatically checks if the gateway daemon is running on port 37373/37374 and discovers all upstream servers and tool counts.
   - **Gateway Fleet Cockpit (`pill.client.tsx`)**: An interactive dashboard inside Paseo with:
     - Live Gateway status badge (`🟢 Hub (14)`).
     - Aggregated MCP endpoint box with 1-click clipboard copy.
     - Upstream server cards with live connection status, transport type, and tool counts.
     - Dynamic **"+ Add Server"** form to register new servers directly from the UI.
     - **"Import Host MCPs"** button to pull in all machine-level MCP configurations.
     - Individual server removal.

---

## Gateway Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `http://127.0.0.1:37374/api/status` | `GET` | Gateway health, ports, and connected upstream server summaries |
| `http://127.0.0.1:37374/api/config` | `GET` | Full current gateway configuration JSON |
| `http://127.0.0.1:37374/api/config/add` | `POST` | Dynamically register a new server (`name`, `url` or `command`) |
| `http://127.0.0.1:37374/api/config/remove` | `POST` | Remove a server from the gateway (`name`) |
| `http://127.0.0.1:37374/api/config/toggle` | `POST` | Enable or disable an upstream server (`name`, `disabled`) |
| `http://127.0.0.1:37374/api/scan` | `GET` | Scan host configs and return discovered candidates |
| `http://127.0.0.1:37374/api/config/import` | `POST` | Import all discovered host servers into the active gateway |
| `http://127.0.0.1:37374/api/hub/restart` | `POST` | Restart the supervised `mcp-hub` child process |

---

## Connecting External Clients

Configure any MCP-compatible client to point to the gateway:

```json
{
  "mcpServers": {
    "gateway": {
      "url": "http://localhost:37373/mcp"
    }
  }
}
```
