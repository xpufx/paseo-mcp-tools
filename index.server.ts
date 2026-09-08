import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  createCallMcpToolHandler,
  createDiagnoseMcpHandler,
  createHealthHandler,
  createListMcpHandler,
  createReadMcpHandler,
} from "./server/mcp";
import {
  callMcpTool,
  checkMcpHealth,
  diagnoseMcp,
  listMcp,
  mcpToolsSettingsContract,
  readMcp,
} from "./shared/mcp";
import { settingsHandlers } from "./server/settings";

export default function contribute(server: PluginServerContext) {
  server.handle(listMcp, createListMcpHandler());
  server.handle(readMcp, createReadMcpHandler());
  server.handle(checkMcpHealth, createHealthHandler());
  server.handle(callMcpTool, createCallMcpToolHandler());
  server.handle(diagnoseMcp, createDiagnoseMcpHandler());
  server.handle(mcpToolsSettingsContract.get, settingsHandlers.get);
  server.handle(mcpToolsSettingsContract.update, settingsHandlers.update);
  server.handle(mcpToolsSettingsContract.reset, settingsHandlers.reset);
  return () => {};
}
