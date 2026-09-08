import { PluginStorage, createSettingsHandlers } from "paseo-plugin-helper/server";
import { log } from "./mcp";
import { mcpToolsSettingsContract, type McpToolsSettings } from "../shared/mcp";

export const settingsStorage = new PluginStorage<McpToolsSettings>("mcp-tools", "settings.json", {
  schema: mcpToolsSettingsContract.schema,
});

// Plain handler functions on purpose: index.server.ts wires them via
// server.handle, which is the only call form the compiler strips
// from the client bundle.
export const settingsHandlers = createSettingsHandlers(mcpToolsSettingsContract, settingsStorage, {
  onUpdate: (next) => {
    log.info("Settings updated", next);
  },
  onReset: () => {
    log.info("Settings reset to defaults");
  },
});
