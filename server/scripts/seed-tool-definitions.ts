import "dotenv/config";
import { pool } from "../src/db.js";

const PLATFORM_TRACKERS = [
  "paymenttracker",
  "vendors",
  "stock",
  "projects",
  "amc",
  "servicetasks",
  "installation",
  "sitesurvey",
  "pricelist",
  "creditlimit",
  "targettracker",
  "dealerorders",
  "visitors",
];

const GST_RATES = [0, 0.25, 3, 5, 12, 18, 28];
const TDS_SECTIONS = [
  { code: "194C - Contractor (Individual/HUF)", rate: 1 },
  { code: "194C - Contractor (Others)", rate: 2 },
  { code: "194J - Professional/Technical Fees", rate: 10 },
  { code: "194I - Rent (Plant/Machinery)", rate: 2 },
  { code: "194I - Rent (Land/Building)", rate: 10 },
  { code: "194H - Commission/Brokerage", rate: 5 },
  { code: "194Q - Purchase of Goods", rate: 0.1 },
  { code: "Custom Rate", rate: 0 },
];

async function seedTool(id: string, toolType: string, definition: Record<string, unknown>) {
  await pool.query(
    `INSERT INTO tool_definitions (id, organization_id, tool_type, definition, is_platform, published_version)
     VALUES (:id, NULL, :toolType, :definition, 1, 1)
     ON DUPLICATE KEY UPDATE
       tool_type = :toolType,
       definition = :definition,
       is_platform = 1`,
    { id, toolType, definition: JSON.stringify(definition) },
  );
}

async function main() {
  for (const id of PLATFORM_TRACKERS) {
    await seedTool(id, "tracker", { type: "tracker", key: id });
  }

  await seedTool("gstcalc", "calculator", {
    type: "calculator",
    gstRates: GST_RATES,
    formula: "add: base + base*rate/100; remove: base = total/(1+rate/100)",
  });

  await seedTool("tdscalc", "calculator", {
    type: "calculator",
    tdsSections: TDS_SECTIONS,
    formula: "tds = gross * rate / 100",
  });

  await seedTool("taxcalc", "calculator", {
    type: "calculator",
    newStdDeduction: 75000,
    oldStdDeduction: 50000,
    newRebateThreshold: 1200000,
    oldRebateThreshold: 500000,
    cessRate: 0.04,
    newTaxBrackets: [
      { upto: 800000, rate: 5 },
      { upto: 1200000, rate: 10 },
      { upto: 1600000, rate: 15 },
      { upto: 2000000, rate: 20 },
      { upto: 2400000, rate: 25 },
      { upto: 999999999, rate: 30 },
    ],
    oldTaxBrackets: [
      { upto: 500000, rate: 5 },
      { upto: 1000000, rate: 20 },
      { upto: 999999999, rate: 30 },
    ],
  });

  await seedTool("profitcalc", "calculator", {
    type: "calculator",
    defaultCost: 1000,
    defaultSell: 1500,
    defaultQty: 1,
  });

  await seedTool("emicalc", "calculator", {
    type: "calculator",
    defaultPrincipal: 500000,
    defaultRateAnnual: 10.5,
    defaultMonths: 60,
  });

  await seedTool("loancalc", "calculator", {
    type: "calculator",
    defaultPrincipal: 1000000,
    defaultRateAnnual: 9,
    defaultYears: 5,
  });

  await seedTool("solarroi", "calculator", {
    type: "calculator",
    defaultCost: 250000,
    defaultSizeKw: 5,
    defaultBillBefore: 8000,
    defaultBillAfter: 1500,
    defaultLifeYears: 25,
  });

  await seedTool("dealercommission", "calculator", {
    type: "calculator",
    defaultSale: 100000,
    defaultRatePct: 5,
    defaultTdsPct: 5,
  });

  for (const id of ["quotation", "salesorder", "invoice", "po"]) {
    await seedTool(id, "document", { type: "document", key: id });
  }

  console.log("Platform tool definitions seeded.");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
