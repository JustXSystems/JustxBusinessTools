/**
 * Case-sensitive rewrite of legacy brand spellings → Justxsystems across the repo.
 *
 * Covers both JustX* (prior pass) and bare Justx* product chrome that still
 * said "Justx BOS / Justx IMS / Justx Systems" instead of Justxsystems.
 *
 * Protects:
 * - github.com/JustXSystems/ and JustxBusinessTools (org / repo identity)
 * - X-JustX-* webhook / protocol headers
 * - LEGACY_* / BRAND_RENAME_RULES / THEME_PRESET_ALIASES match lists
 * - Justx@… test passwords, lowercase justx paths/packages
 * - node_modules, dist, .git, binary/media noise
 *
 * Usage: node scripts/rename-brand-justxsystems.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Longest-first phrase swaps (before bare-token regex). */
const PHRASE_RULES = [
  ["JustXSystems", "Justxsystems"],
  ["JustxSystems", "Justxsystems"],
  ["JustX Business Tools", "Justxsystems Business Tools"],
  ["Justx Business Tools", "Justxsystems Business Tools"],
  ["JustX Systems LLP", "Justxsystems LLP"],
  ["Justx Systems LLP", "Justxsystems LLP"],
  ["JustX Systems", "Justxsystems"],
  ["Justx Systems", "Justxsystems"],
  ["JustX Sync Agent", "Justxsystems Sync Agent"],
  ["Justx Sync Agent", "Justxsystems Sync Agent"],
];

const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  ".git",
  ".next",
  "coverage",
  "uploads",
  "agent-transcripts",
]);

const EXT = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".html",
  ".css",
  ".sql",
  ".ps1",
  ".cmd",
  ".sh",
  ".yml",
  ".yaml",
  ".txt",
  ".svg",
  ".xml",
]);

const SKIP_FILES = new Set([
  // This script + DB migrations + brand helpers keep literal old tokens / regexes.
  path.join("scripts", "rename-brand-justxsystems.mjs"),
  path.join("mysql", "migrations", "035_rename_brand_justxsystems.mjs"),
  path.join("mysql", "migrations", "042_rename_brand_justx_to_justxsystems.mjs"),
  path.join("shared", "src", "brand.ts"),
]);

function rename(text) {
  let s = text;
  const shields = [];
  const shield = (re) => {
    s = s.replace(re, (m) => {
      const i = shields.length;
      shields.push(m);
      return `\u0000SHIELD${i}\u0000`;
    });
  };

  // Already-correct brand + repo/org identity + protocol headers
  shield(/Justxsystems/g);
  shield(/github\.com\/JustXSystems\//g);
  shield(/JustxBusinessTools/g);
  shield(/\bX-JustX-[A-Za-z0-9-]+/g);
  // Test passwords like Justx@2026
  shield(/Justx@[^\s"'`]+/g);

  // Keep exact legacy tokens in brand coerce lists, rename rules, and theme aliases
  if (
    text.includes("LEGACY_") ||
    text.includes("BRAND_RENAME_RULES") ||
    text.includes("THEME_PRESET_ALIASES") ||
    text.includes("PHRASE_RULES")
  ) {
    shield(
      /"JustXSystems(?: LLP)?"|"JustxSystems(?: LLP)?"|"JustX(?: Systems(?: LLP)?| Business Tools| Sync Agent| BOS \((?:Light|Dark)\)| IMS \((?:Light|Dark)\))?"|"Justx(?: Systems(?: LLP)?| Business Tools| Sync Agent)?"|"Powered by JustX[^"]*"|"Powered by Justx[^"]*"/g,
    );
    shield(
      /\["JustXSystems", "Justxsystems"\]|\["JustxSystems", "Justxsystems"\]|\["JustX Business Tools", "Justxsystems Business Tools"\]|\["Justx Business Tools", "Justxsystems Business Tools"\]|\["JustX Systems LLP", "Justxsystems LLP"\]|\["Justx Systems LLP", "Justxsystems LLP"\]|\["JustX Systems", "Justxsystems"\]|\["Justx Systems", "Justxsystems"\]|\["JustX Sync Agent", "Justxsystems Sync Agent"\]|\["Justx Sync Agent", "Justxsystems Sync Agent"\]|\["JustX", "Justxsystems"\]|\["Justx", "Justxsystems"\]/g,
    );
    shield(
      /"JustXSystems Electric"|"JustXSystems Light"|"JustX BOS \((?:Light|Dark)\)"|"JustX IMS \((?:Light|Dark)\)"|"Justx BOS \((?:Light|Dark)\)"|"Justx IMS \((?:Light|Dark)\)"/g,
    );
  }

  for (const [from, to] of PHRASE_RULES) {
    if (s.includes(from)) s = s.split(from).join(to);
  }
  // Bare brand token only when not already followed by systems/Systems
  s = s.replace(/JustX(?![Ss]ystems)/g, "Justxsystems");
  s = s.replace(/Justx(?![Ss]ystems)/g, "Justxsystems");

  s = s.replace(/\u0000SHIELD(\d+)\u0000/g, (_, i) => shields[Number(i)]);
  return s;
}

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith(".") && ent.name !== ".env.example") {
      if (SKIP_DIRS.has(ent.name)) continue;
    }
    if (SKIP_DIRS.has(ent.name)) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, out);
    else if (EXT.has(path.extname(ent.name).toLowerCase())) out.push(full);
  }
  return out;
}

const files = walk(root);
let changed = 0;
for (const file of files) {
  const rel = path.relative(root, file);
  if (SKIP_FILES.has(rel)) continue;
  if (rel === "SolarSample.html") continue;
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    continue;
  }
  if (!raw.includes("JustX") && !raw.includes("Justx")) continue;
  const next = rename(raw);
  if (next === raw) continue;
  fs.writeFileSync(file, next);
  changed += 1;
  console.log(rel);
}
console.log(`--- files changed: ${changed}`);
