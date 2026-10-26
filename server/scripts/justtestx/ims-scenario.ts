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
import { addDays, addMonths, daysInMonth, eachMonth, fingerprint, tid, weekday, COMPANY, GSTIN } from "./lib.js";

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
  poApprovalLimit: 75_000,
  draftPoPurgeDays: 7,
  paymentTermsDays: 30,
  defaultGstRate: 18,
  allowNegativeStock: 0,
  exciseEnabled: 0,
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
  { key: "bright", kind: "customer", name: "Bright Homes Electricals", contact: "Owner", mobile: "+91 98450 20001", email: "orders@brighthomes.example", gstin: "29BRIGH1111A1Z1", city: "Mysuru", state: "Karnataka", stateCode: "29", creditLimit: 1_50_000, terms: 15, tags: "dealer" },
  { key: "spark", kind: "customer", name: "Sparkline Contractors", contact: "Site Lead", mobile: "+91 98450 20002", email: "po@sparkline.example", gstin: "29SPARK2222B1Z2", city: "Bengaluru", state: "Karnataka", stateCode: "29", creditLimit: 2_00_000, terms: 21, tags: "contractor" },
  { key: "netzone", kind: "customer", name: "NetZone Cyber Cafe Chain", contact: "Purchase", mobile: "+91 98450 20003", email: "buy@netzone.example", gstin: "29NETZO3333C1Z3", city: "Hubballi", state: "Karnataka", stateCode: "29", creditLimit: 1_00_000, terms: 10, tags: "retail" },
  { key: "govt", kind: "customer", name: "Karnataka PWD Stores", contact: "Indent Desk", mobile: "+91 80 2222 3000", email: "stores@pwd.example", gstin: "29GOVKA4444D1Z4", city: "Bengaluru", state: "Karnataka", stateCode: "29", creditLimit: 10_00_000, terms: 60, tags: "govt" },
];

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
    { key: "led12", name: "LED Panel 12W Square", sku: "HV-LED-12", category: "Lighting", brand: "Havells", unit: "pcs", hsn: "9405", gst: 18, purchase: 180, sell: 245, mrp: 299, min: 40, max: 400, reorder: 80, supplierKey: "havells", opening: 120 },
    { key: "led18", name: "LED Panel 18W Round", sku: "HV-LED-18", category: "Lighting", brand: "Havells", unit: "pcs", hsn: "9405", gst: 18, purchase: 240, sell: 325, mrp: 399, min: 30, max: 300, reorder: 60, supplierKey: "havells", opening: 90 },
    { key: "tube20", name: "LED Batten 20W", sku: "SY-BAT-20", category: "Lighting", brand: "Syska", unit: "pcs", hsn: "9405", gst: 18, purchase: 210, sell: 289, mrp: 349, min: 25, max: 250, reorder: 50, supplierKey: "local", opening: 70 },
    { key: "bulb9", name: "LED Bulb 9W B22", sku: "SY-BLB-9", category: "Lighting", brand: "Syska", unit: "pcs", hsn: "8539", gst: 18, purchase: 55, sell: 79, mrp: 99, min: 100, max: 1000, reorder: 200, supplierKey: "local", opening: 350 },
    { key: "cab15", name: "1.5 sq.mm FR Copper Wire (90m)", sku: "PC-WR-15", category: "Wiring & Cables", brand: "Polycab", unit: "coil", hsn: "8544", gst: 18, purchase: 1850, sell: 2250, mrp: 2499, min: 20, max: 120, reorder: 30, supplierKey: "polycab", opening: 45 },
    { key: "cab25", name: "2.5 sq.mm FR Copper Wire (90m)", sku: "PC-WR-25", category: "Wiring & Cables", brand: "Polycab", unit: "coil", hsn: "8544", gst: 18, purchase: 2950, sell: 3550, mrp: 3999, min: 15, max: 100, reorder: 25, supplierKey: "polycab", opening: 35 },
    { key: "cab40", name: "4.0 sq.mm FR Copper Wire (90m)", sku: "PC-WR-40", category: "Wiring & Cables", brand: "Polycab", unit: "coil", hsn: "8544", gst: 18, purchase: 4200, sell: 5100, mrp: 5699, min: 10, max: 80, reorder: 20, supplierKey: "polycab", opening: 22 },
    { key: "lan", name: "Cat6 UTP Cable Box 305m", sku: "DL-CAT6", category: "Wiring & Cables", brand: "D-Link", unit: "box", hsn: "8544", gst: 18, purchase: 6200, sell: 7800, mrp: 8999, min: 8, max: 40, reorder: 12, supplierKey: "local", opening: 18 },
    { key: "sw1", name: "1-Way Modular Switch 10A", sku: "LG-SW-1W", category: "Switches & Sockets", brand: "Legrand", unit: "pcs", hsn: "8536", gst: 18, purchase: 48, sell: 72, mrp: 89, min: 200, max: 2000, reorder: 400, supplierKey: "legrand", opening: 600 },
    { key: "sock", name: "6A Socket Outlet", sku: "LG-SK-6A", category: "Switches & Sockets", brand: "Legrand", unit: "pcs", hsn: "8536", gst: 18, purchase: 95, sell: 135, mrp: 169, min: 150, max: 1200, reorder: 250, supplierKey: "legrand", opening: 400 },
    { key: "plate", name: "Modular Plate 8M", sku: "LG-PL-8M", category: "Switches & Sockets", brand: "Legrand", unit: "pcs", hsn: "3926", gst: 18, purchase: 110, sell: 165, mrp: 199, min: 80, max: 600, reorder: 120, supplierKey: "legrand", opening: 220 },
    { key: "mcb16", name: "MCB SP 16A C-Curve", sku: "SC-MCB-16", category: "Switchgear & MCB", brand: "Schneider", unit: "pcs", hsn: "8536", gst: 18, purchase: 185, sell: 255, mrp: 299, min: 50, max: 400, reorder: 80, supplierKey: "schneider", opening: 140 },
    { key: "mcb32", name: "MCB SP 32A C-Curve", sku: "SC-MCB-32", category: "Switchgear & MCB", brand: "Schneider", unit: "pcs", hsn: "8536", gst: 18, purchase: 210, sell: 289, mrp: 349, min: 40, max: 300, reorder: 60, supplierKey: "schneider", opening: 100 },
    { key: "rccb", name: "RCCB 2P 40A 30mA", sku: "SC-RCCB-40", category: "Switchgear & MCB", brand: "Schneider", unit: "pcs", hsn: "8536", gst: 18, purchase: 1450, sell: 1890, mrp: 2199, min: 15, max: 80, reorder: 20, supplierKey: "schneider", opening: 28 },
    { key: "db8", name: "Distribution Board 8-Way SPN", sku: "HV-DB-8", category: "Switchgear & MCB", brand: "Havells", unit: "pcs", hsn: "8537", gst: 18, purchase: 980, sell: 1350, mrp: 1599, min: 10, max: 60, reorder: 15, supplierKey: "havells", opening: 20 },
    { key: "fan48", name: "Ceiling Fan 1200mm", sku: "HV-FAN-48", category: "Fans", brand: "Havells", unit: "pcs", hsn: "8414", gst: 18, purchase: 1850, sell: 2499, mrp: 2899, min: 12, max: 80, reorder: 20, supplierKey: "havells", opening: 30 },
    { key: "exh", name: "Exhaust Fan 225mm", sku: "HV-EXH-9", category: "Fans", brand: "Havells", unit: "pcs", hsn: "8414", gst: 18, purchase: 920, sell: 1299, mrp: 1499, min: 10, max: 60, reorder: 15, supplierKey: "havells", opening: 24 },
    { key: "iron", name: "Dry Iron 1000W", sku: "HV-IRN-1K", category: "Home Appliances", brand: "Havells", unit: "pcs", hsn: "8516", gst: 18, purchase: 780, sell: 1099, mrp: 1299, min: 8, max: 40, reorder: 12, supplierKey: "havells", opening: 16 },
    { key: "gpon", name: "Cisco Catalyst 9200 24P", sku: "CS-C9200-24", category: "Industrial Motors & Drives", brand: "Cisco", unit: "pcs", hsn: "8517", gst: 18, purchase: 1_85_000, sell: 2_25_000, mrp: 2_49_000, min: 2, max: 12, reorder: 3, supplierKey: "cisco", opening: 4 },
    { key: "ap", name: "Cisco Meraki MR36 AP", sku: "CS-MR36", category: "Industrial Motors & Drives", brand: "Cisco", unit: "pcs", hsn: "8517", gst: 18, purchase: 28_500, sell: 34_900, mrp: 39_999, min: 4, max: 30, reorder: 6, supplierKey: "cisco", opening: 10 },
    { key: "router", name: "TP-Link Archer AX55", sku: "TP-AX55", category: "Tools & Equipment", brand: "TP-Link", unit: "pcs", hsn: "8517", gst: 18, purchase: 6_200, sell: 7_999, mrp: 8_999, min: 10, max: 60, reorder: 15, supplierKey: "tplink", opening: 22 },
    { key: "sw24", name: "TP-Link 24-Port Gigabit Switch", sku: "TP-SG1024", category: "Tools & Equipment", brand: "TP-Link", unit: "pcs", hsn: "8517", gst: 18, purchase: 4_800, sell: 6_299, mrp: 6_999, min: 8, max: 40, reorder: 12, supplierKey: "tplink", opening: 15 },
    { key: "ups1", name: "APC Back-UPS 1100VA", sku: "APC-BX1100", category: "Tools & Equipment", brand: "APC", unit: "pcs", hsn: "8504", gst: 18, purchase: 7_200, sell: 9_499, mrp: 10_999, min: 6, max: 36, reorder: 10, supplierKey: "apc", opening: 12 },
    { key: "ups2", name: "APC Smart-UPS 1500VA", sku: "APC-SMT1500", category: "Tools & Equipment", brand: "APC", unit: "pcs", hsn: "8504", gst: 18, purchase: 32_000, sell: 39_900, mrp: 44_999, min: 3, max: 18, reorder: 5, supplierKey: "apc", opening: 6 },
    { key: "tool", name: "Crimping Tool RJ45", sku: "JX-CRIMP", category: "Tools & Equipment", brand: "JustTestX", unit: "pcs", hsn: "8205", gst: 18, purchase: 350, sell: 549, mrp: 699, min: 15, max: 80, reorder: 20, supplierKey: "local", opening: 40 },
    { key: "tester", name: "Cable Continuity Tester", sku: "JX-TEST", category: "Tools & Equipment", brand: "JustTestX", unit: "pcs", hsn: "9030", gst: 18, purchase: 420, sell: 699, mrp: 849, min: 10, max: 50, reorder: 15, supplierKey: "local", opening: 25 },
    { key: "patch", name: "Cat6 Patch Cord 1m (pack of 10)", sku: "DL-PC-1M", category: "Wiring & Cables", brand: "D-Link", unit: "pack", hsn: "8544", gst: 18, purchase: 480, sell: 699, mrp: 799, min: 30, max: 200, reorder: 50, supplierKey: "local", opening: 80 },
    { key: "race", name: "PVC Casing Caping 25mm (2m)", sku: "FX-CAS-25", category: "Wiring & Cables", brand: "Finolex", unit: "pcs", hsn: "3917", gst: 18, purchase: 35, sell: 55, mrp: 69, min: 200, max: 2000, reorder: 400, supplierKey: "local", opening: 500 },
    { key: "gland", name: "Cable Gland PG-13.5", sku: "JX-GL-13", category: "Tools & Equipment", brand: "JustTestX", unit: "pcs", hsn: "7419", gst: 18, purchase: 18, sell: 32, mrp: 45, min: 100, max: 1000, reorder: 200, supplierKey: "local", opening: 300 },
    { key: "tape", name: "Insulation Tape Black (pack)", sku: "JX-TAP-BK", category: "Tools & Equipment", brand: "JustTestX", unit: "pack", hsn: "3919", gst: 18, purchase: 45, sell: 75, mrp: 99, min: 50, max: 400, reorder: 80, supplierKey: "local", opening: 120 },
    { key: "led40", name: "Street Light LED 40W", sku: "HV-SL-40", category: "Lighting", brand: "Havells", unit: "pcs", hsn: "9405", gst: 18, purchase: 1850, sell: 2450, mrp: 2799, min: 8, max: 50, reorder: 12, supplierKey: "havells", opening: 14 },
    { key: "mcb63", name: "MCB TP 63A", sku: "SC-MCB-63T", category: "Switchgear & MCB", brand: "Schneider", unit: "pcs", hsn: "8536", gst: 18, purchase: 980, sell: 1350, mrp: 1599, min: 8, max: 40, reorder: 12, supplierKey: "schneider", opening: 16 },
    { key: "wifi6", name: "TP-Link Deco X20 Mesh (3-pack)", sku: "TP-DX20-3", category: "Tools & Equipment", brand: "TP-Link", unit: "set", hsn: "8517", gst: 18, purchase: 14_500, sell: 18_999, mrp: 21_999, min: 4, max: 24, reorder: 6, supplierKey: "tplink", opening: 8 },
    { key: "pdu", name: "APC Rack PDU Basic 1U", sku: "APC-PDU-1U", category: "Tools & Equipment", brand: "APC", unit: "pcs", hsn: "8537", gst: 18, purchase: 8_800, sell: 11_500, mrp: 12_999, min: 3, max: 20, reorder: 5, supplierKey: "apc", opening: 6 },
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
  finalStock: StockMap;
};

