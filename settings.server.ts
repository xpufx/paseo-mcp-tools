import type { PluginContext } from "@getpaseo/plugin";
import { PluginStorage, registerSettingsRpc } from "paseo-plugin-helper/server";
import { log } from "./mcp.server";
import { mcpToolsSettingsContract, type McpToolsSettings } from "./mcp.shared";

export const settingsStorage = new PluginStorage<McpToolsSettings>("mcp-tools", "settings.json", {
  schema: mcpToolsSettingsContract.schema,
});

export function registerMcpToolsSettings(plugin: PluginContext): void {
  registerSettingsRpc(plugin, mcpToolsSettingsContract, settingsStorage, {
    onUpdate: (next) => {
      log.info("Settings updated", next);
    },
    onReset: () => {
      log.info("Settings reset to defaults");
    },
  });
}
