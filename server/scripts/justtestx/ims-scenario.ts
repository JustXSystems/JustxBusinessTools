/**
 * JustTestX IMS — Dealer narrative: electrical / networking distribution arm.
 * Data window = rolling 2 years ending today (Asia/Kolkata).
 */
import {
  computeTotals,
  DEFAULT_TAXONOMY,
  DEFAULT_PERMISSIONS,
  DEFAULT_REMINDERS,
  formatDocNo,
  fiscalYearLabel,
  todayISO,
  type ImsLineInput,
} from "../../src/ims/logic.js";
import { createHash } from "crypto";
import { addDays, addMonths, daysInMonth, eachMonth, fingerprint, tid, weekday, COMPANY, GSTIN } from "./lib.js";
import { buildBomSeedWorld, type BomSeedWorld } from "./ims-bom-scenario.js";

/** Tiny valid PDF used as seed artifact for confirmed BOM downloads. */
const SEED_PDF_BYTES = Buffer.from(
  "%PDF-1.1\n1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] >>endobj\ntrailer<< /Size 4 /Root 1 0 R >>\n%%EOF\n",
  "utf8",
);
const SEED_PDF_B64 = SEED_PDF_BYTES.toString("base64");
const SEED_PDF_SHA = createHash("sha256").update(SEED_PDF_BYTES).digest("hex");

export const IMS_TODAY = todayISO(new Date(), "Asia/Kolkata");
export const IMS_WINDOW_START = addDays(IMS_TODAY, -730);
export const OWNER_NAME = "Santhosh HS";

export const IMS_SETTINGS = {
  businessName: `${COMPANY} Distribution`,
  businessType: "distributor",
  gstin: GSTIN,
  state: "Karnataka",
  stateCode: "29",
  address: "4th Floor, JustTestX Hub, Indiranagar, Bengaluru 560038",
  phone: "+91 80 4567 2100",
  email: "ims@justtestx.example",
  fiscalYearStart: 4,
  poPrefix: "PO",
  invoicePrefix: "SI",
  billPrefix: "PB",
  returnPrefix: "RT",
  checkPrefix: "SC",
  ticketPrefix: "TK",
  bomPaperTemplate: "proposal",
  bomIndustryPack: "general",
  bomPaperTone: "neutral",
  bomPaperDensity: "comfort",
  bomHideMargin: 0,
  poApprovalLimit: 75_000,
  draftPoPurgeDays: 7,
  paymentTermsDays: 30,
  defaultGstRate: 18,
  allowNegativeStock: 0,
  /** On so Excise module is visible (distributor can still keep an excise register). */
  exciseEnabled: 1,
  permissions: DEFAULT_PERMISSIONS,
  taxonomy: {
    ...DEFAULT_TAXONOMY,
    brands: ["Havells", "Polycab", "Legrand", "Schneider", "Syska", "Finolex", "Cisco", "TP-Link", "APC", "D-Link", "JustTestX"],
    locations: ["Main store", "Dispatch bay", "Returns quarantine"],
  },
  reminders: { ...DEFAULT_REMINDERS, autoEnabled: true, channels: ["whatsapp", "email"] as Array<"whatsapp" | "sms" | "email"> },
  terms: "Goods once sold are not returnable except for manufacturing defects within 7 days. Payment due as per invoice.",
};

export type ImsParty = {
  key: string;
  kind: "supplier" | "customer" | "both";
  name: string;
  contact: string;
  mobile: string;
  email: string;
  gstin: string | null;
  city: string;
  state: string;
  stateCode: string;
  creditLimit: number;
  terms: number;
  tags: string;
};

export const IMS_SUPPLIERS: ImsParty[] = [
  { key: "havells", kind: "supplier", name: "Havells India Ltd", contact: "Ramesh K", mobile: "+91 98760 10001", email: "dealer@havells.example", gstin: "09AAACH1234A1Z5", city: "Noida", state: "Uttar Pradesh", stateCode: "09", creditLimit: 0, terms: 45, tags: "brand,lighting" },
  { key: "polycab", kind: "supplier", name: "Polycab Wires", contact: "Sneha P", mobile: "+91 98760 10002", email: "b2b@polycab.example", gstin: "27AAACP5678B1Z6", city: "Mumbai", state: "Maharashtra", stateCode: "27", creditLimit: 0, terms: 30, tags: "cables" },
  { key: "legrand", kind: "supplier", name: "Legrand India", contact: "Anil M", mobile: "+91 98760 10003", email: "orders@legrand.example", gstin: "29AAACL9012C1Z7", city: "Bengaluru", state: "Karnataka", stateCode: "29", creditLimit: 0, terms: 30, tags: "switches" },
  { key: "schneider", kind: "supplier", name: "Schneider Electric", contact: "Priya S", mobile: "+91 98760 10004", email: "dist@schneider.example", gstin: "33AAACS3456D1Z8", city: "Chennai", state: "Tamil Nadu", stateCode: "33", creditLimit: 0, terms: 45, tags: "mcb" },
  { key: "cisco", kind: "supplier", name: "Cisco Systems India", contact: "Vikram D", mobile: "+91 98760 10005", email: "partner@cisco.example", gstin: "29AAACC7890E1Z9", city: "Bengaluru", state: "Karnataka", stateCode: "29", creditLimit: 0, terms: 30, tags: "networking" },
  { key: "tplink", kind: "supplier", name: "TP-Link India", contact: "Meera J", mobile: "+91 98760 10006", email: "channel@tplink.example", gstin: "07AAACT2345F1Z0", city: "New Delhi", state: "Delhi", stateCode: "07", creditLimit: 0, terms: 21, tags: "wifi" },
  { key: "apc", kind: "supplier", name: "APC by Schneider", contact: "Imran A", mobile: "+91 98760 10007", email: "ups@apc.example", gstin: "27AAACA6789G1Z1", city: "Pune", state: "Maharashtra", stateCode: "27", creditLimit: 0, terms: 30, tags: "power" },
  { key: "local", kind: "supplier", name: "Metro Electrical Wholesale", contact: "Fatima K", mobile: "+91 98760 10008", email: "sales@metroelec.example", gstin: "29AAACM0123H1Z2", city: "Bengaluru", state: "Karnataka", stateCode: "29", creditLimit: 0, terms: 15, tags: "local" },
];

export const IMS_CUSTOMERS: ImsParty[] = [
  { key: "cascade", kind: "customer", name: "Cascade Fintech Pvt Ltd", contact: "AP Desk", mobile: "+91 80 2222 1001", email: "ap@cascadefintech.example", gstin: "29CACAD1234F1Z2", city: "Bengaluru", state: "Karnataka", stateCode: "29", creditLimit: 5_00_000, terms: 30, tags: "enterprise,ams" },
  { key: "meridian", kind: "customer", name: "Meridian Retail Pvt Ltd", contact: "IT Store", mobile: "+91 80 3333 2002", email: "it@meridianretail.example", gstin: "29MERID5678G1Z3", city: "Bengaluru", state: "Karnataka", stateCode: "29", creditLimit: 3_00_000, terms: 21, tags: "retail" },
  { key: "bluepeak", kind: "customer", name: "BluePeak Logistics Ltd", contact: "Projects", mobile: "+91 22 4444 3003", email: "projects@bluepeak.example", gstin: "27BLUEP9012H1Z4", city: "Mumbai", state: "Maharashtra", stateCode: "27", creditLimit: 8_00_000, terms: 45, tags: "logistics,igst" },
  { key: "northwind", kind: "customer", name: "Northwind Hospitals", contact: "Facilities", mobile: "+91 11 5555 4004", email: "cio@northwind.example", gstin: "07NORTH3456I1Z5", city: "New Delhi", state: "Delhi", stateCode: "07", creditLimit: 4_00_000, terms: 30, tags: "healthcare" },
  { key: "oriole", kind: "customer", name: "Oriole Manufacturing", contact: "Plant IT", mobile: "+91 44 6666 5005", email: "digital@oriole.example", gstin: "33ORIOL7890J1Z6", city: "Chennai", state: "Tamil Nadu", stateCode: "33", creditLimit: 6_00_000, terms: 30, tags: "factory" },
  { key: "harbor", kind: "customer", name: "Harbor Education Trust", contact: "Admin", mobile: "+91 80 7777 6006", email: "tech@harboredu.example", gstin: "29HARBO2345K1Z7", city: "Bengaluru", state: "Karnataka", stateCode: "29", creditLimit: 2_00_000, terms: 15, tags: "edu" },
  { key: "zenith", kind: "customer", name: "Zenith AgriTech", contact: "Ops", mobile: "+91 79 8888 7007", email: "ops@zenithagri.example", gstin: "24ZENIT6789L1Z8", city: "Ahmedabad", state: "Gujarat", stateCode: "24", creditLimit: 2_50_000, terms: 30, tags: "agri" },
  { key: "pixel", kind: "customer", name: "PixelForge Media LLP", contact: "Studio", mobile: "+91 80 9999 8008", email: "hello@pixelforge.example", gstin: null, city: "Bengaluru", state: "Karnataka", stateCode: "29", creditLimit: 50_000, terms: 7, tags: "sme,unregistered" },
  { key: "cashmh", kind: "customer", name: "Walk-in Retail — Mumbai Expo", contact: "Counter", mobile: "+91 98200 30001", email: "cash@mumbai-expo.example", gstin: null, city: "Mumbai", state: "Maharashtra", stateCode: "27", creditLimit: 0, terms: 0, tags: "b2c,unregistered,igst" },
  { key: "bright", kind: "customer", name: "Bright Homes Electricals", contact: "Owner", mobile: "+91 98450 20001", email: "orders@brighthomes.example", gstin: "29BRIGH1111A1Z1", city: "Mysuru", state: "Karnataka", stateCode: "29", creditLimit: 1_50_000, terms: 15, tags: "dealer" },
  { key: "spark", kind: "customer", name: "Sparkline Contractors", contact: "Site Lead", mobile: "+91 98450 20002", email: "po@sparkline.example", gstin: "29SPARK2222B1Z2", city: "Bengaluru", state: "Karnataka", stateCode: "29", creditLimit: 2_00_000, terms: 21, tags: "contractor" },
  { key: "netzone", kind: "customer", name: "NetZone Cyber Cafe Chain", contact: "Purchase", mobile: "+91 98450 20003", email: "buy@netzone.example", gstin: "29NETZO3333C1Z3", city: "Hubballi", state: "Karnataka", stateCode: "29", creditLimit: 1_00_000, terms: 10, tags: "retail" },
  { key: "govt", kind: "customer", name: "Karnataka PWD Stores", contact: "Indent Desk", mobile: "+91 80 2222 3000", email: "stores@pwd.example", gstin: "29GOVKA4444D1Z4", city: "Bengaluru", state: "Karnataka", stateCode: "29", creditLimit: 10_00_000, terms: 60, tags: "govt" },
];

/** SKUs that stop selling after ~8 months so Dead Stock / idle aging has rows. */
const DEAD_STOCK_KEYS = new Set(["iron", "exh", "pdu", "wifi6", "tester", "tool", "plate"]);

export type ImsItemDef = {
  key: string;
  name: string;
  sku: string;
  barcode: string;
  category: string;
  brand: string;
  unit: string;
  hsn: string;
  gst: number;
  purchase: number;
  sell: number;
  mrp: number;
  min: number;
  max: number;
  reorder: number;
  opening: number;
  supplierKey: string;
  location: string;
};