/** Build a coherent 2-year IMS world with stock-consistent movements. */
export function buildImsWorld(userId: number): BuiltImsWorld {
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
    const period = fiscalYearLabel(date, 4);
    const k = `${key}|${period}`;
    const n = (seqMax.get(k) ?? 0) + 1;
    seqMax.set(k, n);
    return { period, n, no: formatDocNo(key === "po" ? "PO" : key === "invoice" ? "SI" : key === "bill" ? "PB" : key === "return" ? "RT" : key === "check" ? "SC" : key === "ticket" ? "TK" : key === "payrun" ? "RUN" : "DOC", period, n) };
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

  // Chronological month loop: receive stock mid-month, then sell — keeps movement_date vs stock consistent.
  let poIdx = 0;
  let invIdx = 0;
  for (const ym of eachMonth(IMS_WINDOW_START.slice(0, 7), IMS_TODAY.slice(0, 7))) {
    // Order early in the month and receive on day 3 so subsequent sales dates stay after stock IN.
    const orderDate = `${ym}-01`;
    if (orderDate >= IMS_WINDOW_START && orderDate <= IMS_TODAY) {
      poIdx += 1;
      const supplier = suppliers[poIdx % suppliers.length]!;
      const lineItems = activeItems.filter((_, i) => (i + poIdx) % 3 === 0).slice(0, 6);
      if (lineItems.length) {
        const linesIn: ImsLineInput[] = lineItems.map((it) => {
          const qty = Math.max(it.reorder, 5) + (poIdx % 5) * 2;
          return { itemId: itemId(it.key), name: it.name, sku: it.sku, hsn: it.hsn, unit: it.unit, qty, rate: it.purchase, gstRate: it.gst, receivedQty: 0 };
        });
        const statusRoll = poIdx % 12;
        let status = "received";
        if (statusRoll === 0) status = "draft";
        else if (statusRoll === 1) status = "pending_approval";
        else if (statusRoll === 2) status = "partially_received";
        else if (statusRoll === 3) status = "rejected";
        else if (statusRoll === 4) status = "cancelled";
        else if (statusRoll === 5) status = "sent";
        const received = status === "received" ? true : status === "partially_received" ? "partial" : false;
        if (received === true) for (const l of linesIn) l.receivedQty = l.qty;
        else if (received === "partial") for (const l of linesIn) l.receivedQty = Math.max(1, Math.floor(l.qty / 2));

        const totals = computeTotals(linesIn, true);
        const { no } = bumpSeq("po", orderDate);
        const poId = tid(`ims:po:${ym}:${supplier.key}`);
        pos.push({
          id: poId,
          poNo: no,
          status,
          supplierId: partyId(supplier.key),
          supplierName: supplier.name,
          supplierSnapshot: { name: supplier.name, gstin: supplier.gstin, state: supplier.state, city: supplier.city },
          businessSnapshot: { name: IMS_SETTINGS.businessName, gstin: GSTIN, state: "Karnataka" },
          orderDate,
          expectedDate: addDays(orderDate, 5),
          lines: totals.lines,
          subtotal: totals.subtotal,
          taxTotal: totals.taxTotal,
          grandTotal: totals.grandTotal,
          notes: `Monthly replenishment ${ym}`,
          decidedAt: ["draft", "pending_approval"].includes(status) ? null : `${orderDate} 12:00:00`,
          sentAt: ["sent", "partially_received", "received"].includes(status) ? `${orderDate} 14:00:00` : null,
          receivedAt: status === "received" || status === "partially_received" ? addDays(orderDate, 2) : null,
        });

        if (received) {
          const recvDate = addDays(orderDate, 2);
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
          const billDate = addDays(orderDate, 3);
          const { no: billNo } = bumpSeq("bill", billDate);
          const billId = tid(`ims:bill:${ym}:${supplier.key}`);
          const billStatus =
            status === "partially_received"
              ? "on_hold"
              : billDate < addMonths(IMS_TODAY, -1)
                ? "approved"
                : poIdx % 11 === 0
                  ? "pending_approval"
                  : poIdx % 13 === 0
                    ? "scheduled"
                    : "approved";
          const billTotal = computeTotals(
            linesIn.map((l) => ({ ...l, qty: l.receivedQty ?? 0 })),
            true,
          );
          const paidAmt =
            billStatus === "approved" && billDate < addMonths(IMS_TODAY, -2)
              ? billTotal.grandTotal
              : billStatus === "approved" && billDate < addMonths(IMS_TODAY, -1)
                ? Math.round(billTotal.grandTotal * 0.5)
                : 0;
          bills.push({
            id: billId,
            billNo,
            supplierBillNo: `VND-${ym.replace("-", "")}-${poIdx}`,
            status: billStatus === "on_hold" ? "on_hold" : billStatus,
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
        }
      }
    }

    // Sales after receipt (day 3) so calendar order matches stock application order
    const days = [4, 6, 9, 11, 14, 16, 18, 21, 23, 25, 27, 28].filter((d) => d <= daysInMonth(ym));
    for (const day of days) {
      const invDate = `${ym}-${String(day).padStart(2, "0")}`;
      if (invDate < IMS_WINDOW_START || invDate > IMS_TODAY) continue;
      if (!isWorkday(invDate) && day !== 3) continue;
      invIdx += 1;
      const customer = customers[invIdx % customers.length]!;
      const nLines = 2 + (invIdx % 4);
      const picked = activeItems.filter((_, i) => (i + invIdx) % 5 !== 0).slice(0, nLines);
      const linesIn: ImsLineInput[] = [];
      for (const it of picked) {
        const avail = stock.get(it.key) ?? 0;
        if (avail < 1) continue;
        const qty = Math.min(avail, 1 + (invIdx + it.key.length) % Math.max(3, Math.floor(avail / 4)));
        if (qty < 1) continue;
        linesIn.push({ itemId: itemId(it.key), name: it.name, sku: it.sku, hsn: it.hsn, unit: it.unit, qty, rate: it.sell, discountPct: invIdx % 19 === 0 ? 5 : 0, gstRate: it.gst });
      }
      if (!linesIn.length) continue;

      const isIntra = intra(customer.state);
      const totals = computeTotals(linesIn, isIntra, invIdx % 23 === 0);
      const roll = invIdx % 29;
      let status: "draft" | "issued" | "cancelled" = "issued";
      if (roll === 0) status = "draft";
      else if (roll === 1) status = "cancelled";

      const { no } = bumpSeq("invoice", invDate);
      const invId = tid(`ims:inv:${ym}:${day}:${customer.key}`);
      let amountPaid = 0;
      let payMode: string | null = null;
      if (status === "issued") {
        if (invDate < addMonths(IMS_TODAY, -2)) {
          amountPaid = totals.grandTotal;
          payMode = invIdx % 3 === 0 ? "upi" : "bank";
        } else if (invDate < addMonths(IMS_TODAY, -1)) {
          amountPaid = Math.round(totals.grandTotal * 0.4 * 100) / 100;
          payMode = "bank";
        } else if (roll === 5) {
          amountPaid = 0; // overdue unpaid
        }
      }

      const dueDate = addDays(invDate, customer.terms);
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
        promiseDate: roll === 5 ? addDays(IMS_TODAY, 7) : null,
        promiseAmount: roll === 5 ? totals.grandTotal : null,
        sourceTool: roll === 11 ? "pos" : null,
        issuedAt: status === "issued" ? `${invDate} 11:30:00` : null,
        cancelledAt: status === "cancelled" ? `${invDate} 15:00:00` : null,
        cancelReason: status === "cancelled" ? "Duplicate entry" : null,
        notes: status === "draft" ? "Draft — awaiting confirmation" : null,
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
            refType: roll === 11 ? "pos" : "invoice",
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

  // Unmatched bank credit for recon testing
  bankTxns.push({
    id: tid("ims:bank:unmatched"),
    txnDate: addDays(IMS_TODAY, -3),
    description: "NEFT CR UNKNOWN SENDER",
    amount: 12_500,
    direction: "in",
    status: "unmatched",
    matchedType: null,
    matchedId: null,
    reference: "NUNK99",
  });

  // End-of-window stock events — all dated on/after the last sales day and applied in
  // chronological call order so movement_date / created_at / after_qty stay aligned.
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

  // Expenses monthly
  for (const ym of eachMonth(IMS_WINDOW_START.slice(0, 7), IMS_TODAY.slice(0, 7))) {
    const d = `${ym}-12`;
    if (d > IMS_TODAY) continue;
    expenses.push({
      id: tid(`ims:exp:rent:${ym}`),
      expenseDate: d,
      category: "Rent & office",
      description: "Warehouse share",
      amount: 45_000,
      payMethod: "bank",
      vendor: "Indira Workspace",
    });
    if (Number(ym.slice(5)) % 2 === 0) {
      expenses.push({
        id: tid(`ims:exp:fuel:${ym}`),
        expenseDate: `${ym}-20`,
        category: "Transportation",
        description: "Last-mile deliveries",
        amount: 8_500 + (Number(ym.slice(5)) * 137) % 3000,
        payMethod: "upi",
        vendor: null,
      });
    }
  }

  // Daily closings — last 45 workdays
  let cash = 25_000;
  for (let i = 45; i >= 0; i--) {
    const d = addDays(IMS_TODAY, -i);
    if (!isWorkday(d)) continue;
    const daySales = invoices.filter((inv) => inv.invoiceDate === d && inv.status === "issued").reduce((s, inv) => s + Number(inv.grandTotal), 0);
    const expected = cash + Math.round(daySales * 0.15);
    const closed = i > 0;
    const counted = closed ? expected + (i % 7 === 0 ? -120 : 0) : null;
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

  // Field ops
  const fieldUser = userId;
  const sites = [
    { party: "cascade", name: "Cascade Koramangala", lat: 12.9352, lng: 77.6245 },
    { party: "meridian", name: "Meridian Whitefield", lat: 12.9698, lng: 77.75 },
    { party: "bright", name: "Bright Homes Mysuru", lat: 12.2958, lng: 76.6394 },
    { party: "spark", name: "Sparkline site HSR", lat: 12.9116, lng: 77.6473 },
  ];
  for (let i = 0; i < 20; i++) {
    const d = addDays(IMS_TODAY, -i * 3);
    if (d < IMS_WINDOW_START) continue;
    const site = sites[i % sites.length]!;
    const statuses = ["open", "in_progress", "done", "cancelled"] as const;
    const st = statuses[i % 4]!;
    const taskId = tid(`ims:ftask:${i}`);
    fieldTasks.push({
      id: taskId,
      title: `${st === "done" ? "Delivered" : "Visit"} — ${site.name}`,
      taskType: i % 3 === 0 ? "delivery" : i % 3 === 1 ? "collection" : "visit",
      status: st,
      priority: i % 5 === 0 ? "urgent" : i % 5 === 1 ? "high" : "normal",
      assigneeUserId: fieldUser,
      assigneeName: OWNER_NAME,
      partyId: partyId(site.party),
      partyName: IMS_CUSTOMERS.find((c) => c.key === site.party)!.name,
      siteAddress: site.name,
      lat: site.lat,
      lng: site.lng,
      dueOn: d,
      amount: i % 3 === 1 ? 25_000 : null,
      completedAt: st === "done" ? `${d} 17:00:00` : null,
    });
    fieldCheckins.push({
      id: tid(`ims:fchk:${i}`),
      userId: fieldUser,
      userName: OWNER_NAME,
      kind: i % 4 === 0 ? "check_in" : i % 4 === 1 ? "ping" : i % 4 === 2 ? "status" : "check_out",
      fieldStatus: i % 4 === 0 ? "at_site" : i % 4 === 1 ? "travelling" : "active",
      lat: site.lat,
      lng: site.lng,
      accuracyM: 15,
      siteName: site.name,
      taskId,
      pingDate: d,
      note: "Seed field ping",
    });
    if (i % 2 === 0) {
      const outcomes = ["completed", "follow_up", "order_received", "payment_collected", "customer_unavailable", "rescheduled"] as const;
      fieldVisits.push({
        id: tid(`ims:fvis:${i}`),
        userId: fieldUser,
        userName: OWNER_NAME,
        visitDate: d,
        siteName: site.name,
        partyId: partyId(site.party),
        partyName: IMS_CUSTOMERS.find((c) => c.key === site.party)!.name,
        purpose: "visit",
        taskId,
        address: site.name,
        inLat: site.lat,
        inLng: site.lng,
        checkedOutAt: `${d} 16:30:00`,
        outLat: site.lat,
        outLng: site.lng,
        summary: "Routine dealer visit — seed data",
        outcome: outcomes[i % outcomes.length],
        nextVisitOn: addDays(d, 14),
      });
    }
  }

  // Audit flags
  audit.push(
    { id: tid("ims:aud:1"), kind: "flag", title: "High overdue — Harbor Education", severity: "high", status: "open", area: "aging", entityType: "party", entityId: partyId("harbor") },
    { id: tid("ims:aud:2"), kind: "flag", title: "Negative margin on draft invoice", severity: "medium", status: "responded", area: "sales", entityType: "invoice", entityId: null },
    { id: tid("ims:aud:3"), kind: "query", title: "CA query: GSTR-2B vs purchase bills", severity: "critical", status: "open", area: "gst", entityType: null, entityId: null },
    { id: tid("ims:aud:4"), kind: "flag", title: "Stock variance after count", severity: "low", status: "resolved", area: "inventory", entityType: "item", entityId: itemId("bulb9") },
    { id: tid("ims:aud:5"), kind: "query", title: "Bank unmatched credit", severity: "medium", status: "dismissed", area: "banking", entityType: null, entityId: null },
  );

  // Tickets
  for (const [i, [subj, st]] of [
    ["POS scanner not pairing", "open"],
    ["Need GST report for Sep", "in_progress"],
    ["Wrong HSN on cable SKU", "waiting"],
    ["Tally sync failed last night", "resolved"],
    ["Request new customer credit limit", "closed"],
  ].entries()) {
    const { no } = bumpSeq("ticket", addDays(IMS_TODAY, -i * 4));
    tickets.push({
      id: tid(`ims:tk:${i}`),
      ticketNo: no,
      subject: subj,
      status: st,
      priority: i === 0 ? "high" : "normal",
      description: `${subj} — JustTestX seed ticket`,
      raisedByName: OWNER_NAME,
    });
  }

  // Reports
  reports.push(
    { id: tid("ims:rep:1"), name: "Daily sales flash", reportType: "sales_daily", schedule: "daily", status: "active", approvalStatus: "approved", format: "xlsx" },
    { id: tid("ims:rep:2"), name: "Monthly GST summary", reportType: "gst_summary", schedule: "monthly", status: "active", approvalStatus: "sent", format: "pdf" },
    { id: tid("ims:rep:3"), name: "Low stock alert", reportType: "low_stock", schedule: "weekly", status: "paused", approvalStatus: "draft", format: "xlsx" },
    { id: tid("ims:rep:4"), name: "AR aging pack", reportType: "ar_aging", schedule: "weekly", status: "active", approvalStatus: "pending_approval", format: "xlsx" },
  );

  documents.push(
    { id: tid("ims:doc:1"), title: "Dealership agreement — Havells", category: "contract", entityType: "party", entityId: partyId("havells") },
    { id: tid("ims:doc:2"), title: "GSTR-1 Sep 2026 draft", category: "gst", entityType: null, entityId: null },
    { id: tid("ims:doc:3"), title: "Warehouse lease copy", category: "compliance", entityType: null, entityId: null },
  );

  syncLog.push(
    { provider: "tally", direction: "export", entity: "invoices", status: "success", records: 42, message: "Exported issued invoices", actorName: OWNER_NAME },
    { provider: "tally", direction: "import", entity: "parties", status: "partial", records: 3, message: "2 parties skipped — duplicate GSTIN", actorName: OWNER_NAME },
    { provider: "pos", direction: "import", entity: "sales", status: "failed", records: 0, message: "POS gateway timeout", actorName: OWNER_NAME },
  );

  const sequences = [...seqMax.entries()].map(([k, value]) => {
    const [key, period] = k.split("|") as [string, string];
    return { key, period, value };
  });

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
    finalStock: stock,
  };
}

export { fingerprint };
