import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { stampVersion } = require("paseo-plugin-helper/server");

const { version, updated } = stampVersion({ targetFile: "./version.ts" });
console.log(`[build] PLUGIN_VERSION ${updated ? "stamped" : "up to date"}: "${version}" in version.ts`);