/** ~40 SKUs across lighting, cables, switches, MCB, networking, UPS. */
export function buildCatalog(): ImsItemDef[] {
  const defs: Array<Omit<ImsItemDef, "barcode" | "opening" | "location"> & { opening?: number }> = [
    // Opening stocks sized for ~2 years of near-daily high-volume sales + BOM DCs.
    { key: "led12", name: "LED Panel 12W Square", sku: "HV-LED-12", category: "Lighting", brand: "Havells", unit: "pcs", hsn: "9405", gst: 18, purchase: 180, sell: 245, mrp: 299, min: 40, max: 800, reorder: 120, supplierKey: "havells", opening: 400 },
    { key: "led18", name: "LED Panel 18W Round", sku: "HV-LED-18", category: "Lighting", brand: "Havells", unit: "pcs", hsn: "9405", gst: 18, purchase: 240, sell: 325, mrp: 399, min: 30, max: 600, reorder: 100, supplierKey: "havells", opening: 300 },
    { key: "tube20", name: "LED Batten 20W", sku: "SY-BAT-20", category: "Lighting", brand: "Syska", unit: "pcs", hsn: "9405", gst: 18, purchase: 210, sell: 289, mrp: 349, min: 25, max: 500, reorder: 80, supplierKey: "local", opening: 220 },
    { key: "bulb9", name: "LED Bulb 9W B22", sku: "SY-BLB-9", category: "Lighting", brand: "Syska", unit: "pcs", hsn: "8539", gst: 12, purchase: 55, sell: 79, mrp: 99, min: 100, max: 3000, reorder: 400, supplierKey: "local", opening: 1200 },
    { key: "cab15", name: "1.5 sq.mm FR Copper Wire (90m)", sku: "PC-WR-15", category: "Wiring & Cables", brand: "Polycab", unit: "coil", hsn: "8544", gst: 18, purchase: 1850, sell: 2250, mrp: 2499, min: 20, max: 200, reorder: 40, supplierKey: "polycab", opening: 90 },
    { key: "cab25", name: "2.5 sq.mm FR Copper Wire (90m)", sku: "PC-WR-25", category: "Wiring & Cables", brand: "Polycab", unit: "coil", hsn: "8544", gst: 18, purchase: 2950, sell: 3550, mrp: 3999, min: 15, max: 160, reorder: 30, supplierKey: "polycab", opening: 70 },
    { key: "cab40", name: "4.0 sq.mm FR Copper Wire (90m)", sku: "PC-WR-40", category: "Wiring & Cables", brand: "Polycab", unit: "coil", hsn: "8544", gst: 18, purchase: 4200, sell: 5100, mrp: 5699, min: 10, max: 120, reorder: 25, supplierKey: "polycab", opening: 50 },
    { key: "lan", name: "Cat6 UTP Cable Box 305m", sku: "DL-CAT6", category: "Wiring & Cables", brand: "D-Link", unit: "box", hsn: "8544", gst: 18, purchase: 6200, sell: 7800, mrp: 8999, min: 8, max: 60, reorder: 15, supplierKey: "local", opening: 36 },
    { key: "sw1", name: "1-Way Modular Switch 10A", sku: "LG-SW-1W", category: "Switches & Sockets", brand: "Legrand", unit: "pcs", hsn: "8536", gst: 18, purchase: 48, sell: 72, mrp: 89, min: 200, max: 4000, reorder: 600, supplierKey: "legrand", opening: 1800 },
    { key: "sock", name: "6A Socket Outlet", sku: "LG-SK-6A", category: "Switches & Sockets", brand: "Legrand", unit: "pcs", hsn: "8536", gst: 18, purchase: 95, sell: 135, mrp: 169, min: 150, max: 2400, reorder: 400, supplierKey: "legrand", opening: 1200 },
    { key: "plate", name: "Modular Plate 8M", sku: "LG-PL-8M", category: "Switches & Sockets", brand: "Legrand", unit: "pcs", hsn: "3926", gst: 18, purchase: 110, sell: 165, mrp: 199, min: 80, max: 1200, reorder: 200, supplierKey: "legrand", opening: 500 },
    { key: "mcb16", name: "MCB SP 16A C-Curve", sku: "SC-MCB-16", category: "Switchgear & MCB", brand: "Schneider", unit: "pcs", hsn: "8536", gst: 18, purchase: 185, sell: 255, mrp: 299, min: 50, max: 800, reorder: 120, supplierKey: "schneider", opening: 360 },
    { key: "mcb32", name: "MCB SP 32A C-Curve", sku: "SC-MCB-32", category: "Switchgear & MCB", brand: "Schneider", unit: "pcs", hsn: "8536", gst: 18, purchase: 210, sell: 289, mrp: 349, min: 40, max: 600, reorder: 100, supplierKey: "schneider", opening: 280 },
    { key: "rccb", name: "RCCB 2P 40A 30mA", sku: "SC-RCCB-40", category: "Switchgear & MCB", brand: "Schneider", unit: "pcs", hsn: "8536", gst: 18, purchase: 1450, sell: 1890, mrp: 2199, min: 15, max: 120, reorder: 30, supplierKey: "schneider", opening: 60 },
    { key: "db8", name: "Distribution Board 8-Way SPN", sku: "HV-DB-8", category: "Switchgear & MCB", brand: "Havells", unit: "pcs", hsn: "8537", gst: 18, purchase: 980, sell: 1350, mrp: 1599, min: 10, max: 100, reorder: 20, supplierKey: "havells", opening: 45 },
    { key: "fan48", name: "Ceiling Fan 1200mm", sku: "HV-FAN-48", category: "Fans", brand: "Havells", unit: "pcs", hsn: "8414", gst: 18, purchase: 1850, sell: 2499, mrp: 2899, min: 12, max: 120, reorder: 30, supplierKey: "havells", opening: 70 },
    { key: "exh", name: "Exhaust Fan 225mm", sku: "HV-EXH-9", category: "Fans", brand: "Havells", unit: "pcs", hsn: "8414", gst: 18, purchase: 920, sell: 1299, mrp: 1499, min: 10, max: 100, reorder: 25, supplierKey: "havells", opening: 55 },
    { key: "iron", name: "Dry Iron 1000W", sku: "HV-IRN-1K", category: "Home Appliances", brand: "Havells", unit: "pcs", hsn: "8516", gst: 18, purchase: 780, sell: 1099, mrp: 1299, min: 8, max: 80, reorder: 20, supplierKey: "havells", opening: 40 },
    { key: "gpon", name: "Cisco Catalyst 9200 24P", sku: "CS-C9200-24", category: "Industrial Motors & Drives", brand: "Cisco", unit: "pcs", hsn: "8517", gst: 18, purchase: 1_85_000, sell: 2_25_000, mrp: 2_49_000, min: 2, max: 20, reorder: 3, supplierKey: "cisco", opening: 8 },
    { key: "ap", name: "Cisco Meraki MR36 AP", sku: "CS-MR36", category: "Industrial Motors & Drives", brand: "Cisco", unit: "pcs", hsn: "8517", gst: 18, purchase: 28_500, sell: 34_900, mrp: 39_999, min: 4, max: 50, reorder: 8, supplierKey: "cisco", opening: 24 },
    { key: "router", name: "TP-Link Archer AX55", sku: "TP-AX55", category: "Tools & Equipment", brand: "TP-Link", unit: "pcs", hsn: "8517", gst: 18, purchase: 6_200, sell: 7_999, mrp: 8_999, min: 10, max: 100, reorder: 20, supplierKey: "tplink", opening: 50 },
    { key: "sw24", name: "TP-Link 24-Port Gigabit Switch", sku: "TP-SG1024", category: "Tools & Equipment", brand: "TP-Link", unit: "pcs", hsn: "8517", gst: 18, purchase: 4_800, sell: 6_299, mrp: 6_999, min: 8, max: 60, reorder: 15, supplierKey: "tplink", opening: 35 },
    { key: "ups1", name: "APC Back-UPS 1100VA", sku: "APC-BX1100", category: "Tools & Equipment", brand: "APC", unit: "pcs", hsn: "8504", gst: 18, purchase: 7_200, sell: 9_499, mrp: 10_999, min: 6, max: 50, reorder: 12, supplierKey: "apc", opening: 28 },
    { key: "ups2", name: "APC Smart-UPS 1500VA", sku: "APC-SMT1500", category: "Tools & Equipment", brand: "APC", unit: "pcs", hsn: "8504", gst: 18, purchase: 32_000, sell: 39_900, mrp: 44_999, min: 3, max: 30, reorder: 6, supplierKey: "apc", opening: 14 },
    { key: "tool", name: "Crimping Tool RJ45", sku: "JX-CRIMP", category: "Tools & Equipment", brand: "JustTestX", unit: "pcs", hsn: "8205", gst: 18, purchase: 350, sell: 549, mrp: 699, min: 15, max: 120, reorder: 30, supplierKey: "local", opening: 80 },
    { key: "tester", name: "Cable Continuity Tester", sku: "JX-TEST", category: "Tools & Equipment", brand: "JustTestX", unit: "pcs", hsn: "9030", gst: 18, purchase: 420, sell: 699, mrp: 849, min: 10, max: 80, reorder: 20, supplierKey: "local", opening: 50 },
    { key: "patch", name: "Cat6 Patch Cord 1m (pack of 10)", sku: "DL-PC-1M", category: "Wiring & Cables", brand: "D-Link", unit: "pack", hsn: "8544", gst: 18, purchase: 480, sell: 699, mrp: 799, min: 30, max: 400, reorder: 80, supplierKey: "local", opening: 180 },
    { key: "race", name: "PVC Casing Caping 25mm (2m)", sku: "FX-CAS-25", category: "Wiring & Cables", brand: "Finolex", unit: "pcs", hsn: "3917", gst: 5, purchase: 35, sell: 55, mrp: 69, min: 200, max: 4000, reorder: 600, supplierKey: "local", opening: 1500 },
    { key: "gland", name: "Cable Gland PG-13.5", sku: "JX-GL-13", category: "Tools & Equipment", brand: "JustTestX", unit: "pcs", hsn: "7419", gst: 18, purchase: 18, sell: 32, mrp: 45, min: 100, max: 2000, reorder: 300, supplierKey: "local", opening: 800 },
    { key: "tape", name: "Insulation Tape Black (pack)", sku: "JX-TAP-BK", category: "Tools & Equipment", brand: "JustTestX", unit: "pack", hsn: "3919", gst: 12, purchase: 45, sell: 75, mrp: 99, min: 50, max: 800, reorder: 120, supplierKey: "local", opening: 350 },
    { key: "led40", name: "Street Light LED 40W", sku: "HV-SL-40", category: "Lighting", brand: "Havells", unit: "pcs", hsn: "9405", gst: 18, purchase: 1850, sell: 2450, mrp: 2799, min: 8, max: 80, reorder: 15, supplierKey: "havells", opening: 32 },
    { key: "mcb63", name: "MCB TP 63A", sku: "SC-MCB-63T", category: "Switchgear & MCB", brand: "Schneider", unit: "pcs", hsn: "8536", gst: 18, purchase: 980, sell: 1350, mrp: 1599, min: 8, max: 60, reorder: 15, supplierKey: "schneider", opening: 36 },
    { key: "wifi6", name: "TP-Link Deco X20 Mesh (3-pack)", sku: "TP-DX20-3", category: "Tools & Equipment", brand: "TP-Link", unit: "set", hsn: "8517", gst: 18, purchase: 14_500, sell: 18_999, mrp: 21_999, min: 4, max: 40, reorder: 8, supplierKey: "tplink", opening: 18 },
    { key: "pdu", name: "APC Rack PDU Basic 1U", sku: "APC-PDU-1U", category: "Tools & Equipment", brand: "APC", unit: "pcs", hsn: "8537", gst: 18, purchase: 8_800, sell: 11_500, mrp: 12_999, min: 3, max: 30, reorder: 6, supplierKey: "apc", opening: 14 },
    { key: "inactive", name: "Legacy Halogen Flood 500W (discontinued)", sku: "HV-HAL-500", category: "Lighting", brand: "Havells", unit: "pcs", hsn: "9405", gst: 18, purchase: 450, sell: 0, mrp: 699, min: 0, max: 0, reorder: 0, supplierKey: "havells", opening: 5 },
  ];
  return defs.map((d, i) => ({
    ...d,
    barcode: `8901001${String(100000 + i).slice(-6)}`,
    opening: d.opening ?? 20,
    location: "Main store",
  }));
}

