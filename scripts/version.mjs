import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { stampVersion } = require("paseo-plugin-helper/server");

const { version, updated } = stampVersion({ targetFile: "./shared/version.ts" });
console.log(`[build] PLUGIN_VERSION ${updated ? "stamped" : "up to date"}: "${version}" in shared/version.ts`);
