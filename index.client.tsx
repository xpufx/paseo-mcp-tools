import type { PluginClientContext } from "@getpaseo/plugin/client";
import { contributeClient } from "./client/pill";

export default function contribute(client: PluginClientContext) {
  return contributeClient(client);
}