export function partyId(key: string) {
  return tid(`ims:party:${key}`);
}
export function itemId(key: string) {
  return tid(`ims:item:${key}`);
}

function intra(customerState: string): boolean {
  return customerState.trim().toLowerCase() === "karnataka";
}

function isWorkday(date: string): boolean {
  const w = weekday(date);
  return w !== 0 && w !== 6;
}

type StockMap = Map<string, number>;

export type BuiltImsWorld = {
  items: ImsItemDef[];
  movements: Array<Record<string, unknown>>;
  pos: Array<Record<string, unknown>>;
  bills: Array<Record<string, unknown>>;
  invoices: Array<Record<string, unknown>>;
  payments: Array<Record<string, unknown>>;
  returns: Array<Record<string, unknown>>;
  checks: Array<Record<string, unknown>>;
  expenses: Array<Record<string, unknown>>;
  closings: Array<Record<string, unknown>>;
  arActivity: Array<Record<string, unknown>>;
  ledger: Array<Record<string, unknown>>;
  payRuns: Array<Record<string, unknown>>;
  fieldTasks: Array<Record<string, unknown>>;
  fieldVisits: Array<Record<string, unknown>>;
  fieldCheckins: Array<Record<string, unknown>>;
  bankTxns: Array<Record<string, unknown>>;
  audit: Array<Record<string, unknown>>;
  tickets: Array<Record<string, unknown>>;
  reports: Array<Record<string, unknown>>;
  documents: Array<Record<string, unknown>>;
  syncLog: Array<Record<string, unknown>>;
  sequences: Array<{ key: string; period: string; value: number }>;
  bom: BomSeedWorld;
  excise: Array<Record<string, unknown>>;
  events: Array<Record<string, unknown>>;
  pdfBlobs: Array<Record<string, unknown>>;
  finalStock: StockMap;
};

export type FieldStaff = { userId: number; name: string };

