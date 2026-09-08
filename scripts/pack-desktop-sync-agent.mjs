/**
 * Pack slim desktop-sync-agent sources into web/public/desktop-sync-agent.zip
 * (advanced / PowerShell bootstrap). Customer primary pack is JustX-Sync-Agent-win-x64.zip.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { buildZip } from "./lib/zip-store.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const agentDir = path.join(root, "desktop-sync-agent");
const outDir = path.join(root, "web", "public");
const outFile = path.join(outDir, "desktop-sync-agent.zip");

const INCLUDE = [
  "src/index.js",
  "package.json",
  "install-agent.ps1",
  "uninstall-agent.ps1",
  "health-check.ps1",
  "README.md",
];

function main() {
  if (!fs.existsSync(agentDir)) {
    throw new Error(`Agent dir not found: ${agentDir}`);
  }
  fs.mkdirSync(outDir, { recursive: true });
  const files = INCLUDE.map((rel) => {
    const abs = path.join(agentDir, rel);
    if (!fs.existsSync(abs)) throw new Error(`Missing pack file: ${rel}`);
    return { name: `desktop-sync-agent/${rel.replace(/\\/g, "/")}`, data: fs.readFileSync(abs) };
  });
  const zip = buildZip(files);
  fs.writeFileSync(outFile, zip);
  const sha = createHash("sha256").update(zip).digest("hex").slice(0, 12);
  console.log(
    `Packed ${files.length} files -> ${path.relative(root, outFile)} (${zip.length} bytes, sha256:${sha})`,
  );
}

main();
