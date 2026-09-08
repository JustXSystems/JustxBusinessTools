/**
 * Pack all Sync Center agent artifacts into web/public.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function run(script) {
  const r = spawnSync(process.execPath, [path.join(__dirname, script)], {
    stdio: "inherit",
  });
  if (r.status !== 0) process.exit(r.status || 1);
}

run("pack-desktop-sync-agent.mjs");
run("pack-justx-sync-agent-win.mjs");
