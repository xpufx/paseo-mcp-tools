import type { PluginContext } from "@getpaseo/plugin";
import { contributeClient } from "./pill.client";
import { createCallMcpToolHandler, createDiagnoseMcpHandler, createHealthHandler, createListMcpHandler, createReadMcpHandler } from "./mcp.server";
import { callMcpTool, checkMcpHealth, diagnoseMcp, listMcp, mcpToolsSettingsContract, readMcp } from "./mcp.shared";
import { settingsHandlers } from "./settings.server";

export default function contribute(plugin: PluginContext) {
  plugin.handle(listMcp, createListMcpHandler());
  plugin.handle(readMcp, createReadMcpHandler());
  plugin.handle(checkMcpHealth, createHealthHandler());
  plugin.handle(callMcpTool, createCallMcpToolHandler());
  plugin.handle(diagnoseMcp, createDiagnoseMcpHandler());
  plugin.handle(mcpToolsSettingsContract.get, settingsHandlers.get);
  plugin.handle(mcpToolsSettingsContract.update, settingsHandlers.update);
  plugin.handle(mcpToolsSettingsContract.reset, settingsHandlers.reset);
  plugin.addClientSide(contributeClient);
  return () => {};
}
