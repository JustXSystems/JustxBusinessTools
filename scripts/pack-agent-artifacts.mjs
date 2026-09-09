/**
 * Pack Sync Center agent artifacts into web/public.
 *
 * Slim zip always. Win-x64 pack (~28MB) is skipped when JBT_SKIP_WIN_AGENT_PACK=1
 * (CI default) — VPS keeps the existing public zip across deploys.
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

if (process.env.JBT_SKIP_WIN_AGENT_PACK === "1") {
  console.log("Skipping JustX-Sync-Agent-win-x64.zip (JBT_SKIP_WIN_AGENT_PACK=1)");
} else {
  run("pack-justx-sync-agent-win.mjs");
}
