/**
 * Visual matrix: BOM preview with each schedule column toggled off.
 * Writes HTML + PNG screenshots under .tmp/bom-column-visual/
 *
 *   cd web && npx tsx scripts/bom-column-visual.tsx
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium } from "playwright";
import {
  BOM_CONFIGURABLE_COLUMNS,
  BOM_REQUIRED_COLUMNS,
  sampleBomPaperModel,
  withCommercialSample,
  type BomPaperPurpose,
  type BomScheduleColumn,
} from "../lib/ims/bom-paper";
import { BomPaper, type BomPaperModel } from "../components/ims/bom/BomPaper";

const __dirname = dirname(fileURLToPath(import.meta.url));
const webRoot = join(__dirname, "..");
const outDir = join(webRoot, ".tmp", "bom-column-visual");

const PURPOSES: BomPaperPurpose[] = ["proposal", "technical", "field", "executive", "share"];

function modelWith(purpose: BomPaperPurpose, columns: BomScheduleColumn[] | null): BomPaperModel {
  const sample = withCommercialSample(sampleBomPaperModel("Column Test Co", "epc"));
  return {
    ...sample,
    template: purpose,
    industryPack: "epc",
    tone: "neutral",
    density: "comfort",
    hideMargin: false,
    scheduleColumns: columns,
  } as BomPaperModel;
}

function cases(): Array<{ id: string; purpose: BomPaperPurpose; columns: BomScheduleColumn[] }> {
  const optional = BOM_CONFIGURABLE_COLUMNS.filter((c) => !(BOM_REQUIRED_COLUMNS as readonly string[]).includes(c));
  const out: Array<{ id: string; purpose: BomPaperPurpose; columns: BomScheduleColumn[] }> = [];
  for (const purpose of PURPOSES) {
    out.push({
      id: `${purpose}__full`,
      purpose,
      columns: [...BOM_CONFIGURABLE_COLUMNS],
    });
    out.push({
      id: `${purpose}__sparse`,
      purpose,
      columns: ["item", "qty"],
    });
    for (const off of optional) {
      out.push({
        id: `${purpose}__off-${off}`,
        purpose,
        columns: BOM_CONFIGURABLE_COLUMNS.filter((c) => c !== off) as BomScheduleColumn[],
      });
    }
  }
  return out;
}

function loadCss(): string {
  const files = [
    join(webRoot, "components/bos/styles/bos.patterns.css"),
    join(webRoot, "components/ims/bom/bom.css"),
  ];
  return files.map((f) => readFileSync(f, "utf8")).join("\n");
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const css = loadCss();
  const all = cases();
  const sections = all
    .map(({ id, purpose, columns }) => {
      const markup = renderToStaticMarkup(createElement(BomPaper, { model: modelWith(purpose, columns) }));
      return `<section class="case" id="${id}" data-case="${id}">
  <h2>${id}</h2>
  <div class="bos">${markup}</div>
</section>`;
    })
    .join("\n");

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>BOM column visual matrix</title>
<style>
  body { margin: 0; background: #e8ecf1; font-family: system-ui, sans-serif; }
  h2 { margin: 0 0 8px; font-size: 13px; color: #475569; font-weight: 650; }
  .case { padding: 16px 20px 28px; border-bottom: 1px solid #cbd5e1; }
  .bos { max-width: 860px; }
  .bos .bos-inv-paper { position: static !important; box-shadow: none !important; }
  ${css}
</style>
</head>
<body>
${sections}
</body>
</html>`;

  const htmlPath = join(outDir, "matrix.html");
  writeFileSync(htmlPath, html, "utf8");
  console.log(`Wrote ${htmlPath} (${all.length} cases)`);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 920, height: 1200 } });
  await page.goto(`file://${htmlPath.replace(/\\/g, "/")}`, { waitUntil: "load" });

  const shotDir = join(outDir, "shots");
  mkdirSync(shotDir, { recursive: true });

  // Screenshot key combos for visual review (not every off-toggle).
  const keyIds = [
    "proposal__full",
    "proposal__sparse",
    "proposal__off-amount",
    "proposal__off-rate",
    "proposal__off-remarks",
    "proposal__off-make",
    "proposal__off-index",
    "technical__full",
    "technical__sparse",
    "technical__off-amount",
    "field__full",
    "field__sparse",
    "executive__full",
    "executive__sparse",
    "executive__off-amount",
    "share__full",
    "share__sparse",
    "share__off-amount",
  ];

  for (const id of keyIds) {
    const el = page.locator(`[data-case="${id}"]`);
    if ((await el.count()) === 0) continue;
    const path = join(shotDir, `${id}.png`);
    await el.screenshot({ path, animations: "disabled" });
    console.log(`shot ${id}`);
  }

  await browser.close();
  console.log(`Done → ${shotDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
