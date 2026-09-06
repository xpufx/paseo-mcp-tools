import type { PluginContext } from "@getpaseo/plugin";
import { contributeClient } from "./pill.client";
import {
  createCallMcpToolHandler,
  createDiagnoseMcpHandler,
  createGatewayAddServerHandler,
  createGatewayImportHostHandler,
  createGatewayRemoveServerHandler,
  createGatewayStatusHandler,
  createHealthHandler,
  createListMcpHandler,
  createReadMcpHandler,
} from "./mcp.server";
import {
  callMcpTool,
  checkMcpHealth,
  diagnoseMcp,
  gatewayAddServer,
  gatewayImportHost,
  gatewayRemoveServer,
  gatewayStatus,
  listMcp,
  readMcp,
} from "./mcp.shared";

export default function contribute(plugin: PluginContext) {
  plugin.handle(listMcp, createListMcpHandler());
  plugin.handle(readMcp, createReadMcpHandler());
  plugin.handle(checkMcpHealth, createHealthHandler());
  plugin.handle(callMcpTool, createCallMcpToolHandler());
  plugin.handle(diagnoseMcp, createDiagnoseMcpHandler());
  plugin.handle(gatewayStatus, createGatewayStatusHandler());
  plugin.handle(gatewayAddServer, createGatewayAddServerHandler());
  plugin.handle(gatewayRemoveServer, createGatewayRemoveServerHandler());
  plugin.handle(gatewayImportHost, createGatewayImportHostHandler());
  plugin.addClientSide(contributeClient);
  return () => {};
}
