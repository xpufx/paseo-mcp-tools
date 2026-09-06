import type { PluginContext } from "@getpaseo/plugin";
import { contributeClient } from "./pill.client";
import { createCallMcpToolHandler, createDiagnoseMcpHandler, createHealthHandler, createListMcpHandler, createReadMcpHandler } from "./mcp.server";
import { callMcpTool, checkMcpHealth, diagnoseMcp, listMcp, readMcp } from "./mcp.shared";
import { registerMcpToolsSettings } from "./settings.server";

export default function contribute(plugin: PluginContext) {
  plugin.handle(listMcp, createListMcpHandler());
  plugin.handle(readMcp, createReadMcpHandler());
  plugin.handle(checkMcpHealth, createHealthHandler());
  plugin.handle(callMcpTool, createCallMcpToolHandler());
  plugin.handle(diagnoseMcp, createDiagnoseMcpHandler());
  registerMcpToolsSettings(plugin);
  plugin.addClientSide(contributeClient);
  return () => {};
}
