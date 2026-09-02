import type { PluginContext } from "@getpaseo/plugin";
import { contributeClient } from "./pill.client";
import { createDiagnoseMcpHandler, createHealthHandler, createListMcpHandler, createReadMcpHandler } from "./mcp.server";
import { checkMcpHealth, diagnoseMcp, listMcp, readMcp } from "./mcp.shared";

export default function contribute(plugin: PluginContext) {
  plugin.handle(listMcp, createListMcpHandler());
  plugin.handle(readMcp, createReadMcpHandler());
  plugin.handle(checkMcpHealth, createHealthHandler());
  plugin.handle(diagnoseMcp, createDiagnoseMcpHandler());
  plugin.addClientSide(contributeClient);
  return () => {};
}
