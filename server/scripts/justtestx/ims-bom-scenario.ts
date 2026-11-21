/**
 * JustTestX IMS — BOM submodule seed (packages, rate cards, docs, DCs, returns).
 * Called from buildImsWorld after core inventory so stock OUT for approved DCs stays consistent.
 */
import { formatDocNo } from "../../src/ims/logic.js";
import { addDays, addMonths, eachMonth, tid } from "./lib.js";

export type BomParty = {
  key: string;
  name: string;
  city: string;
};

export type BomItemDef = {
  key: string;
  name: string;
  sku: string;
  brand: string;
  unit: string;
  purchase: number;
  sell: number;
};

export type BomSeedWorld = {
  packages: Array<Record<string, unknown>>;
  packageLines: Array<Record<string, unknown>>;
  rateCards: Array<Record<string, unknown>>;
  rateCardLines: Array<Record<string, unknown>>;
  docs: Array<Record<string, unknown>>;
  docLines: Array<Record<string, unknown>>;
  dcs: Array<Record<string, unknown>>;
  dcLines: Array<Record<string, unknown>>;
  dcReturns: Array<Record<string, unknown>>;
  dcReturnLines: Array<Record<string, unknown>>;
  revisions: Array<Record<string, unknown>>;
  invoiceDcLinks: Array<{ invoiceId: string; dcId: string }>;
};

type MoveFn = (opts: {
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
}) => void;

const PKG_DEFS: Array<{
  key: string;
  code: string;
  name: string;
  capacity: string;
  description: string;
  margin: number;
  lineKeys: Array<{ itemKey: string; qty: number; section: string; optional?: boolean }>;
}> = [
  {
    key: "office-led",
    code: "PKG-OFF-LED",
    name: "Office LED Retrofit Kit",
    capacity: "per 1000 sq.ft",
    description: "Panel lights + switches + wiring for open-office retrofit",
    margin: 18,
    lineKeys: [
      { itemKey: "led12", qty: 24, section: "Lighting" },
      { itemKey: "led18", qty: 12, section: "Lighting" },
      { itemKey: "sw1", qty: 40, section: "Switchgear" },
      { itemKey: "sock", qty: 20, section: "Switchgear" },
      { itemKey: "cab15", qty: 4, section: "Cabling" },
      { itemKey: "tape", qty: 6, section: "Consumables", optional: true },
    ],
  },
  {
    key: "net-closet",
    code: "PKG-NET-CL",
    name: "Networking Closet Starter",
    capacity: "24-port closet",
    description: "Switch, AP, UPS, patch and Cat6 for a small IDF",
    margin: 22,
    lineKeys: [
      { itemKey: "sw24", qty: 1, section: "Active" },
      { itemKey: "ap", qty: 2, section: "Active" },
      { itemKey: "ups1", qty: 1, section: "Power" },
      { itemKey: "lan", qty: 1, section: "Cabling" },
      { itemKey: "patch", qty: 4, section: "Cabling" },
      { itemKey: "tool", qty: 1, section: "Tools", optional: true },
    ],
  },
  {
    key: "db-panel",
    code: "PKG-DB-8",
    name: "Distribution Board Package",
    capacity: "8-way SPN",
    description: "DB + MCB/RCCB bundle for residential / small commercial",
    margin: 15,
    lineKeys: [
      { itemKey: "db8", qty: 1, section: "Enclosure" },
      { itemKey: "mcb16", qty: 6, section: "Protection" },
      { itemKey: "mcb32", qty: 2, section: "Protection" },
      { itemKey: "rccb", qty: 1, section: "Protection" },
      { itemKey: "gland", qty: 8, section: "Accessories" },
    ],
  },
  {
    key: "dealer-start",
    code: "PKG-DLR-ST",
    name: "Dealer Counter Starter Pack",
    capacity: "counter display",
    description: "Fast-moving LEDs and accessories for a new dealer counter",
    margin: 12,
    lineKeys: [
      { itemKey: "bulb9", qty: 100, section: "Fast movers" },
      { itemKey: "tube20", qty: 40, section: "Fast movers" },
      { itemKey: "tape", qty: 20, section: "Consumables" },
      { itemKey: "race", qty: 50, section: "Consumables" },
    ],
  },
];

function pkgId(key: string) {
  return tid(`ims:bom:pkg:${key}`);
}
function rateId(key: string) {
  return tid(`ims:bom:rate:${key}`);
}

/**
 * Build BOM packages, rate cards, customer BOMs, DCs and returns.
 * Mutates stock via `move` for approved DC OUT and DC return IN.
 */
