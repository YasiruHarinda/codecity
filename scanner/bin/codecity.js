#!/usr/bin/env node
// Launcher for `npx codecity`. It's a plain file that always exists, so npm can register the
// command at install time; it loads the real CLI, which `npm run build` bundles into dist/.
import { existsSync } from "node:fs";

const cli = new URL("../dist/cli.js", import.meta.url);
if (!existsSync(cli)) {
  console.error("codecity: the scanner isn't built yet. Run `npm run build` in the codecity folder first.");
  process.exit(1);
}
await import(cli.href);
