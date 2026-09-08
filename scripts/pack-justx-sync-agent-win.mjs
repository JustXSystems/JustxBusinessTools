/**
 * Build JustX-Sync-Agent-win-x64.zip for non-technical Windows customers.
 * Bundles official Node.js win-x64 + agent + double-click Install.cmd.
 *
 * Run: node scripts/pack-justx-sync-agent-win.mjs
 * Also invoked from web prebuild.
 */
import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { buildZip } from "./lib/zip-store.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const agentDir = path.join(root, "desktop-sync-agent");
const setupDir = path.join(agentDir, "windows-setup");
const outDir = path.join(root, "web", "public");
const outFile = path.join(outDir, "JustX-Sync-Agent-win-x64.zip");
const cacheDir = path.join(agentDir, ".runtime-cache");

/** Pin Node 20 LTS win-x64 for reproducible customer packs. */
const NODE_VERSION = "20.18.1";
const NODE_DIST = `node-v${NODE_VERSION}-win-x64`;
const NODE_ZIP = `https://nodejs.org/dist/v${NODE_VERSION}/${NODE_DIST}.zip`;

const PACK_VERSION = "1.1.0";

const SETUP_FILES = [
  "START-HERE.txt",
  "Install JustX Sync Agent.cmd",
  "Uninstall JustX Sync Agent.cmd",
  "Check Status.cmd",
  "run-agent.cmd",
  "windows-stop-bridge.cmd",
];

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https
      .get(url, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close();
          fs.unlinkSync(dest);
          download(res.headers.location, dest).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          file.close();
          fs.unlinkSync(dest);
          reject(new Error(`Download failed HTTP ${res.statusCode} for ${url}`));
          return;
        }
        res.pipe(file);
        file.on("finish", () => file.close(() => resolve()));
      })
      .on("error", (err) => {
        try {
          fs.unlinkSync(dest);
        } catch {
          // ignore
        }
        reject(err);
      });
  });
}

function extractNodeExe(nodeZipPath, destExe) {
  const extractRoot = path.join(cacheDir, "extract");
  fs.rmSync(extractRoot, { recursive: true, force: true });
  fs.mkdirSync(extractRoot, { recursive: true });

  if (process.platform === "win32") {
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `Expand-Archive -LiteralPath '${nodeZipPath.replace(/'/g, "''")}' -DestinationPath '${extractRoot.replace(/'/g, "''")}' -Force`,
      ],
      { stdio: "inherit" },
    );
  } else {
    execFileSync("unzip", ["-qo", nodeZipPath, "-d", extractRoot], { stdio: "inherit" });
  }

  const candidate = path.join(extractRoot, NODE_DIST, "node.exe");
  if (!fs.existsSync(candidate)) {
    throw new Error(`node.exe not found after extract: ${candidate}`);
  }
  fs.mkdirSync(path.dirname(destExe), { recursive: true });
  fs.copyFileSync(candidate, destExe);
  return destExe;
}

async function ensureNodeExe() {
  const cachedExe = path.join(cacheDir, NODE_DIST, "node.exe");
  if (fs.existsSync(cachedExe) && fs.statSync(cachedExe).size > 1_000_000) {
    console.log(`Using cached Node ${NODE_VERSION} win-x64`);
    return cachedExe;
  }
  fs.mkdirSync(cacheDir, { recursive: true });
  const zipPath = path.join(cacheDir, `${NODE_DIST}.zip`);
  if (!fs.existsSync(zipPath) || fs.statSync(zipPath).size < 1_000_000) {
    console.log(`Downloading ${NODE_ZIP} ...`);
    await download(NODE_ZIP, zipPath);
  }
  console.log("Extracting node.exe ...");
  return extractNodeExe(zipPath, cachedExe);
}

function addFile(files, zipName, absPath) {
  if (!fs.existsSync(absPath)) throw new Error(`Missing: ${absPath}`);
  files.push({ name: zipName.replace(/\\/g, "/"), data: fs.readFileSync(absPath) });
}

async function main() {
  if (!fs.existsSync(setupDir)) throw new Error(`Missing windows-setup: ${setupDir}`);
  fs.mkdirSync(outDir, { recursive: true });

  const nodeExe = await ensureNodeExe();
  const files = [];
  const prefix = "JustX-Sync-Agent";

  for (const name of SETUP_FILES) {
    addFile(files, `${prefix}/${name}`, path.join(setupDir, name));
  }
  addFile(files, `${prefix}/runtime/node.exe`, nodeExe);
  addFile(files, `${prefix}/app/src/index.js`, path.join(agentDir, "src", "index.js"));
  addFile(files, `${prefix}/app/package.json`, path.join(agentDir, "package.json"));
  files.push({
    name: `${prefix}/PACK_VERSION.txt`,
    data: Buffer.from(`${PACK_VERSION}\nnode=${NODE_VERSION}-win-x64\n`, "utf8"),
  });

  const zip = buildZip(files);
  if (zip.length < 5_000_000) {
    throw new Error(`Win pack unexpectedly small (${zip.length} bytes) — node.exe missing?`);
  }
  fs.writeFileSync(outFile, zip);
  const sha = createHash("sha256").update(zip).digest("hex").slice(0, 12);
  console.log(
    `Packed ${files.length} files -> ${path.relative(root, outFile)} (${zip.length} bytes, sha256:${sha}, pack ${PACK_VERSION})`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
