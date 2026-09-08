import type { PluginClientContext } from "@getpaseo/plugin/client";
import { registerMcpCommands } from "./client/commands";
import { contributeClient } from "./client/pill";
import { registerMcpTimeline } from "./client/timeline";

export default function contribute(client: PluginClientContext) {
  const removePill = contributeClient(client);
  const removeCommands = registerMcpCommands(client);
  const removeTimeline = registerMcpTimeline(client);
  return () => {
    removeTimeline();
    removeCommands();
    removePill();
  };
}
