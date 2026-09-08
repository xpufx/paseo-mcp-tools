import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  createCallMcpToolHandler,
  createDiagnoseMcpHandler,
  createHealthHandler,
  createListMcpHandler,
  createReadMcpHandler,
  log,
} from "./server/mcp";
import {
  callMcpTool,
  checkMcpHealth,
  diagnoseMcp,
  listMcp,
  mcpToolsSettingsContract,
  readMcp,
} from "./shared/mcp";
import { settingsHandlers, settingsStorage } from "./server/settings";
import { GATEWAY_SERVER_NAME, injectGatewayIntoCreateRequest } from "./server/inject";

export default function contribute(server: PluginServerContext) {
  server.handle(listMcp, createListMcpHandler());
  server.handle(readMcp, createReadMcpHandler());
  server.handle(checkMcpHealth, createHealthHandler());
  server.handle(callMcpTool, createCallMcpToolHandler());
  server.handle(diagnoseMcp, createDiagnoseMcpHandler());
  server.handle(mcpToolsSettingsContract.get, settingsHandlers.get);
  server.handle(mcpToolsSettingsContract.update, settingsHandlers.update);
  server.handle(mcpToolsSettingsContract.reset, settingsHandlers.reset);
  server.before("agent.create", ({ request }) => {
    const settings = settingsStorage.read();
    const next = injectGatewayIntoCreateRequest(request, {
      enabled: settings.gatewayInject,
      url: settings.gatewayUrl,
    });
    if (next) {
      log.info(`Injected ${GATEWAY_SERVER_NAME} MCP server into agent.create`, {
        provider: next.config.provider,
      });
    }
    return next;
  });
  return () => {};
}
