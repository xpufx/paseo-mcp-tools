import type { PluginContext } from "@getpaseo/plugin";
import { PluginStorage, registerSettingsRpc } from "paseo-plugin-helper/server";
import { contributeClient } from "./pill.client";
import { createCallMcpToolHandler, createDiagnoseMcpHandler, createHealthHandler, createListMcpHandler, createReadMcpHandler, log } from "./mcp.server";
import { callMcpTool, checkMcpHealth, diagnoseMcp, listMcp, mcpToolsSettingsContract, readMcp, type McpToolsSettings } from "./mcp.shared";

export const settingsStorage = new PluginStorage<McpToolsSettings>("mcp-tools", "settings.json", {
  schema: mcpToolsSettingsContract.schema,
});

export default function contribute(plugin: PluginContext) {
  plugin.handle(listMcp, createListMcpHandler());
  plugin.handle(readMcp, createReadMcpHandler());
  plugin.handle(checkMcpHealth, createHealthHandler());
  plugin.handle(callMcpTool, createCallMcpToolHandler());
  plugin.handle(diagnoseMcp, createDiagnoseMcpHandler());
  registerSettingsRpc(plugin, mcpToolsSettingsContract, settingsStorage, {
    onUpdate: (next) => {
      log.info("Settings updated", next);
    },
    onReset: () => {
      log.info("Settings reset to defaults");
    },
  });
  plugin.addClientSide(contributeClient);
  return () => {};
}
