import type { PluginServerContext } from "@getpaseo/plugin";
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
  readMcp,
} from "./shared/mcp";

export default function contribute(server: PluginServerContext) {
  server.handle(listMcp, createListMcpHandler());
  server.handle(readMcp, createReadMcpHandler());
  server.handle(checkMcpHealth, createHealthHandler());
  server.handle(callMcpTool, createCallMcpToolHandler());
  server.handle(diagnoseMcp, createDiagnoseMcpHandler());
  return () => {};
}