/** Build a coherent 2-year IMS world with stock-consistent movements. */
export function buildImsWorld(userId: number, fieldStaff: FieldStaff[] = []): BuiltImsWorld {
  const staff = fieldStaff.length ? fieldStaff : [{ userId, name: OWNER_NAME }];
  const items = buildCatalog();
  const stock: StockMap = new Map(items.map((i) => [i.key, i.opening]));
  const movements: BuiltImsWorld["movements"] = [];
  const pos: BuiltImsWorld["pos"] = [];
  const bills: BuiltImsWorld["bills"] = [];
  const invoices: BuiltImsWorld["invoices"] = [];
  const payments: BuiltImsWorld["payments"] = [];
  const returns: BuiltImsWorld["returns"] = [];
  const checks: BuiltImsWorld["checks"] = [];
  const expenses: BuiltImsWorld["expenses"] = [];
  const closings: BuiltImsWorld["closings"] = [];
  const arActivity: BuiltImsWorld["arActivity"] = [];
  const ledger: BuiltImsWorld["ledger"] = [];
  const payRuns: BuiltImsWorld["payRuns"] = [];
  const fieldTasks: BuiltImsWorld["fieldTasks"] = [];
  const fieldVisits: BuiltImsWorld["fieldVisits"] = [];
  const fieldCheckins: BuiltImsWorld["fieldCheckins"] = [];
  const bankTxns: BuiltImsWorld["bankTxns"] = [];
  const audit: BuiltImsWorld["audit"] = [];
  const tickets: BuiltImsWorld["tickets"] = [];
  const reports: BuiltImsWorld["reports"] = [];
  const documents: BuiltImsWorld["documents"] = [];
  const syncLog: BuiltImsWorld["syncLog"] = [];
  const seqMax = new Map<string, number>();

  const bumpSeq = (key: string, date: string) => {
    const period = date.slice(0, 7);
    const k = `${key}|${period}`;
    const n = (seqMax.get(k) ?? 0) + 1;
    seqMax.set(k, n);
    const docType =
      key === "po"
        ? "PO"
        : key === "invoice"
          ? "SI"
          : key === "bill"
            ? "PB"
            : key === "return"
              ? "RT"
              : key === "check"
                ? "SC"
                : key === "ticket"
                  ? "TK"
                  : key === "payrun"
                    ? "RUN"
                    : "DOC";
    return { period, n, no: formatDocNo(IMS_SETTINGS.businessName, docType, date, n) };
  };

  let movSeq = 0;
  const move = (opts: {
    itemKey: string;
    type: string;
    qty: number;
    delta: number;
    date: string;
    refType: string;
    refId?: string;
    refNo?: string;
    partyKey?: string;
    partyName?: string;
    unitCost?: number;
    unitPrice?: number;
    reason?: string;
  }) => {
    const item = items.find((i) => i.key === opts.itemKey)!;
    const before = stock.get(opts.itemKey) ?? 0;
    // Allow temporary oversell protection: clamp OUT/RETURN_OUT to available
    let delta = opts.delta;
    let qty = Math.abs(opts.qty);
    if (delta < 0 && before + delta < 0) {
      delta = -before;
      qty = before;
      if (qty <= 0) return;
    }
    const after = before + delta;
    stock.set(opts.itemKey, after);
    movSeq += 1;
    // Stable chronological tie-break within a day (and across the seed run).
    const stamp = new Date(`${opts.date}T06:00:00.000Z`);
    stamp.setUTCSeconds(stamp.getUTCSeconds() + movSeq);
    const createdAt = stamp.toISOString().slice(0, 19).replace("T", " ");
    movements.push({
      id: tid(`ims:mov:${opts.type}:${opts.itemKey}:${opts.date}:${opts.refNo ?? movSeq}:${movSeq}`),
      itemId: itemId(opts.itemKey),
      itemName: item.name,
      type: opts.type,
      qty,
      delta,
      beforeQty: before,
      afterQty: after,
      unitCost: opts.unitCost ?? item.purchase,
      unitPrice: opts.unitPrice ?? item.sell,
      value: Math.round(Math.abs(delta) * (opts.unitCost ?? opts.unitPrice ?? item.purchase) * 100) / 100,
      refType: opts.refType,
      refId: opts.refId ?? null,
      refNo: opts.refNo ?? null,
      partyId: opts.partyKey ? partyId(opts.partyKey) : null,
      partyName: opts.partyName ?? null,
      reason: opts.reason ?? null,
      date: opts.date,
      createdAt,
      seq: movSeq,
    });
  };

  // Opening stock
  for (const it of items) {
    if (it.opening <= 0) continue;
    move({
      itemKey: it.key,
      type: "OPENING",
      qty: it.opening,
      delta: it.opening,
      date: IMS_WINDOW_START,
      refType: "manual",
      refNo: "OPENING",
      unitCost: it.purchase,
      reason: "Opening balance — JustTestX IMS seed",
    });
  }

  const customers = IMS_CUSTOMERS;
  const suppliers = IMS_SUPPLIERS;
  const activeItems = items.filter((i) => i.key !== "inactive" && i.sell > 0);

  // Chronological month loop: weekly POs + near-daily high-volume sales.
  let poIdx = 0;
  let invIdx = 0;

  const pushPo = (opts: {
    orderDate: string;
    supplierKey: string;
    note: string;
    forceReceived?: boolean;
    statusOverride?: string;
    bomDocId?: string | null;
  }) => {
    if (opts.orderDate < IMS_WINDOW_START || opts.orderDate > IMS_TODAY) return;
    poIdx += 1;
    const supplier = suppliers.find((s) => s.key === opts.supplierKey) ?? suppliers[poIdx % suppliers.length]!;
    const freezeDead = opts.orderDate >= addMonths(IMS_WINDOW_START, 8);
    const lineItems = activeItems
      .filter((it, i) => (i + poIdx) % 3 === 0)
      .filter((it) => !(freezeDead && DEAD_STOCK_KEYS.has(it.key)))
      .slice(0, 8);
    if (!lineItems.length) return;
    const linesIn: ImsLineInput[] = lineItems.map((it) => {
      const qty = Math.max(it.reorder, 10) + (poIdx % 7) * 4;
      return { itemId: itemId(it.key), name: it.name, sku: it.sku, hsn: it.hsn, unit: it.unit, qty, rate: it.purchase, gstRate: it.gst, receivedQty: 0 };
    });
    const statusRoll = poIdx % 14;
    let status = opts.statusOverride ?? "received";
    if (!opts.statusOverride && !opts.forceReceived) {
      if (statusRoll === 0) status = "draft";
      else if (statusRoll === 1) status = "pending_approval";
      else if (statusRoll === 2) status = "approved";
      else if (statusRoll === 3) status = "partially_received";
      else if (statusRoll === 4) status = "rejected";
      else if (statusRoll === 5) status = "cancelled";
      else if (statusRoll === 6) status = "sent";
    }
    const received = status === "received" ? true : status === "partially_received" ? "partial" : false;
    if (received === true) for (const l of linesIn) l.receivedQty = l.qty;
    else if (received === "partial") for (const l of linesIn) l.receivedQty = Math.max(1, Math.floor(l.qty / 2));

    const totals = computeTotals(linesIn, true);
    const { no } = bumpSeq("po", opts.orderDate);
    const poId = tid(`ims:po:${opts.orderDate}:${supplier.key}:${poIdx}`);
    pos.push({
      id: poId,
      poNo: no,
      status,
      supplierId: partyId(supplier.key),
      supplierName: supplier.name,
      supplierSnapshot: { name: supplier.name, gstin: supplier.gstin, state: supplier.state, city: supplier.city },
      businessSnapshot: { name: IMS_SETTINGS.businessName, gstin: GSTIN, state: "Karnataka" },
      orderDate: opts.orderDate,
      expectedDate: addDays(opts.orderDate, 5),
      lines: totals.lines,
      subtotal: totals.subtotal,
      taxTotal: totals.taxTotal,
      grandTotal: totals.grandTotal,
      notes: opts.note,
      bomDocId: opts.bomDocId ?? null,
      decidedAt: ["draft", "pending_approval"].includes(status) ? null : `${opts.orderDate} 12:00:00`,
      sentAt: ["approved", "sent", "partially_received", "received"].includes(status) ? `${opts.orderDate} 14:00:00` : null,
      receivedAt: status === "received" || status === "partially_received" ? addDays(opts.orderDate, 2) : null,
    });

    if (!received) return;

    const recvDate = addDays(opts.orderDate, 2);
    for (const l of linesIn) {
      const it = activeItems.find((x) => itemId(x.key) === l.itemId)!;
      const rq = l.receivedQty ?? 0;
      if (rq <= 0) continue;
      move({
        itemKey: it.key,
        type: "IN",
        qty: rq,
        delta: rq,
        date: recvDate,
        refType: "po",
        refId: poId,
        refNo: no,
        partyKey: supplier.key,
        partyName: supplier.name,
        unitCost: it.purchase,
      });
    }
    const billDate = addDays(opts.orderDate, 3);
    const { no: billNo } = bumpSeq("bill", billDate);
    const billId = tid(`ims:bill:${opts.orderDate}:${supplier.key}:${poIdx}`);
    let billStatus =
      status === "partially_received"
        ? "on_hold"
        : poIdx % 17 === 0
          ? "cancelled"
          : poIdx % 11 === 0
            ? "pending_approval"
            : poIdx % 13 === 0
              ? "scheduled"
              : billDate < addMonths(IMS_TODAY, -1)
                ? "approved"
                : "approved";
    const billTotal = computeTotals(
      linesIn.map((l) => ({ ...l, qty: l.receivedQty ?? 0 })),
      true,
    );
    // Leave older bills partially/unpaid so Payables aging has multiple buckets
    const paidAmt =
      billStatus === "cancelled"
        ? 0
        : billStatus === "on_hold" || billStatus === "pending_approval"
          ? 0
          : billStatus === "approved" && poIdx % 7 === 0
            ? 0
            : billStatus === "approved" && poIdx % 5 === 0 && billDate < addMonths(IMS_TODAY, -3)
              ? Math.round(billTotal.grandTotal * 0.25)
              : billStatus === "approved" && billDate < addMonths(IMS_TODAY, -2)
                ? billTotal.grandTotal
                : billStatus === "approved" && billDate < addMonths(IMS_TODAY, -1)
                  ? Math.round(billTotal.grandTotal * 0.5)
                  : 0;
    bills.push({
      id: billId,
      billNo,
      supplierBillNo: `VND-${opts.orderDate.replace(/-/g, "")}-${poIdx}`,
      status: billStatus,
      supplierId: partyId(supplier.key),
      supplierName: supplier.name,
      poId,
      poNo: no,
      billDate,
      dueDate: addDays(billDate, supplier.terms),
      lines: billTotal.lines,
      subtotal: billTotal.subtotal,
      taxTotal: billTotal.taxTotal,
      grandTotal: billTotal.grandTotal,
      amountPaid: paidAmt,
      holdReason: billStatus === "on_hold" ? "Quantity mismatch" : null,
      category: "Purchases",
      decidedAt: billStatus === "pending_approval" ? null : `${billDate} 16:00:00`,
    });
    if (paidAmt > 0) {
      payments.push({
        id: tid(`ims:pay:out:${billId}`),
        direction: "out",
        partyId: partyId(supplier.key),
        partyName: supplier.name,
        docType: "bill",
        docId: billId,
        docNo: billNo,
        amount: paidAmt,
        method: "bank",
        reference: `NEFT-AP-${billNo}`,
        paidOn: addDays(billDate, 12),
      });
    }
  };

  for (const ym of eachMonth(IMS_WINDOW_START.slice(0, 7), IMS_TODAY.slice(0, 7))) {
    // Week-1 status-mix PO + mid-month force-received replenishment + late-month top-up
    pushPo({
      orderDate: `${ym}-01`,
      supplierKey: suppliers[poIdx % suppliers.length]!.key,
      note: `Monthly cycle order ${ym}`,
    });
    pushPo({
      orderDate: `${ym}-12`,
      supplierKey: suppliers[(poIdx + 1) % suppliers.length]!.key,
      note: `Mid-month replenishment ${ym}`,
      forceReceived: true,
      statusOverride: "received",
    });
    pushPo({
      orderDate: `${ym}-22`,
      supplierKey: suppliers[(poIdx + 2) % suppliers.length]!.key,
      note: `Late-month top-up ${ym}`,
      forceReceived: true,
      statusOverride: "received",
    });

    // Near-daily sales: every workday, 1–3 invoices (high business volume)
    const dim = daysInMonth(ym);
    for (let day = 1; day <= dim; day++) {
      const invDate = `${ym}-${String(day).padStart(2, "0")}`;
      if (invDate < IMS_WINDOW_START || invDate > IMS_TODAY) continue;
      if (!isWorkday(invDate)) continue;
      // Skip first 2 days so receipts (day 3) land before heavy sales in the month
      if (day < 3) continue;

      const freezeDead = invDate >= addMonths(IMS_WINDOW_START, 8);
      const slots = 1 + (day % 3); // 1–3 invoices/day
      for (let slot = 0; slot < slots; slot++) {
        invIdx += 1;
        // Occasional B2C Large (inter-state unregistered > ₹1L) for GSTR-1 B2CL
        const forceB2cl = invIdx % 47 === 0;
        const customer = forceB2cl
          ? customers.find((c) => c.key === "cashmh") ?? customers[invIdx % customers.length]!
          : customers[invIdx % customers.length]!;
        const nLines = forceB2cl ? 3 : 2 + (invIdx % 4);
        const linesIn: ImsLineInput[] = [];
        const start = (invIdx + slot * 3) % activeItems.length;
        for (let k = 0; k < activeItems.length && linesIn.length < nLines; k++) {
          const it = activeItems[(start + k) % activeItems.length]!;
          if (freezeDead && DEAD_STOCK_KEYS.has(it.key)) continue;
          const avail = stock.get(it.key) ?? 0;
          if (avail < 1) continue;
          let qty = Math.min(
            avail,
            forceB2cl
              ? Math.min(avail, Math.max(2, Math.ceil(1_20_000 / Math.max(it.sell, 1))))
              : 1 + ((invIdx + it.key.length + slot) % Math.max(3, Math.min(12, Math.floor(avail / 5)))),
          );
          if (qty < 1) continue;
          linesIn.push({
            itemId: itemId(it.key),
            name: it.name,
            sku: it.sku,
            hsn: it.hsn,
            unit: it.unit,
            qty,
            rate: it.sell,
            discountPct: invIdx % 19 === 0 ? 5 : 0,
            gstRate: it.gst,
          });
        }
        if (!linesIn.length) continue;

        const isIntra = intra(customer.state);
        const totals = computeTotals(linesIn, isIntra, invIdx % 23 === 0);
        const roll = invIdx % 29;
        let status: "draft" | "issued" | "cancelled" = "issued";
        if (!forceB2cl && roll === 0) status = "draft";
        else if (!forceB2cl && roll === 1) status = "cancelled";

        const { no } = bumpSeq("invoice", invDate);
        const invId = tid(`ims:inv:${ym}:${day}:${slot}:${customer.key}`);
        let amountPaid = 0;
        let payMode: string | null = null;
        if (status === "issued") {
          // Leave a slice of older invoices unpaid / partial so AR aging has 0–30 / 31–60 / 61–90 / 90+ buckets
          const ageMonths = Math.round((Date.parse(IMS_TODAY) - Date.parse(invDate)) / (30 * 86400000));
          if (ageMonths >= 4 && (roll === 3 || roll === 9 || roll === 17)) {
            amountPaid = 0;
            payMode = null;
          } else if (ageMonths >= 2 && (roll === 5 || roll === 13)) {
            amountPaid = Math.round(totals.grandTotal * 0.35 * 100) / 100;
            payMode = "bank";
          } else if (invDate < addMonths(IMS_TODAY, -2)) {
            amountPaid = totals.grandTotal;
            payMode = invIdx % 3 === 0 ? "upi" : invIdx % 5 === 0 ? "cash" : "bank";
          } else if (invDate < addMonths(IMS_TODAY, -1)) {
            amountPaid = Math.round(totals.grandTotal * 0.4 * 100) / 100;
            payMode = "bank";
          } else if (roll === 5) {
            amountPaid = 0;
          }
        }

        const dueDate = addDays(invDate, customer.terms || 7);
        invoices.push({
          id: invId,
          invoiceNo: status === "draft" ? `DRAFT-${invId.slice(0, 8)}` : no,
          status,
          customerId: partyId(customer.key),
          customerName: customer.name,
          customerGstin: customer.gstin,
          customerAddress: `${customer.city}, ${customer.state}`,
          customerMobile: customer.mobile,
          placeOfSupply: customer.state,
          intraState: isIntra ? 1 : 0,
          invoiceDate: invDate,
          dueDate,
          lines: totals.lines,
          subtotal: totals.subtotal,
          discountTotal: totals.discountTotal,
          taxTotal: totals.taxTotal,
          cgst: totals.cgst,
          sgst: totals.sgst,
          igst: totals.igst,
          roundOff: totals.roundOff,
          grandTotal: totals.grandTotal,
          amountPaid,
          payMode,
          stockPosted: status === "issued" ? 1 : 0,
          disputed: roll === 7 ? 1 : 0,
          disputeReason: roll === 7 ? "Quantity dispute on LED panels" : null,
          promiseDate: amountPaid < totals.grandTotal && status === "issued" && roll % 5 === 0 ? addDays(IMS_TODAY, 7) : null,
          promiseAmount: amountPaid < totals.grandTotal && status === "issued" && roll % 5 === 0 ? totals.grandTotal - amountPaid : null,
          sourceTool: roll === 11 || roll % 8 === 0 ? "pos" : null,
          accountManagerName: staff[roll % staff.length]?.name ?? OWNER_NAME,
          issuedAt: status === "issued" ? `${invDate} ${String(10 + slot).padStart(2, "0")}:30:00` : null,
          cancelledAt: status === "cancelled" ? `${invDate} 15:00:00` : null,
          cancelReason: status === "cancelled" ? "Duplicate entry" : null,
          notes: status === "draft" ? "Draft — awaiting confirmation" : forceB2cl ? "Expo counter — B2C Large" : null,
        });

        if (status === "issued") {
          for (const l of linesIn) {
            const it = activeItems.find((x) => itemId(x.key) === l.itemId)!;
            move({
              itemKey: it.key,
              type: "OUT",
              qty: l.qty,
              delta: -l.qty,
              date: invDate,
              refType: roll === 11 || roll % 8 === 0 ? "pos" : "invoice",
              refId: invId,
              refNo: no,
              partyKey: customer.key,
              partyName: customer.name,
              unitPrice: it.sell,
            });
          }
          if (amountPaid > 0) {
            payments.push({
              id: tid(`ims:pay:in:${invId}`),
              direction: "in",
              partyId: partyId(customer.key),
              partyName: customer.name,
              docType: "invoice",
              docId: invId,
              docNo: no,
              amount: amountPaid,
              method: payMode ?? "bank",
              reference: `NEFT-AR-${no}`,
              paidOn: addDays(invDate, Math.min(customer.terms - 2, 15)),
            });
            bankTxns.push({
              id: tid(`ims:bank:in:${invId}`),
              txnDate: addDays(invDate, Math.min(customer.terms - 2, 15)),
              description: `NEFT CR ${customer.name.toUpperCase()} ${no}`,
              amount: amountPaid,
              direction: "in",
              status: "matched",
              matchedType: "payment",
              matchedId: tid(`ims:pay:in:${invId}`),
              reference: `N${invIdx}`,
            });
          }
          if (roll === 5) {
            arActivity.push({
              id: tid(`ims:ar:rem:${invId}`),
              kind: "reminder",
              partyId: partyId(customer.key),
              partyName: customer.name,
              invoiceId: invId,
              channel: "whatsapp",
              message: `First overdue reminder for ${no}`,
              status: null,
              createdAt: `${addDays(dueDate, 3)} 10:00:00`,
            });
            arActivity.push({
              id: tid(`ims:ar:prom:${invId}`),
              kind: "promise",
              partyId: partyId(customer.key),
              partyName: customer.name,
              invoiceId: invId,
              channel: "call",
              message: "Customer promised settlement",
              promiseDate: addDays(IMS_TODAY, 7),
              promiseAmount: totals.grandTotal,
              status: "open",
              createdAt: `${addDays(dueDate, 5)} 11:00:00`,
            });
          }
          if (roll === 7) {
            arActivity.push({
              id: tid(`ims:ar:disp:${invId}`),
              kind: "dispute",
              partyId: partyId(customer.key),
              partyName: customer.name,
              invoiceId: invId,
              channel: "email",
              message: "Opened quantity dispute",
              status: null,
              createdAt: `${addDays(invDate, 4)} 09:00:00`,
            });
          }
        }
      }
    }
  }

  // Bank recon edge cases
  bankTxns.push(
    {
      id: tid("ims:bank:unmatched"),
      txnDate: addDays(IMS_TODAY, -3),
      description: "NEFT CR UNKNOWN SENDER",
      amount: 12_500,
      direction: "in",
      status: "unmatched",
      matchedType: null,
      matchedId: null,
      reference: "NUNK99",
    },
    {
      id: tid("ims:bank:ignored"),
      txnDate: addDays(IMS_TODAY, -18),
      description: "IMPS CR OWNER CAPITAL INJECTION",
      amount: 50_000,
      direction: "in",
      status: "ignored",
      matchedType: null,
      matchedId: null,
      reference: "NIGN01",
    },
    {
      id: tid("ims:bank:unmatched:out"),
      txnDate: addDays(IMS_TODAY, -7),
      description: "NEFT DR MYSTERY VENDOR",
      amount: 3_200,
      direction: "out",
      status: "unmatched",
      matchedType: null,
      matchedId: null,
      reference: "NUNKOUT",
    },
  );

  // Damage & write-offs across the full window (Damage report needs period density)
  let dmgIdx = 0;
  for (const ym of eachMonth(IMS_WINDOW_START.slice(0, 7), IMS_TODAY.slice(0, 7))) {
    const dmgDate = `${ym}-17`;
    if (dmgDate < IMS_WINDOW_START || dmgDate > IMS_TODAY) continue;
    dmgIdx += 1;
    const freezeDead = dmgDate >= addMonths(IMS_WINDOW_START, 8);
    const pool = activeItems.filter((it) => !(freezeDead && DEAD_STOCK_KEYS.has(it.key)));
    if (!pool.length) continue;
    const it = pool[dmgIdx % pool.length]!;
    const qty = 1 + (dmgIdx % 4);
    if ((stock.get(it.key) ?? 0) < qty) continue;
    move({
      itemKey: it.key,
      type: "DAMAGE",
      qty,
      delta: -qty,
      date: dmgDate,
      refType: "manual",
      reason: dmgIdx % 3 === 0 ? "Broken in transit" : dmgIdx % 3 === 1 ? "Water damage in store" : "Packaging crush",
      unitCost: it.purchase,
    });
    if (dmgIdx % 3 === 0) {
      const wo = pool[(dmgIdx + 5) % pool.length]!;
      const wq = 1 + (dmgIdx % 2);
      if ((stock.get(wo.key) ?? 0) >= wq && !DEAD_STOCK_KEYS.has(wo.key)) {
        move({
          itemKey: wo.key,
          type: "WRITE_OFF",
          qty: wq,
          delta: -wq,
          date: dmgDate,
          refType: "manual",
          reason: "Expired / unsaleable write-off",
          unitCost: wo.purchase,
        });
      }
    }
  }
  move({ itemKey: "inactive", type: "WRITE_OFF", qty: 5, delta: -5, date: IMS_TODAY, refType: "manual", reason: "Discontinued SKU write-off", unitCost: 450 });
  move({ itemKey: "led12", type: "DAMAGE", qty: 5, delta: -5, date: IMS_TODAY, refType: "manual", reason: "Broken in transit", unitCost: 180 });

  // Returns (completed) then physical-count adjustment — same calendar day, call order = ledger order
  const retCust = customers[0]!;
  const retItem = activeItems.find((i) => (stock.get(i.key) ?? 0) >= 2) ?? activeItems[0]!;
  const retDate = IMS_TODAY;
  const { no: rtNo } = bumpSeq("return", retDate);
  const retQty = 2;
  returns.push({
    id: tid("ims:ret:cust1"),
    returnNo: rtNo,
    kind: "customer",
    status: "completed",
    partyId: partyId(retCust.key),
    partyName: retCust.name,
    returnDate: retDate,
    lines: [{ itemId: itemId(retItem.key), name: retItem.name, qty: retQty, rate: retItem.sell, amount: retItem.sell * retQty }],
    total: retItem.sell * retQty,
    reason: "Defective",
    disposition: "restock",
    refundStatus: "credit_note",
    refundAmount: retItem.sell * retQty,
  });
  move({ itemKey: retItem.key, type: "RETURN_IN", qty: retQty, delta: retQty, date: retDate, refType: "return", refNo: rtNo, partyKey: retCust.key, partyName: retCust.name, unitPrice: retItem.sell });

  const retSup = suppliers[0]!;
  const retDate2 = IMS_TODAY;
  const { no: rtNo2 } = bumpSeq("return", retDate2);
  const retItem2 = activeItems.find((i) => i.key !== retItem.key && (stock.get(i.key) ?? 0) >= 3) ?? activeItems[1]!;
  const rq2 = Math.min(3, stock.get(retItem2.key) ?? 0) || 3;
  if ((stock.get(retItem2.key) ?? 0) < rq2) {
    move({
      itemKey: retItem2.key,
      type: "IN",
      qty: rq2,
      delta: rq2,
      date: IMS_TODAY,
      refType: "manual",
      refNo: "ADJ-RET-STOCK",
      unitCost: retItem2.purchase,
      reason: "Seed top-up for supplier return scenario",
    });
  }
  returns.push({
    id: tid("ims:ret:sup1"),
    returnNo: rtNo2,
    kind: "supplier",
    status: "completed",
    partyId: partyId(retSup.key),
    partyName: retSup.name,
    returnDate: retDate2,
    lines: [{ itemId: itemId(retItem2.key), name: retItem2.name, qty: rq2, rate: retItem2.purchase, amount: retItem2.purchase * rq2 }],
    total: retItem2.purchase * rq2,
    reason: "Damaged on arrival",
    disposition: "damaged",
    refundStatus: "pending",
    refundAmount: retItem2.purchase * rq2,
  });
  move({ itemKey: retItem2.key, type: "RETURN_OUT", qty: rq2, delta: -rq2, date: retDate2, refType: "return", refNo: rtNo2, partyKey: retSup.key, partyName: retSup.name, unitCost: retItem2.purchase });

  move({ itemKey: "bulb9", type: "ADJUSTMENT", qty: 12, delta: 12, date: IMS_TODAY, refType: "check", reason: "Physical count correction", unitCost: 55 });

  returns.push({
    id: tid("ims:ret:open"),
    returnNo: bumpSeq("return", IMS_TODAY).no,
    kind: "customer",
    status: "open",
    partyId: partyId(customers[1]!.key),
    partyName: customers[1]!.name,
    returnDate: IMS_TODAY,
    lines: [{ itemId: itemId(activeItems[2]!.key), name: activeItems[2]!.name, qty: 1, rate: activeItems[2]!.sell, amount: activeItems[2]!.sell }],
    total: activeItems[2]!.sell,
    reason: "Wrong item",
    disposition: "restock",
    refundStatus: "none",
    refundAmount: 0,
  });
  returns.push({
    id: tid("ims:ret:cancel"),
    returnNo: bumpSeq("return", addDays(IMS_TODAY, -12)).no,
    kind: "customer",
    status: "cancelled",
    partyId: partyId(customers[2]!.key),
    partyName: customers[2]!.name,
    returnDate: addDays(IMS_TODAY, -12),
    lines: [{ itemId: itemId(activeItems[3]!.key), name: activeItems[3]!.name, qty: 1, rate: activeItems[3]!.sell, amount: activeItems[3]!.sell }],
    total: activeItems[3]!.sell,
    reason: "Customer changed mind",
    disposition: "restock",
    refundStatus: "none",
    refundAmount: 0,
  });

  // Stock checks
  for (const [i, st] of [
    ["adjusted", addDays(IMS_TODAY, -20)],
    ["submitted", addDays(IMS_TODAY, -5)],
    ["counting", IMS_TODAY],
    ["cancelled", addDays(IMS_TODAY, -90)],
  ] as const) {
    const { no: scNo } = bumpSeq("check", st);
    const sample = activeItems.slice(0, 8).map((it) => {
      const sys = stock.get(it.key) ?? 0;
      const phys = i === "adjusted" && it.key === "bulb9" ? sys : sys;
      return { itemId: itemId(it.key), name: it.name, unit: it.unit, systemQty: sys, physicalQty: phys, difference: phys - sys, note: null };
    });
    checks.push({
      id: tid(`ims:check:${i}`),
      checkNo: scNo,
      title: `Stock count — ${st}`,
      status: i,
      lines: sample,
      varianceQty: sample.reduce((s, l) => s + Math.abs(l.difference), 0),
      varianceValue: 0,
      countedByName: OWNER_NAME,
      decidedAt: i === "counting" || i === "submitted" ? null : `${st} 18:00:00`,
    });
  }

  // Expenses monthly (with GST lines for Books / expense screens)
  for (const ym of eachMonth(IMS_WINDOW_START.slice(0, 7), IMS_TODAY.slice(0, 7))) {
    const d = `${ym}-12`;
    if (d > IMS_TODAY) continue;
    expenses.push({
      id: tid(`ims:exp:rent:${ym}`),
      expenseDate: d,
      category: "Rent & office",
      description: "Warehouse share",
      amount: 45_000,
      gstAmount: 0,
      payMethod: "bank",
      vendor: "Indira Workspace",
    });
    if (Number(ym.slice(5)) % 2 === 0) {
      const fuel = 8_500 + (Number(ym.slice(5)) * 137) % 3000;
      expenses.push({
        id: tid(`ims:exp:fuel:${ym}`),
        expenseDate: `${ym}-20`,
        category: "Transportation",
        description: "Last-mile deliveries",
        amount: fuel,
        gstAmount: Math.round(fuel * 0.05 * 100) / 100,
        payMethod: "upi",
        vendor: null,
      });
    }
    if (Number(ym.slice(5)) % 3 === 0) {
      expenses.push({
        id: tid(`ims:exp:gst:${ym}`),
        expenseDate: `${ym}-08`,
        category: "Professional fees",
        description: "CA retainer — GST billed",
        amount: 12_000,
        gstAmount: 2_160,
        payMethod: "bank",
        vendor: "Rao & Associates",
      });
    }
  }

  // Daily closings — last 45 workdays (always leave today open; keep at least one closed)
  let cash = 25_000;
  let closedCount = 0;
  for (let i = 45; i >= 0; i--) {
    const d = addDays(IMS_TODAY, -i);
    if (!isWorkday(d)) continue;
    const daySales = invoices.filter((inv) => inv.invoiceDate === d && inv.status === "issued").reduce((s, inv) => s + Number(inv.grandTotal), 0);
    const expected = cash + Math.round(daySales * 0.15);
    const closed = d < IMS_TODAY;
    const counted = closed ? expected + (i % 7 === 0 ? -120 : 0) : null;
    if (closed) closedCount += 1;
    closings.push({
      id: tid(`ims:close:${d}`),
      closingDate: d,
      status: closed ? "closed" : "open",
      openingCash: cash,
      expectedCash: expected,
      countedCash: counted,
      variance: counted != null ? counted - expected : 0,
      summary: { sales: daySales, invoices: invoices.filter((x) => x.invoiceDate === d).length },
      closedByName: closed ? OWNER_NAME : null,
      closedAt: closed ? `${d} 20:00:00` : null,
    });
    if (closed && counted != null) cash = counted;
  }
  if (closedCount === 0) {
    closings.push({
      id: tid("ims:close:force"),
      closingDate: addDays(IMS_TODAY, -1),
      status: "closed",
      openingCash: cash,
      expectedCash: cash,
      countedCash: cash,
      variance: 0,
      summary: { sales: 0, invoices: 0 },
      closedByName: OWNER_NAME,
      closedAt: `${addDays(IMS_TODAY, -1)} 20:00:00`,
    });
  }
  if (!closings.some((c) => c.status === "open")) {
    closings.push({
      id: tid("ims:close:open"),
      closingDate: IMS_TODAY,
      status: "open",
      openingCash: cash,
      expectedCash: cash,
      countedCash: null,
      variance: 0,
      summary: { sales: 0, invoices: 0 },
      closedByName: null,
      closedAt: null,
    });
  }

  // Ledger udhaar
  ledger.push({
    id: tid("ims:led:1"),
    partyId: partyId("pixel"),
    partyName: "PixelForge Media LLP",
    entryType: "credit",
    category: "udhaar",
    amount: 15_000,
    entryDate: addDays(IMS_TODAY, -45),
    refNo: "UDH-001",
    dueDate: addDays(IMS_TODAY, -15),
    settledOn: null,
    phone: "+91 80 9999 8008",
  });
  ledger.push({
    id: tid("ims:led:2"),
    partyId: partyId("bright"),
    partyName: "Bright Homes Electricals",
    entryType: "credit",
    category: "udhaar",
    amount: 8_000,
    entryDate: addDays(IMS_TODAY, -90),
    refNo: "UDH-002",
    dueDate: addDays(IMS_TODAY, -60),
    settledOn: addDays(IMS_TODAY, -55),
    settleMethod: "cash",
    phone: "+91 98450 20001",
  });

  // Payment runs
  const approvedBills = bills.filter((b) => b.status === "approved" && Number(b.amountPaid) < Number(b.grandTotal)).slice(0, 3);
  if (approvedBills.length) {
    const runDate = addDays(IMS_TODAY, 3);
    const { no: runNo } = bumpSeq("payrun", runDate);
    const total = approvedBills.reduce((s, b) => s + (Number(b.grandTotal) - Number(b.amountPaid)), 0);
    payRuns.push({
      id: tid("ims:run:1"),
      runNo,
      status: "scheduled",
      runDate,
      method: "bank",
      billIds: approvedBills.map((b) => b.id),
      billCount: approvedBills.length,
      total,
      notes: "Weekly AP run",
    });
    for (const b of approvedBills) {
      b.status = "scheduled";
      b.scheduledOn = runDate;
      b.runId = tid("ims:run:1");
    }
  }
  payRuns.push({
    id: tid("ims:run:paid"),
    runNo: bumpSeq("payrun", addDays(IMS_TODAY, -30)).no,
    status: "paid",
    runDate: addDays(IMS_TODAY, -30),
    method: "bank",
    billIds: [],
    billCount: 0,
    total: 0,
    notes: "Historical paid run",
    paidAt: `${addDays(IMS_TODAY, -28)} 11:00:00`,
  });
  payRuns.push({
    id: tid("ims:run:cancel"),
    runNo: bumpSeq("payrun", addDays(IMS_TODAY, -10)).no,
    status: "cancelled",
    runDate: addDays(IMS_TODAY, -10),
    method: "bank",
    billIds: [],
    billCount: 0,
    total: 0,
    notes: "Cancelled — funds insufficient",
  });

  // Field ops — multi-user trails across the 2-year window (Onsite report + Staff tab)
  const sites = [
    { party: "cascade", name: "Cascade Koramangala", lat: 12.9352, lng: 77.6245 },
    { party: "meridian", name: "Meridian Whitefield", lat: 12.9698, lng: 77.75 },
    { party: "bright", name: "Bright Homes Mysuru", lat: 12.2958, lng: 76.6394 },
    { party: "spark", name: "Sparkline site HSR", lat: 12.9116, lng: 77.6473 },
    { party: "harbor", name: "Harbor Education Indiranagar", lat: 12.9784, lng: 77.6408 },
    { party: "netzone", name: "NetZone Hubballi", lat: 15.3647, lng: 75.124 },
  ];
  let fieldIdx = 0;
  for (const ym of eachMonth(IMS_WINDOW_START.slice(0, 7), IMS_TODAY.slice(0, 7))) {
    for (const day of [5, 12, 19, 26]) {
      const d = `${ym}-${String(day).padStart(2, "0")}`;
      if (d < IMS_WINDOW_START || d > IMS_TODAY || !isWorkday(d)) continue;
      fieldIdx += 1;
      const agent = staff[fieldIdx % staff.length]!;
      const site = sites[fieldIdx % sites.length]!;
      const party = IMS_CUSTOMERS.find((c) => c.key === site.party)!;
      const statuses = ["open", "in_progress", "done", "cancelled"] as const;
      const st =
        d >= addDays(IMS_TODAY, -7)
          ? statuses[fieldIdx % 4]!
          : fieldIdx % 5 === 0
            ? "cancelled"
            : fieldIdx % 11 === 0
              ? "in_progress"
              : "done";
      const taskTypes = ["delivery", "collection", "visit", "audit", "installation", "service", "other"] as const;
      const taskType = taskTypes[fieldIdx % taskTypes.length]!;
      const taskId = tid(`ims:ftask:${ym}:${day}`);
      fieldTasks.push({
        id: taskId,
        title: `${st === "done" ? "Completed" : "Scheduled"} — ${site.name}`,
        taskType,
        status: st,
        priority: fieldIdx % 5 === 0 ? "urgent" : fieldIdx % 5 === 1 ? "high" : fieldIdx % 5 === 2 ? "low" : "normal",
        assigneeUserId: agent.userId,
        assigneeName: agent.name,
        partyId: partyId(site.party),
        partyName: party.name,
        siteAddress: site.name,
        lat: site.lat,
        lng: site.lng,
        dueOn: d,
        amount: taskType === "collection" ? 15_000 + (fieldIdx % 7) * 2500 : null,
        completedAt: st === "done" ? `${d} 17:00:00` : null,
      });

      // GPS trail (~1–3 km) so Onsite km travelled is non-zero
      const trail = [
        { lat: site.lat, lng: site.lng, hour: 9, kind: "check_in", status: "at_site" },
        { lat: site.lat + 0.008, lng: site.lng + 0.004, hour: 11, kind: "ping", status: "travelling" },
        { lat: site.lat + 0.015, lng: site.lng - 0.006, hour: 13, kind: "ping", status: "travelling" },
        { lat: site.lat + 0.02, lng: site.lng + 0.01, hour: 15, kind: "status", status: "active" },
        { lat: site.lat + 0.022, lng: site.lng + 0.012, hour: 16, kind: "check_out", status: "active" },
      ] as const;
      trail.forEach((p, pi) => {
        fieldCheckins.push({
          id: tid(`ims:fchk:${ym}:${day}:${pi}`),
          userId: agent.userId,
          userName: agent.name,
          kind: p.kind,
          fieldStatus: p.status,
          lat: p.lat,
          lng: p.lng,
          accuracyM: 12 + (pi % 5),
          siteName: site.name,
          taskId,
          pingDate: d,
          createdAt: `${d} ${String(p.hour).padStart(2, "0")}:${String(10 + pi * 7).padStart(2, "0")}:00`,
          note: "Seed field trail",
        });
      });

      const outcomes = ["completed", "follow_up", "order_received", "payment_collected", "customer_unavailable", "rescheduled", "other"] as const;
      fieldVisits.push({
        id: tid(`ims:fvis:${ym}:${day}`),
        userId: agent.userId,
        userName: agent.name,
        visitDate: d,
        siteName: site.name,
        partyId: partyId(site.party),
        partyName: party.name,
        purpose: taskType === "collection" ? "collection" : "visit",
        taskId,
        address: site.name,
        inLat: site.lat,
        inLng: site.lng,
        checkedInAt: `${d} 09:15:00`,
        checkedOutAt: `${d} 16:30:00`,
        outLat: site.lat + 0.022,
        outLng: site.lng + 0.012,
        summary: "Dealer / site visit — JustTestX seed",
        outcome: outcomes[fieldIdx % outcomes.length],
        nextVisitOn: addDays(d, 14),
      });
    }
  }

  // Audit flags + threaded replies (Audit screen detail drawer)
  const auditThread = (texts: string[]) =>
    texts.map((text, i) => ({
      id: tid(`ims:aud:th:${text.slice(0, 12)}:${i}`),
      authorId: staff[i % staff.length]!.userId,
      author: staff[i % staff.length]!.name,
      role: i === 0 ? "raiser" : "reply",
      at: `${addDays(IMS_TODAY, -(texts.length - i))}T1${i}:00:00.000Z`,
      text,
    }));
  audit.push(
    {
      id: tid("ims:aud:1"),
      kind: "flag",
      title: "High overdue — Harbor Education",
      severity: "high",
      status: "open",
      area: "aging",
      entityType: "party",
      entityId: partyId("harbor"),
      entityLabel: "Harbor Education",
      assigneeUserId: staff[0]!.userId,
      assigneeName: staff[0]!.name,
      amount: 185_000,
      dueDate: addDays(IMS_TODAY, -14),
      thread: auditThread(["Flagged from aging pack", "Called accounts — promised remittance by Friday"]),
    },
    {
      id: tid("ims:aud:2"),
      kind: "flag",
      title: "Negative margin on draft invoice",
      severity: "medium",
      status: "responded",
      area: "sales",
      entityType: "invoice",
      entityId: null,
      entityLabel: null,
      thread: auditThread(["Pricing below cost on LED panel line", "Corrected rate card — awaiting re-issue"]),
    },
    {
      id: tid("ims:aud:3"),
      kind: "query",
      title: "CA query: GSTR-2B vs purchase bills",
      severity: "critical",
      status: "open",
      area: "gst",
      entityType: null,
      entityId: null,
      entityLabel: null,
      thread: auditThread([
        "Please upload GSTR-2B JSON for Sep and reconcile against purchase bills (upload-only in GST screen).",
        "Seed note: 2B is not persisted — use GST → GSTR-2B upload when testing.",
      ]),
    },
    {
      id: tid("ims:aud:4"),
      kind: "flag",
      title: "Stock variance after count",
      severity: "low",
      status: "resolved",
      area: "inventory",
      entityType: "item",
      entityId: itemId("bulb9"),
      entityLabel: "9W LED bulb",
      thread: auditThread(["Variance on bulb9 after SC", "Adjusted and closed"]),
    },
    {
      id: tid("ims:aud:5"),
      kind: "query",
      title: "Bank unmatched credit",
      severity: "medium",
      status: "dismissed",
      area: "banking",
      entityType: null,
      entityId: null,
      entityLabel: null,
      thread: auditThread(["Unmatched NEFT ₹42,500", "Customer remittance — matched later; dismissed"]),
    },
    {
      id: tid("ims:aud:6"),
      kind: "flag",
      title: "Overstock — switchgear bay",
      severity: "medium",
      status: "open",
      area: "inventory",
      entityType: "item",
      entityId: itemId("sw1"),
      entityLabel: "1-way switch",
      thread: auditThread(["Stock above max after bulk PO"]),
    },
  );

  // Tickets with category + reply threads
  const ticketDefs: Array<[string, string, string, string]> = [
    ["POS scanner not pairing", "open", "bug", "urgent"],
    ["Need GST report for Sep", "in_progress", "gst", "high"],
    ["Wrong HSN on cable SKU", "waiting", "stock", "normal"],
    ["Tally sync failed last night", "resolved", "integrations", "high"],
    ["Request new customer credit limit", "closed", "sales", "normal"],
    ["Field app check-in GPS drift", "open", "access", "low"],
    ["BOM proposal PDF missing for customer", "in_progress", "purchase", "normal"],
  ];
  for (const [i, [subj, st, cat, pri]] of ticketDefs.entries()) {
    const { no } = bumpSeq("ticket", addDays(IMS_TODAY, -i * 4));
    const assignee = staff[(i + 1) % staff.length]!;
    tickets.push({
      id: tid(`ims:tk:${i}`),
      ticketNo: no,
      subject: subj,
      category: cat,
      status: st,
      priority: pri,
      description: `${subj} — JustTestX seed ticket`,
      raisedByName: OWNER_NAME,
      assignedTo: assignee.userId,
      assignedToName: assignee.name,
      thread: [
        {
          id: tid(`ims:tk:th:${i}:0`),
          authorId: userId,
          author: OWNER_NAME,
          role: "raiser",
          at: `${addDays(IMS_TODAY, -(i * 4 + 2))}T09:00:00.000Z`,
          text: `Opened: ${subj}`,
        },
        {
          id: tid(`ims:tk:th:${i}:1`),
          authorId: assignee.userId,
          author: assignee.name,
          role: "agent",
          at: `${addDays(IMS_TODAY, -(i * 4 + 1))}T11:30:00.000Z`,
          text: st === "resolved" || st === "closed" ? "Resolved — verified in seed data" : "Looking into this — ETA today",
        },
      ],
    });
  }

  // Saved reports — one for every runnable report type (Reports screen + approval flow)
  const savedCatalog: Array<{ key: string; name: string; schedule: string; status: string; approval: string; format: string }> = [
    { key: "stockin", name: "Stock in — full window", schedule: "weekly", status: "active", approval: "approved", format: "xlsx" },
    { key: "stockout", name: "Stock out — full window", schedule: "weekly", status: "active", approval: "sent", format: "xlsx" },
    { key: "fullstock", name: "Full stock & valuation", schedule: "monthly", status: "active", approval: "approved", format: "xlsx" },
    { key: "damage", name: "Damage & write-offs", schedule: "monthly", status: "active", approval: "approved", format: "xlsx" },
    { key: "po", name: "Purchase order register", schedule: "weekly", status: "active", approval: "pending_approval", format: "xlsx" },
    { key: "sales", name: "Sales register", schedule: "daily", status: "active", approval: "sent", format: "xlsx" },
    { key: "receivables", name: "Receivables aging pack", schedule: "weekly", status: "active", approval: "approved", format: "xlsx" },
    { key: "payables", name: "Payables aging pack", schedule: "weekly", status: "active", approval: "approved", format: "xlsx" },
    { key: "margin", name: "Profit & margin by item", schedule: "monthly", status: "active", approval: "approved", format: "xlsx" },
    { key: "suppliers", name: "Supplier performance", schedule: "monthly", status: "active", approval: "draft", format: "xlsx" },
    { key: "onsite", name: "Onsite staff activity", schedule: "weekly", status: "active", approval: "approved", format: "xlsx" },
    { key: "lowstock", name: "Low stock & reorder", schedule: "daily", status: "active", approval: "sent", format: "xlsx" },
    { key: "deadstock", name: "Dead stock (90+ idle)", schedule: "monthly", status: "paused", approval: "draft", format: "xlsx" },
  ];
  savedCatalog.forEach((r, i) => {
    reports.push({
      id: tid(`ims:rep:${r.key}`),
      name: r.name,
      reportType: r.key,
      schedule: r.schedule,
      status: r.status,
      approvalStatus: r.approval,
      format: r.format,
      period: "custom",
      from: IMS_WINDOW_START,
      to: IMS_TODAY,
      filters: r.key === "deadstock" ? { days: 90 } : {},
    });
    void i;
  });

  const sampleBill = bills.find((b) => b.status === "approved" || b.status === "paid") ?? bills[0];
  const sampleExp = expenses[0];
  documents.push(
    {
      id: tid("ims:doc:1"),
      title: "Dealership agreement — Havells",
      category: "contract",
      entityType: "party",
      entityId: partyId("havells"),
      entityLabel: "Havells India",
      period: null,
      fileName: "havells-dealership.pdf",
      mime: "application/pdf",
      sizeBytes: SEED_PDF_BYTES.length,
      content: SEED_PDF_B64,
    },
    {
      id: tid("ims:doc:2"),
      title: "GSTR-1 Sep draft pack",
      category: "gst",
      entityType: null,
      entityId: null,
      entityLabel: null,
      period: "2026-09",
      fileName: "gstr1-sep-draft.csv",
      mime: "text/csv",
      sizeBytes: 180,
      content: Buffer.from("invoice_no,taxable,igst\nSI-SEED,100000,18000\n", "utf8").toString("base64"),
    },
    {
      id: tid("ims:doc:3"),
      title: "Warehouse lease copy",
      category: "compliance",
      entityType: null,
      entityId: null,
      entityLabel: null,
      period: "FY2025-26",
      fileName: "warehouse-lease.pdf",
      mime: "application/pdf",
      sizeBytes: SEED_PDF_BYTES.length,
      content: SEED_PDF_B64,
    },
    {
      id: tid("ims:doc:4"),
      title: "Supplier bill scan",
      category: "purchase",
      entityType: "bill",
      entityId: sampleBill ? String(sampleBill.id) : null,
      entityLabel: sampleBill ? String(sampleBill.billNo) : null,
      period: null,
      fileName: "supplier-bill.pdf",
      mime: "application/pdf",
      sizeBytes: SEED_PDF_BYTES.length,
      content: SEED_PDF_B64,
    },
    {
      id: tid("ims:doc:5"),
      title: "Expense receipt — rent",
      category: "expense",
      entityType: "expense",
      entityId: sampleExp ? String(sampleExp.id) : null,
      entityLabel: "Rent & office",
      period: null,
      fileName: "rent-receipt.pdf",
      mime: "application/pdf",
      sizeBytes: SEED_PDF_BYTES.length,
      content: SEED_PDF_B64,
    },
    {
      id: tid("ims:doc:6"),
      title: "GSTR-2B upload checklist",
      category: "gst",
      entityType: null,
      entityId: null,
      entityLabel: null,
      period: IMS_TODAY.slice(0, 7),
      fileName: "gstr2b-checklist.txt",
      mime: "text/plain",
      sizeBytes: 96,
      content: Buffer.from("GSTR-2B is upload-only in IMS GST screen — no persisted rows.\n", "utf8").toString("base64"),
    },
  );

  syncLog.push(
    { provider: "tally", direction: "export", entity: "invoices", status: "success", records: 42, message: "Exported issued invoices", actorName: OWNER_NAME },
    { provider: "tally", direction: "import", entity: "parties", status: "partial", records: 3, message: "2 parties skipped — duplicate GSTIN", actorName: OWNER_NAME },
    { provider: "tally", direction: "export", entity: "bills", status: "success", records: 18, message: "Purchase bills exported", actorName: OWNER_NAME },
    { provider: "pos", direction: "import", entity: "sales", status: "failed", records: 0, message: "POS gateway timeout", actorName: OWNER_NAME },
    { provider: "pos", direction: "import", entity: "sales", status: "success", records: 12, message: "Counter sales imported", actorName: staff[0]!.name },
  );

  // Mid-window returns for status/history coverage (stock-neutral when possible)
  for (let ri = 0; ri < 8; ri++) {
    const d = addMonths(IMS_TODAY, -(ri * 2 + 1));
    if (d < IMS_WINDOW_START) continue;
    const cust = customers[ri % customers.length]!;
    const it = activeItems[ri % activeItems.length]!;
    const { no: rtHist } = bumpSeq("return", d);
    const st = ri % 3 === 0 ? "open" : ri % 3 === 1 ? "completed" : "cancelled";
    returns.push({
      id: tid(`ims:ret:hist:${ri}`),
      returnNo: rtHist,
      kind: ri % 2 === 0 ? "customer" : "supplier",
      status: st,
      partyId: partyId(ri % 2 === 0 ? cust.key : suppliers[ri % suppliers.length]!.key),
      partyName: ri % 2 === 0 ? cust.name : suppliers[ri % suppliers.length]!.name,
      returnDate: d,
      lines: [{ itemId: itemId(it.key), name: it.name, qty: 1, rate: it.sell, amount: it.sell }],
      total: it.sell,
      reason: st === "cancelled" ? "Customer withdrew claim" : "Warranty / quality",
      disposition: "restock",
      refundStatus: st === "completed" ? "refunded" : "none",
      refundAmount: st === "completed" ? it.sell : 0,
    });
    if (st === "completed" && ri % 2 === 0) {
      move({
        itemKey: it.key,
        type: "RETURN_IN",
        qty: 1,
        delta: 1,
        date: d,
        refType: "return",
        refNo: rtHist,
        partyKey: cust.key,
        partyName: cust.name,
        unitPrice: it.sell,
      });
    }
  }

  // Force several SKUs into Low / Out-of-stock for Restock + Low stock report
  const lowForce = ["led40", "mcb63", "ups2", "gpon", "router", "fan48", "ap"];
  lowForce.forEach((key, i) => {
    const it = activeItems.find((x) => x.key === key);
    if (!it) return;
    const cur = stock.get(key) ?? 0;
    const target = i % 3 === 0 ? 0 : Math.max(0, Math.floor(it.min / 3));
    const drop = cur - target;
    if (drop <= 0) return;
    move({
      itemKey: key,
      type: i % 2 === 0 ? "DAMAGE" : "ADJUSTMENT",
      qty: drop,
      delta: -drop,
      date: IMS_TODAY,
      refType: "manual",
      reason: i % 2 === 0 ? "QA force low-stock scenario" : "Physical recount — write down to min band",
      unitCost: it.purchase,
    });
  });

  // Overstock samples (above max) for Restock / Stock screens
  for (const key of ["bulb9", "sw1", "cab15"]) {
    const it = activeItems.find((x) => x.key === key);
    if (!it) continue;
    const cur = stock.get(key) ?? 0;
    const target = Math.max(it.max + 40, Math.ceil(it.max * 1.6));
    const add = target - cur;
    if (add <= 0) continue;
    move({
      itemKey: key,
      type: "IN",
      qty: add,
      delta: add,
      date: addDays(IMS_TODAY, -3),
      refType: "manual",
      refNo: `OVERSTOCK-${key}`,
      reason: "Seed overstock — above max for restock/alerts QA",
      unitCost: it.purchase,
    });
  }

  // Excise register (module enabled via settings.exciseEnabled)
  const exciseStatuses = ["received", "in_transit", "verified", "issued"] as const;
  const excise: BuiltImsWorld["excise"] = [];
  for (let ei = 0; ei < 12; ei++) {
    const d = addMonths(IMS_TODAY, -ei);
    if (d < IMS_WINDOW_START) continue;
    const it = activeItems[ei % activeItems.length]!;
    const recv = 20 + ei * 5;
    const issued = 10 + ei * 2;
    excise.push({
      id: tid(`ims:excise:${ei}`),
      recordDate: d,
      itemId: itemId(it.key),
      itemName: it.name,
      brand: it.brand,
      volumeMl: ei % 2 === 0 ? 750 : null,
      openingQty: 50,
      receivedQty: recv,
      issuedQty: issued,
      closingQty: 50 + recv - issued,
      dutyRate: 12.5,
      dutyAmount: Math.round(issued * 12.5 * 100) / 100,
      permitNo: `EP-${d.slice(0, 7).replace("-", "")}-${ei + 1}`,
      transportPermitNo: `TP-${1000 + ei}`,
      batchNo: `B${2024 + (ei % 2)}-${ei + 1}`,
      vendorId: partyId(suppliers[ei % suppliers.length]!.key),
      vendorName: suppliers[ei % suppliers.length]!.name,
      cases: Math.ceil(recv / 12),
      bottlesPerCase: 12,
      permitDate: d,
      exciseCategory: ei % 2 === 0 ? "spirit" : "general",
      status: exciseStatuses[ei % exciseStatuses.length],
      notes: "JustTestX excise sample",
      movementId: null,
    });
  }

  // BOM submodule (packages, rate cards, docs, DCs, returns) — may post historical stock moves
  const linkableInvoices = invoices
    .filter((inv) => inv.status === "issued")
    .slice(-40)
    .map((inv) => ({
      id: String(inv.id),
      customerKey: String(
        customers.find((c) => partyId(c.key) === inv.customerId)?.key ?? customers[0]!.key,
      ),
      invoiceDate: String(inv.invoiceDate),
    }));

  const bom = buildBomSeedWorld({
    items: activeItems.map((i) => ({
      key: i.key,
      name: i.name,
      sku: i.sku,
      brand: i.brand,
      unit: i.unit,
      purchase: i.purchase,
      sell: i.sell,
    })),
    move,
    userId,
    ownerName: OWNER_NAME,
    businessName: IMS_SETTINGS.businessName,
    windowStart: IMS_WINDOW_START,
    today: IMS_TODAY,
    customers: customers.map((c) => ({ key: c.key, name: c.name, city: c.city })),
    itemId,
    partyId,
    linkableInvoices,
  });

  // Link one recent shortfall PO to a confirmed BOM (purchasing from BOM flow)
  const confirmedBom = bom.docs.find((d) => d.status === "confirmed");
  if (confirmedBom) {
    const shortfallPo = pos.filter((p) => p.status === "received").at(-1);
    if (shortfallPo) {
      shortfallPo.bomDocId = confirmedBom.id;
      shortfallPo.notes = `BOM shortfall cover for ${confirmedBom.docNo}`;
    }
  }

  // BOM PDF blobs for non-draft docs (proposal download / vault path)
  const pdfBlobs: BuiltImsWorld["pdfBlobs"] = [];
  for (const d of bom.docs) {
    const st = String(d.status);
    if (["draft", "cancelled"].includes(st)) continue;
    const artifactId = tid(`ims:pdf:${String(d.id)}`);
    pdfBlobs.push({
      id: artifactId,
      docId: d.id,
      sha256: SEED_PDF_SHA,
      pdfBase64: SEED_PDF_B64,
    });
    d.pdfArtifactId = artifactId;
    d.pdfSha256 = SEED_PDF_SHA;
    d.pdfGeneratedAt = `${String(d.docDate ?? IMS_TODAY)} 14:00:00`;
  }
  if (!pdfBlobs.length && bom.docs[0]) {
    const d = bom.docs[0]!;
    const artifactId = tid("ims:pdf:fallback");
    pdfBlobs.push({ id: artifactId, docId: d.id, sha256: SEED_PDF_SHA, pdfBase64: SEED_PDF_B64 });
    d.pdfArtifactId = artifactId;
    d.pdfSha256 = SEED_PDF_SHA;
    d.pdfGeneratedAt = `${IMS_TODAY} 14:00:00`;
  }

  // Dead-stock SKUs: drop any post-freeze activity, then leave residual on-hand for the Dead Stock report
  const freezeDate = addMonths(IMS_WINDOW_START, 8);
  const idToKey = new Map(items.map((i) => [itemId(i.key), i.key]));
  for (let i = movements.length - 1; i >= 0; i--) {
    const m = movements[i]!;
    const key = idToKey.get(String(m.itemId));
    if (key && DEAD_STOCK_KEYS.has(key) && String(m.date) > freezeDate) movements.splice(i, 1);
  }
  for (const key of DEAD_STOCK_KEYS) {
    const it = items.find((x) => x.key === key);
    if (!it) continue;
    // Ensure a residual IN on freeze day so stock stays > 0 after earlier sales
    move({
      itemKey: key,
      type: "IN",
      qty: Math.max(it.reorder * 2, 25),
      delta: Math.max(it.reorder * 2, 25),
      date: freezeDate,
      refType: "manual",
      refNo: `DEAD-HOLD-${key}`,
      unitCost: it.purchase,
      reason: "Seed residual — held for dead-stock / clearance scenarios",
    });
  }

  // Replay movements in calendar order so before/after qty match audit (BOM inserts are back-dated).
  movements.sort((a, b) => {
    const d = String(a.date).localeCompare(String(b.date));
    if (d !== 0) return d;
    return Number(a.seq) - Number(b.seq);
  });
  const replayed: StockMap = new Map(items.map((i) => [i.key, 0]));
  for (const m of movements) {
    const key = idToKey.get(String(m.itemId));
    if (!key) continue;
    let delta = Number(m.delta);
    let qty = Number(m.qty);
    const before = replayed.get(key) ?? 0;
    if (delta < 0 && before + delta < 0) {
      delta = -before;
      qty = before;
      m.delta = delta;
      m.qty = qty;
      m.value = Math.round(Math.abs(delta) * Number(m.unitCost ?? m.unitPrice ?? 0) * 100) / 100;
    }
    const after = before + delta;
    m.beforeQty = before;
    m.afterQty = after;
    replayed.set(key, after);
  }
  for (const [k, v] of replayed) stock.set(k, v);

  const sequences = [...seqMax.entries()].map(([k, value]) => {
    const [key, period] = k.split("|") as [string, string];
    return { key, period, value };
  });

  // Dense activity feed (Activity / History / Connect recent)
  const events: BuiltImsWorld["events"] = [];
  const pushEv = (
    actor: FieldStaff,
    eventType: string,
    entityType: string,
    entityId: string,
    summary: string,
    at: string,
    payload: Record<string, unknown> = {},
  ) => {
    events.push({
      actorUserId: actor.userId,
      actorName: actor.name,
      eventType,
      entityType,
      entityId,
      summary,
      payload: JSON.stringify(payload),
      createdAt: at.includes(" ") ? at : `${at} 12:00:00`,
    });
  };
  invoices
    .filter((inv) => inv.status === "issued")
    .slice(-80)
    .forEach((inv, i) => {
      const actor = staff[i % staff.length]!;
      pushEv(actor, "invoice.issued", "invoice", String(inv.id), `Issued ${inv.invoiceNo} — ${inv.customerName}`, String(inv.issuedAt ?? inv.invoiceDate), {
        grandTotal: inv.grandTotal,
      });
    });
  pos.slice(-40).forEach((p, i) => {
    const actor = staff[i % staff.length]!;
    pushEv(actor, `po.${p.status}`, "purchase_order", String(p.id), `PO ${p.poNo} → ${p.status}`, String(p.orderDate), {
      supplier: p.supplierName,
    });
  });
  bills.slice(-40).forEach((b, i) => {
    const actor = staff[i % staff.length]!;
    pushEv(actor, `bill.${b.status}`, "bill", String(b.id), `Bill ${b.billNo} → ${b.status}`, String(b.billDate));
  });
  payments.slice(-50).forEach((p, i) => {
    const actor = staff[i % staff.length]!;
    pushEv(
      actor,
      `payment.${p.direction}`,
      "payment",
      String(p.id),
      `${p.direction === "in" ? "Received" : "Paid"} ₹${p.amount}`,
      String(p.paidOn ?? IMS_TODAY),
    );
  });
  returns.slice(-20).forEach((r, i) => {
    const actor = staff[i % staff.length]!;
    pushEv(actor, `return.${r.status}`, "return", String(r.id), `Return ${r.returnNo}`, String(r.returnDate));
  });
  fieldTasks.slice(-30).forEach((f, i) => {
    const actor = staff.find((s) => s.userId === f.assigneeUserId) ?? staff[i % staff.length]!;
    pushEv(actor, `field.task.${f.status}`, "field_task", String(f.id), String(f.title), String(f.dueOn));
  });
  bom.docs.forEach((d, i) => {
    const actor = staff[i % staff.length]!;
    pushEv(actor, `bom.${d.status}`, "bom_doc", String(d.id), `BOM ${d.docNo} → ${d.status}`, String(d.docDate));
  });
  bom.dcs.slice(-20).forEach((d, i) => {
    const actor = staff[i % staff.length]!;
    pushEv(actor, `bom_dc.${d.status}`, "bom_dc", String(d.id), `DC ${d.docNo} → ${d.status}`, String(d.docDate));
  });
  for (const a of audit) {
    pushEv(staff[0]!, `audit.${a.status}`, "audit", String(a.id), String(a.title), IMS_TODAY);
  }
  for (const tk of tickets) {
    pushEv(staff[0]!, `ticket.${tk.status}`, "ticket", String(tk.id), String(tk.subject), IMS_TODAY);
  }
  pushEv(
    { userId, name: OWNER_NAME },
    "connect.link",
    "link",
    "bos",
    "Linked BOS parties / items into IMS Connect",
    IMS_TODAY,
  );
  pushEv(
    { userId, name: OWNER_NAME },
    "seed.complete",
    "seed",
    "justtestx-ims",
    "JustTestX IMS 2-year max-fill scenario loaded",
    `${IMS_TODAY} 18:00:00`,
    { windowStart: IMS_WINDOW_START, today: IMS_TODAY, invoices: invoices.length, items: items.length, events: events.length },
  );

  return {
    items,
    movements,
    pos,
    bills,
    invoices,
    payments,
    returns,
    checks,
    expenses,
    closings,
    arActivity,
    ledger,
    payRuns,
    fieldTasks,
    fieldVisits,
    fieldCheckins,
    bankTxns,
    audit,
    tickets,
    reports,
    documents,
    syncLog,
    sequences,
    bom,
    excise,
    events,
    pdfBlobs,
    finalStock: stock,
  };
}

export { fingerprint };
