import { describe, expect, it } from "vitest";
import { GATEWAY_SERVER_NAME, injectGatewayIntoCreateRequest } from "./inject";

function baseRequest() {
  return {
    config: {
      provider: "antigravity-acp",
      mcpServers: {
        direct: { type: "http", url: "http://localhost:9999/mcp" },
      },
    },
  } as never;
}

describe("gateway injection into agent.create", () => {
  it("adds the gateway entry and preserves existing servers", () => {
    const out = injectGatewayIntoCreateRequest(baseRequest(), {
      enabled: true,
      url: "http://127.0.0.1:37374/mcp",
    });
    expect(out).toBeDefined();
    expect(out?.config.mcpServers?.[GATEWAY_SERVER_NAME]).toEqual({
      type: "http",
      url: "http://127.0.0.1:37374/mcp",
    });
    expect(out?.config.mcpServers?.direct).toBeDefined();
  });

  it("keeps the request when injection is disabled", () => {
    expect(
      injectGatewayIntoCreateRequest(baseRequest(), { enabled: false, url: "http://x/mcp" }),
    ).toBeUndefined();
  });

  it("keeps the request when a gateway entry already exists", () => {
    const req = baseRequest() as { config: { provider: string; mcpServers: Record<string, unknown> } };
    req.config.mcpServers[GATEWAY_SERVER_NAME] = { type: "http", url: "http://custom/mcp" };
    const out = injectGatewayIntoCreateRequest(req as never, {
      enabled: true,
      url: "http://127.0.0.1:37374/mcp",
    });
    expect(out).toBeUndefined();
  });

  it("keeps the request when no url is configured", () => {
    expect(
      injectGatewayIntoCreateRequest(baseRequest(), { enabled: true, url: "" }),
    ).toBeUndefined();
  });
});