export function buildBomSeedWorld(opts: {
  items: BomItemDef[];
  move: MoveFn;
  userId: number;
  ownerName: string;
  businessName: string;
  windowStart: string;
  today: string;
  customers: BomParty[];
  itemId: (key: string) => string;
  partyId: (key: string) => string;
  linkableInvoices: Array<{ id: string; customerKey: string; invoiceDate: string }>;
}): BomSeedWorld {
  const {
    items,
    move,
    userId,
    ownerName,
    businessName,
    windowStart,
    today,
    customers,
    itemId,
    partyId,
    linkableInvoices,
  } = opts;
  const byKey = new Map(items.map((i) => [i.key, i]));
  const packages: BomSeedWorld["packages"] = [];
  const packageLines: BomSeedWorld["packageLines"] = [];
  const rateCards: BomSeedWorld["rateCards"] = [];
  const rateCardLines: BomSeedWorld["rateCardLines"] = [];
  const docs: BomSeedWorld["docs"] = [];
  const docLines: BomSeedWorld["docLines"] = [];
  const dcs: BomSeedWorld["dcs"] = [];
  const dcLines: BomSeedWorld["dcLines"] = [];
  const dcReturns: BomSeedWorld["dcReturns"] = [];
  const dcReturnLines: BomSeedWorld["dcReturnLines"] = [];
  const revisions: BomSeedWorld["revisions"] = [];
  const invoiceDcLinks: BomSeedWorld["invoiceDcLinks"] = [];

  let bomSeq = 0;
  let dcSeq = 0;
  let rtnSeq = 0;
  const nextBomNo = (date: string) => {
    bomSeq += 1;
    return formatDocNo(businessName, "BOM", date, bomSeq);
  };
  const nextDcNo = (date: string) => {
    dcSeq += 1;
    return formatDocNo(businessName, "DC", date, dcSeq);
  };
  const nextRtnNo = (date: string) => {
    rtnSeq += 1;
    return formatDocNo(businessName, "DCR", date, rtnSeq);
  };

  for (const def of PKG_DEFS) {
    const id = pkgId(def.key);
    packages.push({
      id,
      code: def.code,
      name: def.name,
      capacityLabel: def.capacity,
      description: def.description,
      defaultMarginPct: def.margin,
      defaultTaxPct: 18,
      active: 1,
      revision: 1,
      effectiveFrom: windowStart,
      effectiveTo: null,
      variablesJson: JSON.stringify({ capacitySqft: 1000 }),
      optionsJson: JSON.stringify({ includeTools: true }),
    });
    def.lineKeys.forEach((lk, idx) => {
      const it = byKey.get(lk.itemKey);
      if (!it) return;
      packageLines.push({
        id: tid(`ims:bom:pkgl:${def.key}:${lk.itemKey}`),
        packageId: id,
        section: lk.section,
        sortNo: idx + 1,
        lineKind: "stock",
        itemId: itemId(lk.itemKey),
        description: it.name,
        makeText: it.brand,
        qty: lk.qty,
        unit: it.unit,
        scaleByCapacity: lk.section === "Lighting" ? 1 : 0,
        defaultRate: it.sell,
        costRate: it.purchase,
        remarks: null,
        active: 1,
        optionalFlag: lk.optional ? 1 : 0,
        optionKey: lk.optional ? "includeTools" : null,
        serviceSpare: 0,
        scrapPct: 0,
      });
    });
    revisions.push({
      id: tid(`ims:bom:rev:pkg:${def.key}:1`),
      entityType: "package",
      entityId: id,
      revision: 1,
      snapshotJson: JSON.stringify({ code: def.code, name: def.name, lines: def.lineKeys.length }),
    });
  }

  packages.push({
    id: pkgId("legacy"),
    code: "PKG-LEGACY",
    name: "Legacy Halogen Bundle (retired)",
    capacityLabel: null,
    description: "Retired — do not use for new quotes",
    defaultMarginPct: 10,
    defaultTaxPct: 18,
    active: 0,
    revision: 2,
    effectiveFrom: windowStart,
    effectiveTo: addMonths(today, -6),
    variablesJson: null,
    optionsJson: null,
  });

  const dealerRate = rateId("dealer");
  const projectRate = rateId("project");
  rateCards.push(
    {
      id: dealerRate,
      code: "RC-DEALER",
      name: "Dealer list FY",
      currency: "INR",
      validFrom: windowStart,
      validTo: null,
      active: 1,
      notes: "Standard dealer transfer prices",
    },
    {
      id: projectRate,
      code: "RC-PROJECT",
      name: "Project / tender rates",
      currency: "INR",
      validFrom: addMonths(windowStart, 3),
      validTo: addMonths(today, 6),
      active: 1,
      notes: "Elevated margin for turnkey projects",
    },
    {
      id: rateId("expired"),
      code: "RC-OLD",
      name: "FY24 expired card",
      currency: "INR",
      validFrom: addDays(windowStart, -400),
      validTo: addDays(windowStart, -30),
      active: 0,
      notes: "Expired — kept for history",
    },
  );

  const rateItems = items.filter((i) => i.key !== "inactive").slice(0, 20);
  rateItems.forEach((it, idx) => {
    rateCardLines.push({
      id: tid(`ims:bom:rcl:dealer:${it.key}`),
      rateCardId: dealerRate,
      itemId: itemId(it.key),
      sku: it.sku,
      description: it.name,
      unit: it.unit,
      rate: Math.round(it.sell * 0.92 * 100) / 100,
      costRate: it.purchase,
      sortNo: idx + 1,
      active: 1,
    });
    rateCardLines.push({
      id: tid(`ims:bom:rcl:project:${it.key}`),
      rateCardId: projectRate,
      itemId: itemId(it.key),
      sku: it.sku,
      description: it.name,
      unit: it.unit,
      rate: it.sell,
      costRate: it.purchase,
      sortNo: idx + 1,
      active: 1,
    });
  });

  const months = eachMonth(windowStart.slice(0, 7), today.slice(0, 7));
  const statusesCycle = ["draft", "confirmed", "confirmed", "confirmed", "cancelled", "draft"] as const;
  const proposalCycle = [null, "sent", "viewed", "accepted", "rejected", "revoked"] as const;

  months.forEach((ym, mi) => {
    const docDate = `${ym}-08`;
    if (docDate < windowStart || docDate > today) return;
    const pkg = PKG_DEFS[mi % PKG_DEFS.length]!;
    const customer = customers[mi % customers.length]!;
    const status = statusesCycle[mi % statusesCycle.length]!;
    const docId = tid(`ims:bom:doc:${ym}:${pkg.key}`);
    const docNo = nextBomNo(docDate);
    const marginPct = pkg.margin;
    const taxPct = 18;

    const linesBuilt: Array<{
      id: string;
      itemKey: string;
      description: string;
      makeText: string;
      qty: number;
      unit: string;
      rate: number;
      amount: number;
      section: string;
      costRate: number;
      optionalFlag: number;
    }> = [];
    let materials = 0;
    let materialsCost = 0;
    for (const lk of pkg.lineKeys) {
      const it = byKey.get(lk.itemKey);
      if (!it) continue;
      const amount = Math.round(lk.qty * it.sell * 100) / 100;
      materials += amount;
      materialsCost += Math.round(lk.qty * it.purchase * 100) / 100;
      linesBuilt.push({
        id: tid(`ims:bom:dl:${ym}:${lk.itemKey}`),
        itemKey: lk.itemKey,
        description: it.name,
        makeText: it.brand,
        qty: lk.qty,
        unit: it.unit,
        rate: it.sell,
        amount,
        section: lk.section,
        costRate: it.purchase,
        optionalFlag: lk.optional ? 1 : 0,
      });
    }
    const marginAmount = Math.round(materials * (marginPct / 100) * 100) / 100;
    const taxable = materials + marginAmount;
    const taxAmount = Math.round(taxable * (taxPct / 100) * 100) / 100;
    const grandTotal = Math.round((taxable + taxAmount) * 100) / 100;

    const proposalStatus = status === "cancelled" ? "revoked" : proposalCycle[mi % proposalCycle.length];
    const stockIssued =
      status === "confirmed" && mi % 3 !== 0 ? `${addDays(docDate, 10)} 14:00:00` : null;
    // Link invoice↔DC when we will create an approved DC (dcRoll 2 or 3)
    const willApproveDc = status === "confirmed" && (mi % 4 === 2 || mi % 4 === 3);
    const linkInv =
      willApproveDc && linkableInvoices.length
        ? linkableInvoices.find((inv) => inv.customerKey === customer.key) ??
          linkableInvoices[mi % linkableInvoices.length]!
        : null;

    docs.push({
      id: docId,
      packageId: pkgId(pkg.key),
      packageName: pkg.name,
      docNo,
      status,
      docDate,
      capacityLabel: pkg.capacity,
      title: `${pkg.name} — ${customer.name}`,
      customerName: customer.name,
      location: `${customer.city} site`,
      projectRef: `PRJ-${ym.replace("-", "")}`,
      quotationRef: mi % 5 === 0 ? null : `QT-${ym.replace("-", "")}-${mi + 1}`,
      partyId: partyId(customer.key),
      marginPct,
      taxPct,
      materialsTotal: materials,
      marginAmount,
      taxAmount,
      grandTotal,
      materialsCost,
      notes:
        status === "draft"
          ? "Draft BOM — pending site survey"
          : status === "cancelled"
            ? "Cancelled — customer deferred"
            : "Confirmed project BOM",
      preparedBy: ownerName,
      invoiceId: linkInv?.id ?? null,
      invoiceConvertMode: linkInv ? "summary" : null,
      revision: status === "confirmed" && mi % 7 === 0 ? 2 : 1,
      parentDocId: null,
      variablesJson: JSON.stringify({ capacitySqft: 1000 + mi * 50 }),
      optionsJson: JSON.stringify({ includeTools: true }),
      proposalToken: proposalStatus ? tid(`ims:bom:tok:${ym}`).replace(/-/g, "").slice(0, 32) : null,
      proposalStatus,
      proposalSentAt: proposalStatus ? `${addDays(docDate, 1)} 10:00:00` : null,
      proposalRespondedAt:
        proposalStatus && ["accepted", "rejected"].includes(proposalStatus)
          ? `${addDays(docDate, 5)} 16:00:00`
          : null,
      proposalResponseNote:
        proposalStatus === "accepted" ? "Approved by customer" : proposalStatus === "rejected" ? "Budget cut" : null,
      rateCardId: mi % 2 === 0 ? dealerRate : projectRate,
      stockIssuedAt: stockIssued,
      stockIssueCount: stockIssued ? 1 : 0,
      asBuiltAt: stockIssued && mi % 6 === 0 ? `${addDays(docDate, 25)} 18:00:00` : null,
      asBuiltJson: stockIssued && mi % 6 === 0 ? JSON.stringify({ note: "As-built matched BOM" }) : null,
      paymentTerms: "30% advance, balance on delivery",
      deliveryTerms: "Ex-works Bengaluru, 10–14 days",
      warrantyTerms: "12 months manufacturer warranty",
      scopeOfSupply: "Supply of materials as per schedule; installation excluded unless noted.",
      exclusions: "Civil works, earthing pits, and third-party networking licenses excluded.",
      validUntil: addDays(docDate, 30),
    });

    linesBuilt.forEach((ln, idx) => {
      docLines.push({
        id: ln.id,
        docId,
        section: ln.section,
        sortNo: idx + 1,
        lineKind: "stock",
        itemId: itemId(ln.itemKey),
        description: ln.description,
        makeText: ln.makeText,
        qty: ln.qty,
        unit: ln.unit,
        scaleByCapacity: 0,
        rate: ln.rate,
        amount: ln.amount,
        costRate: ln.costRate,
        issuedQty: 0,
        remarks: null,
        optionalFlag: ln.optionalFlag,
        serviceSpare: 0,
        scrapPct: 0,
      });
    });

    revisions.push({
      id: tid(`ims:bom:rev:doc:${ym}:1`),
      entityType: "doc",
      entityId: docId,
      revision: 1,
      snapshotJson: JSON.stringify({ docNo, status: "draft", grandTotal }),
    });
    if (status === "confirmed") {
      revisions.push({
        id: tid(`ims:bom:rev:doc:${ym}:2`),
        entityType: "doc",
        entityId: docId,
        revision: 2,
        snapshotJson: JSON.stringify({ docNo, status: "confirmed", grandTotal }),
      });
    }

    if (status !== "confirmed") return;

    const dcRoll = mi % 4;
    const dcDate = addDays(docDate, 7);
    if (dcDate > today) return;

    const makeDc = (suffix: string, dcStatus: "draft" | "verified" | "approved" | "cancelled", partial = false) => {
      const dcId = tid(`ims:bom:dc:${ym}:${suffix}`);
      const docNoDc = nextDcNo(dcDate);
      const approved = dcStatus === "approved";
      dcs.push({
        id: dcId,
        bomDocId: docId,
        docNo: docNoDc,
        status: dcStatus,
        docDate: dcDate,
        shipTo: `${customer.name}, ${customer.city}`,
        transporter: approved || dcStatus === "verified" ? "JustTestX Logistics" : null,
        vehicleNo: approved ? `KA01AB${1000 + mi}` : null,
        notes: dcStatus === "cancelled" ? "Cancelled — wrong site address" : partial ? "Partial first delivery" : null,
        verifiedBy: ["verified", "approved"].includes(dcStatus) ? userId : null,
        verifiedByName: ["verified", "approved"].includes(dcStatus) ? ownerName : null,
        verifiedAt: ["verified", "approved"].includes(dcStatus) ? `${dcDate} 11:00:00` : null,
        approvedBy: approved ? userId : null,
        approvedByName: approved ? ownerName : null,
        approvedAt: approved ? `${dcDate} 15:30:00` : null,
        stockPosted: approved ? 1 : 0,
      });

      const lineSlice = partial ? linesBuilt.slice(0, Math.max(1, Math.ceil(linesBuilt.length / 2))) : linesBuilt;
      const createdDcLines: Array<{
        id: string;
        bomLineId: string;
        itemKey: string;
        qty: number;
        unit: string;
        description: string;
      }> = [];
      lineSlice.forEach((ln, idx) => {
        const qty = partial ? Math.max(1, Math.floor(ln.qty / 2)) : ln.qty;
        const lineId = tid(`ims:bom:dcl:${ym}:${suffix}:${ln.itemKey}`);
        createdDcLines.push({
          id: lineId,
          bomLineId: ln.id,
          itemKey: ln.itemKey,
          qty,
          unit: ln.unit,
          description: ln.description,
        });
        dcLines.push({
          id: lineId,
          dcId,
          bomLineId: ln.id,
          itemId: itemId(ln.itemKey),
          section: ln.section,
          sortNo: idx + 1,
          description: ln.description,
          makeText: ln.makeText,
          qty,
          returnedQty: 0,
          unit: ln.unit,
          remarks: null,
        });
        if (approved) {
          const dl = docLines.find((d) => d.id === ln.id);
          if (dl) dl.issuedQty = Number(dl.issuedQty ?? 0) + qty;
          move({
            itemKey: ln.itemKey,
            type: "OUT",
            qty,
            delta: -qty,
            date: dcDate,
            refType: "dc",
            refId: dcId,
            refNo: docNoDc,
            partyKey: customer.key,
            partyName: customer.name,
            unitPrice: byKey.get(ln.itemKey)?.sell,
            reason: `BOM DC ${docNoDc}`,
          });
        }
      });

      if (approved && linkInv && suffix === "a") {
        invoiceDcLinks.push({ invoiceId: linkInv.id, dcId });
      }

      if (approved && mi % 5 === 0 && createdDcLines[0]) {
        const rtnDate = addDays(dcDate, 5);
        if (rtnDate <= today) {
          const rtnId = tid(`ims:bom:dcrtn:${ym}`);
          const returnNo = nextRtnNo(rtnDate);
          const src = createdDcLines[0]!;
          const rtnQty = Math.max(1, Math.floor(src.qty / 4));
          dcReturns.push({
            id: rtnId,
            dcId,
            bomDocId: docId,
            returnNo,
            returnDate: rtnDate,
            notes: "Unused material returned from site",
          });
          dcReturnLines.push({
            id: tid(`ims:bom:dcrtnl:${ym}:${src.itemKey}`),
            returnId: rtnId,
            dcId,
            dcLineId: src.id,
            bomLineId: src.bomLineId,
            itemId: itemId(src.itemKey),
            description: src.description,
            qty: rtnQty,
            unit: src.unit,
            remarks: "Good condition — restock",
          });
          const dcl = dcLines.find((l) => l.id === src.id);
          if (dcl) dcl.returnedQty = rtnQty;
          const dl = docLines.find((d) => d.id === src.bomLineId);
          if (dl) dl.issuedQty = Math.max(0, Number(dl.issuedQty ?? 0) - rtnQty);
          move({
            itemKey: src.itemKey,
            type: "RETURN_IN",
            qty: rtnQty,
            delta: rtnQty,
            date: rtnDate,
            refType: "dc",
            refId: rtnId,
            refNo: returnNo,
            partyKey: customer.key,
            partyName: customer.name,
            unitPrice: byKey.get(src.itemKey)?.sell,
            reason: `DC return ${returnNo}`,
          });
        }
      }
    };

    if (dcRoll === 0) {
      makeDc("draft", "draft", true);
    } else if (dcRoll === 1) {
      makeDc("ver", "verified", true);
    } else if (dcRoll === 2) {
      makeDc("a", "approved", true);
      makeDc("b", "draft", true);
    } else {
      makeDc("a", "approved", false);
      makeDc("x", "cancelled", true);
    }
  });

  return {
    packages,
    packageLines,
    rateCards,
    rateCardLines,
    docs,
    docLines,
    dcs,
    dcLines,
    dcReturns,
    dcReturnLines,
    revisions,
    invoiceDcLinks,
  };
}
