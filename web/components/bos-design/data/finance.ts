import { cell as c, TONE, type Block, type KpiSpec, type ModuleSpec } from "../modules/schema";

const b = c.badge;

const aging = (values: [string, string, string, string]): Block => ({
  type: "kpis",
  items: [
    { label: "0–30 days", value: values[0] },
    { label: "31–60 days", value: values[1], valueTone: "amber" },
    { label: "61–90 days", value: values[2], valueTone: "coral" },
    { label: "90+ days", value: values[3], valueTone: "coral" },
  ],
});

const plain = (items: Array<[string, string, KpiSpec["valueTone"]?]>): Block => ({
  type: "kpis",
  items: items.map(([label, value, valueTone]) => ({ label, value, valueTone })),
});

const reportWidget = (title: string, dot: "blue" | "rose" | "mint" | "lavender" | "sage", label: string, badge?: "READY" | "GENERATING") => ({
  title,
  dot,
  rows: [
    badge
      ? { label, badge: { text: badge, tone: badge === "READY" ? ("emerald" as const) : ("amber" as const) }, action: "report:open" }
      : { label, chevron: true, action: "report:open" },
  ],
});

export const FINANCE_MODULES: ModuleSpec[] = [
  {
    key: "dashboard",
    label: "Dashboard",
    icon: "📊",
    title: "Dashboard",
    sub: "Financial KPIs, Revenue, Expenses, Profit & Loss Snapshot, Cash Flow, Outstanding AR/AP, Recent Transactions, Alerts",
    blocks: [
      { type: "custom", id: "fin-toolbar" },
      {
        type: "kpis",
        items: [
          { label: "Revenue (MTD)", value: "₹1.94Cr", chip: ["mint", "₹"], delta: "▲ 12.4% vs last month" },
          { label: "Expenses (MTD)", value: "₹73.4L", chip: ["rose", "₹"], delta: "37.8% of revenue", deltaTone: "muted" },
          { label: "Net Profit (MTD)", value: "₹1.21Cr", chip: ["blue", "◎"], delta: "62.2% margin" },
          { label: "Cash balance", value: "₹68.6L", chip: ["lavender", "◈"], delta: "Across 3 accounts" },
        ],
      },
      {
        type: "kpis",
        items: [
          { label: "Outstanding Receivables", value: "₹42.8L", chip: ["rose", "◐"], delta: "₹8.4L overdue 30+ days", deltaTone: "warn" },
          { label: "Outstanding Payables", value: "₹31.2L", chip: ["blue", "◎"], delta: "14 bills due this week", deltaTone: "muted" },
        ],
      },
      {
        type: "widgets",
        items: [
          {
            title: "🔔 Alerts",
            dot: "blue",
            rows: [
              { label: "Bank statement synced — HDFC", value: "1h ago", soft: true },
              { label: "GST filing due in 4 days", value: "3h ago", soft: true },
              { label: "Payment received — INV-2026-0441", value: "1d ago", soft: true },
            ],
          },
          {
            title: "⏳ Pending Approvals",
            dot: "rose",
            rows: [
              { label: "Vendor bills", value: "5", valueTone: "amber", link: "payables" },
              { label: "Expense claims", value: "4", valueTone: "amber", link: "expenses" },
              { label: "Budget revisions", value: "2", valueTone: "amber", link: "budgeting" },
            ],
          },
          {
            title: "🧾 Recent Transactions",
            dot: "mint",
            rows: [
              { label: "Payment received — Meridian Solar", value: "+₹4,82,000", valueTone: "emerald" },
              { label: "Vendor payment — Vertex Industrial", value: "−₹4,20,000", valueTone: "coral" },
              { label: "Payroll run — July", value: "−₹42,10,000", valueTone: "coral" },
            ],
          },
        ],
      },
      {
        type: "charts",
        items: [
          {
            kind: "grouped",
            title: "Revenue vs Expense trend",
            series: ["Revenue", "Expense"],
            renderHeight: 110,
            data: [
              { label: "Feb", a: 70, b: 45 },
              { label: "Mar", a: 82, b: 50 },
              { label: "Apr", a: 76, b: 48 },
              { label: "May", a: 95, b: 52 },
              { label: "Jun", a: 90, b: 55 },
              { label: "Jul", a: 110, b: 58 },
            ],
          },
          {
            kind: "donut",
            title: "Expense breakdown",
            segments: [
              { label: "Payroll", value: 35, tone: "blue" },
              { label: "Vendors", value: 25, tone: "amber" },
              { label: "Ops", value: 20, tone: "coral" },
              { label: "Other", value: 20, tone: "emerald" },
            ],
            legend: ["Payroll 35%", "Vendors 25%", "Ops 20%", "Other 20%"],
          },
        ],
      },
    ],
  },
  {
    key: "accounting",
    label: "Accounting",
    icon: "📒",
    title: "Accounting",
    sub: "Chart of Accounts, General Ledger, Manual Entries, Balance Summary, Opening Balances, Business Units, Assets",
    blocks: [
      plain([["Opening Balance (FY)", "₹1.42Cr"], ["Business Units", "3"], ["Manual entries (MTD)", "12"]]),
      {
        type: "table",
        label: "Chart of accounts",
        columns: [
          { key: "code", header: "Code" },
          { key: "acct", header: "Account" },
          { key: "type", header: "Type" },
          { key: "bal", header: "Balance", align: "right" },
        ],
        rows: [
          { code: c.mono("1001"), acct: "Cash & Bank", type: b("ASSET", "blue"), bal: c.mono("₹68,60,000") },
          { code: c.mono("1200"), acct: "Accounts Receivable", type: b("ASSET", "blue"), bal: c.mono("₹42,80,000") },
          { code: c.mono("2001"), acct: "Accounts Payable", type: b("LIABILITY", "amber"), bal: c.mono("₹31,20,000") },
          { code: c.mono("3001"), acct: "Owner's Equity", type: b("EQUITY", "lavender"), bal: c.mono("₹1,20,00,000") },
          { code: c.mono("4001"), acct: "Sales Revenue", type: b("INCOME", "emerald"), bal: c.mono("₹1,94,00,000") },
          { code: c.mono("5001"), acct: "Payroll Expense", type: b("EXPENSE", "coral"), bal: c.mono("₹42,10,000") },
        ],
      },
      {
        type: "table",
        label: "General ledger — recent entries",
        columns: [
          { key: "date", header: "Date" },
          { key: "desc", header: "Description" },
          { key: "dr", header: "Debit", align: "right" },
          { key: "cr", header: "Credit", align: "right" },
        ],
        rows: [
          { date: c.mono("28 Jul 2026"), desc: "Payment received — INV-2026-0441", dr: c.mono("₹4,82,000"), cr: c.mono("—") },
          { date: c.mono("27 Jul 2026"), desc: "Vendor bill — Vertex Industrial", dr: c.mono("—"), cr: c.mono("₹4,20,000") },
          { date: c.mono("25 Jul 2026"), desc: "Payroll run — July", dr: c.mono("—"), cr: c.mono("₹42,10,000") },
          { date: c.mono("24 Jul 2026"), desc: "Manual entry — Office rent accrual", dr: c.mono("₹1,80,000"), cr: c.mono("—") },
        ],
      },
    ],
  },
  {
    key: "invoices",
    label: "Invoices",
    icon: "🧾",
    title: "Invoices",
    sub: "Sales Invoices, Credit Notes, Debit Notes, Recurring Invoices, Invoice Templates, Invoice History",
    blocks: [
      {
        type: "kpis",
        items: [
          { label: "Invoiced (MTD)", value: "18", chip: ["blue", "🧾"], delta: "₹1.94Cr total" },
          { label: "Overdue", value: "3", chip: ["rose", "!"], delta: "₹8.4L at risk", deltaTone: "down" },
          { label: "Draft invoices", value: "5", chip: ["lavender", "✎"], delta: "Not yet sent", deltaTone: "muted" },
          { label: "Recurring invoices", value: "4", chip: ["mint", "↻"], delta: "AMC contracts", deltaTone: "muted" },
        ],
      },
      { type: "custom", id: "fin-invoice-filters" },
      {
        type: "table",
        columns: [
          { key: "inv", header: "Invoice" },
          { key: "cust", header: "Customer" },
          { key: "amt", header: "Amount", align: "right" },
          { key: "due", header: "Due Date" },
          { key: "status", header: "Status" },
        ],
        rows: [
          { inv: c.mono("INV-2026-0442"), cust: "Meridian Solar EPC", amt: c.mono("₹1,57,000"), due: c.mono("14 Aug 2026"), status: b("SENT", "blue") },
          { inv: c.mono("INV-2026-0441"), cust: "Meridian Solar EPC", amt: c.mono("₹4,82,000"), due: c.mono("—"), status: b("PAID", "emerald") },
          { inv: c.mono("INV-2026-0439"), cust: "Coastal Resorts Pvt Ltd", amt: c.mono("₹2,10,500"), due: c.mono("2 Jul 2026"), status: b("OVERDUE", "coral") },
          { inv: c.mono("INV-2026-0437"), cust: "Anaya Jewellery", amt: c.mono("₹95,000"), due: c.mono("28 Jun 2026"), status: b("OVERDUE", "coral") },
          { inv: c.mono("INV-2026-0435"), cust: "Vertex Industrial", amt: c.mono("₹3,40,000"), due: c.mono("—"), status: b("PAID", "emerald") },
        ],
      },
    ],
  },
  {
    key: "receivables",
    label: "Receivables (AR)",
    icon: "💰",
    title: "Receivables (AR)",
    sub: "Customer Payments, Outstanding Invoices, Aging Report, Payment Reminders, Customer Statements, Collections",
    blocks: [
      {
        type: "kpis",
        items: [
          { label: "Total receivable", value: "₹42.8L", chip: ["blue", "₹"], delta: "21 open invoices" },
          { label: "Overdue >30 days", value: "₹8.4L", chip: ["rose", "!"], delta: "3 invoices", deltaTone: "down" },
          { label: "Collected (MTD)", value: "₹1.51Cr", chip: ["mint", "✓"], delta: "▲ 9% vs last month" },
          { label: "Avg. DSO", value: "18 days", chip: ["lavender", "◷"], delta: "Days sales outstanding", deltaTone: "muted" },
        ],
      },
      { type: "label", text: "Aging report" },
      aging(["₹34.4L", "₹5.2L", "₹2.1L", "₹1.1L"]),
      {
        type: "approvals",
        label: "Outstanding invoices & collections",
        items: [
          {
            id: "ar1", initials: "CR", tone: TONE.coral, name: "Coastal Resorts Pvt Ltd", meta: "INV-2026-0439 · ₹2,10,500 · 29 days overdue",
            buttons: [
              { label: "Send Reminder", variant: "secondary", outcome: { text: "REMINDED", tone: "blue" } },
              { label: "Mark Paid", variant: "primary", outcome: { text: "PAID", tone: "emerald" } },
            ],
          },
          {
            id: "ar2", initials: "AJ", tone: TONE.amber, name: "Anaya Jewellery", meta: "INV-2026-0437 · ₹95,000 · 33 days overdue",
            buttons: [
              { label: "Send Reminder", variant: "secondary", outcome: { text: "REMINDED", tone: "blue" } },
              { label: "Mark Paid", variant: "primary", outcome: { text: "PAID", tone: "emerald" } },
            ],
          },
        ],
      },
      {
        type: "widgets",
        template: "minmax(0, 400px)",
        items: [
          {
            title: "Customer Statements",
            dot: "blue",
            rows: [
              { label: "Meridian Solar EPC — statement", chevron: true, action: "statement:open" },
              { label: "Coastal Resorts — statement", chevron: true, action: "statement:open" },
            ],
          },
        ],
      },
    ],
  },
  {
    key: "payables",
    label: "Payables (AP)",
    icon: "📤",
    title: "Payables (AP)",
    sub: "Vendor Bills, Supplier Payments, Outstanding Bills, Aging Report, Purchase Orders, Purchase Returns, Payment Scheduling",
    blocks: [
      {
        type: "kpis",
        items: [
          { label: "Total payable", value: "₹31.2L", chip: ["blue", "₹"], delta: "17 open bills" },
          { label: "Due this week", value: "14", chip: ["rose", "!"], delta: "₹9.6L", deltaTone: "warn" },
          { label: "Pending approval", value: "5", chip: ["lavender", "◐"], delta: "₹4.8L", deltaTone: "muted" },
          { label: "Paid (MTD)", value: "₹22.6L", chip: ["mint", "✓"], delta: "42 bills" },
        ],
      },
      { type: "label", text: "Aging report" },
      aging(["₹19.8L", "₹7.4L", "₹3.0L", "₹1.0L"]),
      {
        type: "approvals",
        label: "Bills awaiting approval",
        items: [
          { id: "ap1", initials: "SP", tone: TONE.blue, name: "SolarParts Distributors", meta: "Panel procurement · ₹4,20,000 · Due 5 Aug" },
          { id: "ap2", initials: "OW", tone: TONE.emerald, name: "Office Works Supplies", meta: "Stationery & supplies · ₹18,400 · Due 3 Aug" },
        ],
      },
      {
        type: "table",
        columns: [
          { key: "vendor", header: "Vendor" },
          { key: "ref", header: "Bill / PO #" },
          { key: "amt", header: "Amount", align: "right" },
          { key: "due", header: "Due Date" },
          { key: "status", header: "Status" },
        ],
        rows: [
          { vendor: "Vertex Industrial", ref: c.mono("PO-2291"), amt: c.mono("₹4,20,000"), due: c.mono("5 Aug 2026"), status: b("PENDING", "amber") },
          { vendor: "Kotak Facilities Mgmt", ref: c.mono("BILL-0812"), amt: c.mono("₹1,10,000"), due: c.mono("—"), status: b("PAID", "emerald") },
        ],
      },
    ],
  },
  {
    key: "salesbilling",
    label: "Sales Billing",
    icon: "🛒",
    title: "Sales Billing",
    sub: "POS Billing, Product Billing, Sales Orders, Delivery Challans, Quotations, Billing History",
    blocks: [
      {
        type: "kpis",
        items: [
          { label: "Sales orders (MTD)", value: "27", chip: ["blue", "🛒"], delta: "₹1.18Cr value" },
          { label: "Quotations open", value: "9", chip: ["lavender", "✎"], delta: "₹32.4L pipeline", deltaTone: "muted" },
          { label: "Delivery challans", value: "14", chip: ["mint", "🚚"], delta: "3 pending dispatch", deltaTone: "muted" },
          { label: "POS billing today", value: "₹1.4L", chip: ["rose", "₹"], delta: "18 transactions" },
        ],
      },
      {
        type: "table",
        columns: [
          { key: "no", header: "Order #" },
          { key: "cust", header: "Customer" },
          { key: "type", header: "Type" },
          { key: "amt", header: "Amount", align: "right" },
          { key: "status", header: "Status" },
        ],
        rows: [
          { no: c.mono("SO-1182"), cust: "Meridian Solar EPC", type: c.tag("SALES ORDER", "blue"), amt: c.mono("₹4,82,000"), status: b("DELIVERED", "emerald") },
          { no: c.mono("QT-0417"), cust: "Anaya Jewellery", type: c.tag("QUOTATION", "lavender"), amt: c.mono("₹1,20,000"), status: b("SENT", "blue") },
          { no: c.mono("DC-0289"), cust: "Coastal Resorts Pvt Ltd", type: c.tag("CHALLAN", "mint"), amt: c.mono("₹2,10,500"), status: b("IN TRANSIT", "amber") },
        ],
      },
    ],
  },
  {
    key: "banking",
    label: "Banking",
    icon: "🏦",
    title: "Banking",
    sub: "Bank Accounts, Bank Transactions, Bank Reconciliation, Cash Book, Cheque Management",
    blocks: [
      {
        type: "widgets",
        items: [
          { title: "HDFC Bank — Current A/C", dot: "blue", rows: [{ label: "Balance", value: "₹42,10,000" }, { label: "Last synced", value: "1h ago", valueTone: "faint" }] },
          { title: "ICICI Bank — Current A/C", dot: "mint", rows: [{ label: "Balance", value: "₹18,90,000" }, { label: "Last synced", value: "1h ago", valueTone: "faint" }] },
          { title: "SBI — Payroll A/C", dot: "lavender", rows: [{ label: "Balance", value: "₹7,60,000" }, { label: "Last synced", value: "3h ago", valueTone: "faint" }] },
        ],
      },
      { type: "label", text: "Cheque management" },
      plain([["Cheques issued", "6"], ["Cheques cleared", "4", "emerald"], ["Cheques pending", "2", "amber"]]),
      {
        type: "table",
        label: "Reconciliation status",
        columns: [
          { key: "date", header: "Date" },
          { key: "desc", header: "Description" },
          { key: "amt", header: "Amount", align: "right" },
          { key: "status", header: "Status" },
        ],
        rows: [
          { date: c.mono("28 Jul 2026"), desc: "NEFT — Meridian Solar EPC", amt: c.mono("₹4,82,000"), status: b("MATCHED", "emerald") },
          { date: c.mono("27 Jul 2026"), desc: "UPI — Office Works Supplies", amt: c.mono("₹18,400"), status: b("MATCHED", "emerald") },
          { date: c.mono("26 Jul 2026"), desc: "Unidentified credit", amt: c.mono("₹5,000"), status: b("UNMATCHED", "coral") },
        ],
      },
    ],
  },
  {
    key: "gsttax",
    label: "GST & Tax",
    icon: "📋",
    title: "GST & Tax",
    sub: "GST Invoices, GST Returns, TDS, Tax Calculations, Tax Reports, Compliance Records",
    blocks: [
      {
        type: "kpis",
        items: [
          { label: "GST liability", value: "₹6.8L", chip: ["blue", "₹"], delta: "Due 20 Aug", deltaTone: "warn" },
          { label: "TDS payable", value: "₹1.2L", chip: ["rose", "₹"], delta: "Due 7 Aug", deltaTone: "warn" },
          { label: "GST invoices (MTD)", value: "18", chip: ["lavender", "🧾"], delta: "All compliant", deltaTone: "muted" },
          { label: "Compliance score", value: "96%", chip: ["mint", "✓"], delta: "On track" },
        ],
      },
      {
        type: "table",
        label: "Filings & compliance records",
        columns: [
          { key: "type", header: "Return Type" },
          { key: "period", header: "Period" },
          { key: "due", header: "Due Date" },
          { key: "status", header: "Status" },
        ],
        rows: [
          { type: "GSTR-3B", period: "Jul 2026", due: c.mono("20 Aug 2026"), status: b("DUE SOON", "amber") },
          { type: "TDS — Form 26Q", period: "Q1 FY26-27", due: c.mono("7 Aug 2026"), status: b("DUE SOON", "amber") },
          { type: "GSTR-1", period: "Jun 2026", due: c.mono("11 Jul 2026"), status: b("FILED", "emerald") },
          { type: "Advance Tax — Q1", period: "FY26-27", due: c.mono("15 Jun 2026"), status: b("FILED", "emerald") },
        ],
      },
    ],
  },
  {
    key: "payroll",
    label: "Payroll",
    icon: "💳",
    title: "Payroll",
    sub: "Payroll Summary, Salary, Bank Linking, Payslips, Employees, Attendance, TDS, PF/PT, Payroll Reports, Claims, F&F",
    subtabs: [
      {
        key: "all",
        label: "All",
        blocks: [
          {
            type: "kpis",
            items: [
              { label: "Payroll cost (MTD)", value: "₹42.1L", chip: ["mint", "✓"], delta: "214 employees paid" },
              { label: "Statutory dues (PF+PT)", value: "₹14.2L", chip: ["blue", "₹"], delta: "Due 15 Aug", deltaTone: "warn" },
              { label: "TDS deducted", value: "₹6.8L", chip: ["rose", "₹"], delta: "Due 7 Aug", deltaTone: "warn" },
              { label: "Next payroll run", value: "4 days", chip: ["lavender", "◷"], delta: "1 Aug 2026", deltaTone: "muted" },
            ],
          },
          {
            type: "cards",
            items: [
              {
                heading: "Payroll Run Status",
                tone: "blue",
                rows: [
                  { label: "Attendance & leave sync", badge: { text: "DONE", tone: "emerald" } },
                  { label: "Salary computation", badge: { text: "DONE", tone: "emerald" } },
                  { label: "Statutory deductions", badge: { text: "DONE", tone: "emerald" } },
                  { label: "Bank file & disbursement", badge: { text: "DONE", tone: "emerald" } },
                  { label: "Payslip generation", badge: { text: "DONE", tone: "emerald" } },
                ],
              },
              {
                heading: "Compliance Status",
                tone: "emerald",
                rows: [
                  { label: "PF (EPFO)", badge: { text: "DUE 15 AUG", tone: "amber" } },
                  { label: "PT (Professional Tax)", badge: { text: "FILED", tone: "emerald" } },
                  { label: "TDS (Form 26Q)", badge: { text: "DUE 7 AUG", tone: "amber" } },
                  { label: "ESI", badge: { text: "FILED", tone: "emerald" } },
                  { label: "Labour Welfare Fund", badge: { text: "FILED", tone: "emerald" } },
                ],
              },
              {
                heading: "Pending Actions",
                tone: "coral",
                rows: [
                  { label: "Attendance Pending", value: "4", tone: "amber" },
                  { label: "Salary Revisions", value: "1", tone: "amber" },
                  { label: "Reimbursements", value: "1", tone: "amber" },
                  { label: "Bank Verification", value: "2", tone: "amber" },
                ],
              },
            ],
          },
          {
            type: "charts",
            items: [
              {
                kind: "bars",
                title: "Payroll Trend",
                height: 100,
                renderHeight: 90,
                data: [
                  { label: "Jan ₹39L", value: 50 },
                  { label: "Feb ₹40L", value: 60 },
                  { label: "Mar ₹41L", value: 70 },
                  { label: "Apr ₹40L", value: 60 },
                  { label: "May ₹42L", value: 80 },
                  { label: "Jun ₹41L", value: 70 },
                ],
              },
              {
                kind: "donut",
                title: "Salary Breakdown",
                size: 82,
                segments: [
                  { label: "Basic", value: 40, tone: "blue" },
                  { label: "HRA", value: 20, tone: "emerald" },
                  { label: "Allow.", value: 30, tone: "amber" },
                  { label: "Deduct.", value: 10, tone: "coral" },
                ],
                legend: ["Basic 40%", "HRA 20%", "Allow. 30%", "Deduct. 10%"],
              },
            ],
          },
          {
            type: "approvals",
            label: "Approvals",
            items: [
              { id: "pa1", initials: "JW", tone: TONE.blue, name: "James Workman", meta: "Salary revision — Operations Manager · ₹1,45,000 → ₹1,58,000" },
              { id: "pa2", initials: "PS", tone: TONE.coral, name: "Priya Sharma", meta: "Reimbursement claim — Client travel · ₹8,400" },
              { id: "pa3", initials: "AN", tone: TONE.emerald, name: "Ananya Nair", meta: "Performance bonus — Q2 · ₹35,000" },
            ],
          },
        ],
      },
      {
        key: "employees",
        label: "Employees Summary",
        blocks: [
          {
            type: "kpis",
            items: [
              { label: "Active Employees", value: "214", chip: ["blue", "👤"], delta: "On payroll this cycle" },
              { label: "New Joiners", value: "3", chip: ["mint", "＋"], delta: "Added to July run" },
              { label: "On Notice", value: "2", chip: ["amber", "◷"], delta: "Serving notice period", deltaTone: "warn" },
              { label: "Exits / F&F Pending", value: "1", chip: ["rose", "↩"], delta: "Settlement in progress", deltaTone: "down" },
            ],
          },
          {
            type: "table",
            columns: [
              { key: "emp", header: "Employee" },
              { key: "dept", header: "Department" },
              { key: "role", header: "Designation" },
              { key: "ctc", header: "Monthly CTC", align: "right" },
              { key: "status", header: "Status" },
            ],
            rows: [
              { emp: "James Workman", dept: "Field Operations", role: "Operations Manager", ctc: c.mono("₹1,45,000"), status: b("ACTIVE", "emerald") },
              { emp: "Priya Sharma", dept: "Sales", role: "Sales Executive", ctc: c.mono("₹68,000"), status: b("ACTIVE", "emerald") },
              { emp: "Rahul Khanna", dept: "Field Operations", role: "Field Technician", ctc: c.mono("₹52,000"), status: b("ACTIVE", "emerald") },
              { emp: "Ananya Nair", dept: "Engineering", role: "Backend Engineer", ctc: c.mono("₹1,18,000"), status: b("ACTIVE", "emerald") },
              { emp: "Vikram Singh", dept: "Field Operations", role: "Site Engineer", ctc: c.mono("₹58,000"), status: b("ON NOTICE", "blue") },
              { emp: "Anita Desai", dept: "Human Resources", role: "HR Business Partner", ctc: c.mono("₹95,000"), status: b("ACTIVE", "emerald") },
            ],
          },
        ],
      },
      {
        key: "attendance",
        label: "Attendance Summary",
        blocks: [
          {
            type: "kpis",
            items: [
              { label: "Present Today", value: "198", chip: ["mint", "✓"], delta: "92.5% attendance" },
              { label: "Attendance Tickets", value: "4", chip: ["amber", "🎫"], delta: "Open regularizations", deltaTone: "warn" },
              { label: "Field Service Process", value: "22", chip: ["blue", "🧭"], delta: "On-site today", deltaTone: "muted" },
              { label: "LOP Updates", value: "3", chip: ["rose", "!"], delta: "Affects this payroll run", deltaTone: "down" },
            ],
          },
          {
            type: "table",
            columns: [
              { key: "emp", header: "Employee" },
              { key: "date", header: "Date" },
              { key: "status", header: "Status" },
              { key: "note", header: "Ticket / Note" },
            ],
            rows: [
              { emp: "Rahul Khanna", date: c.mono("26 Jul 2026"), status: b("ABSENT", "coral"), note: "LOP applied — no regularization filed" },
              { emp: "Vikram Singh", date: c.mono("27 Jul 2026"), status: b("LATE", "amber"), note: "Regularization requested" },
              { emp: "James Workman", date: c.mono("27 Jul 2026"), status: b("FIELD VISIT", "blue"), note: "Site inspection — Coastal Resorts" },
              { emp: "Priya Sharma", date: c.mono("25 Jul 2026"), status: b("LATE", "amber"), note: "Regularization requested" },
            ],
          },
        ],
      },
      {
        key: "tds",
        label: "TDS",
        blocks: [
          {
            type: "kpis",
            items: [
              { label: "TDS deducted (MTD)", value: "₹6.8L", chip: ["rose", "₹"], delta: "Across 214 employees" },
              { label: "TDS payable", value: "₹6.8L", chip: ["blue", "₹"], delta: "Due 7 Aug", deltaTone: "warn" },
              { label: "Employees under TDS", value: "86", chip: ["lavender", "👤"], delta: "Taxable income slab", deltaTone: "muted" },
              { label: "Form 26Q status", value: "Q1", chip: ["amber", "◷"], delta: "Due 7 Aug 2026", deltaTone: "warn" },
            ],
          },
          {
            type: "table",
            columns: [
              { key: "emp", header: "Employee" },
              { key: "inc", header: "Taxable Income (Annual)", align: "right" },
              { key: "tds", header: "TDS Deducted (MTD)", align: "right" },
              { key: "status", header: "Status" },
            ],
            rows: [
              { emp: "James Workman", inc: c.mono("₹17,40,000"), tds: c.mono("₹28,600"), status: b("DEDUCTED", "emerald") },
              { emp: "Anita Desai", inc: c.mono("₹11,40,000"), tds: c.mono("₹14,200"), status: b("DEDUCTED", "emerald") },
              { emp: "Ananya Nair", inc: c.mono("₹14,16,000"), tds: c.mono("₹19,800"), status: b("DEDUCTED", "emerald") },
              { emp: "Rahul Khanna", inc: c.mono("₹6,24,000"), tds: c.mono("—"), status: b("BELOW SLAB", "blue") },
            ],
          },
        ],
      },
      {
        key: "payslips",
        label: "Payslips",
        blocks: [
          {
            type: "kpis",
            items: [
              { label: "Generated", value: "214", chip: ["mint", "✓"], delta: "100% of headcount" },
              { label: "Emailed", value: "214", chip: ["blue", "✉"], delta: "Sent 28 Jul, 15:10" },
              { label: "Downloaded", value: "176", chip: ["lavender", "⬇"], delta: "82% opened", deltaTone: "muted" },
              { label: "Pending", value: "0", chip: ["rose", "—"], delta: "All caught up", deltaTone: "muted" },
            ],
          },
          {
            type: "table",
            columns: [
              { key: "emp", header: "Employee" },
              { key: "month", header: "Month" },
              { key: "net", header: "Net Pay", align: "right" },
              { key: "status", header: "Status" },
              { key: "dl", header: "" },
            ],
            rows: [
              { emp: "James Workman", month: "July 2026", net: c.mono("₹1,26,400"), status: b("DOWNLOADED", "emerald"), dl: c.action("⬇ Download", "payslip:download", "ghost") },
              { emp: "Priya Sharma", month: "July 2026", net: c.mono("₹59,200"), status: b("DOWNLOADED", "emerald"), dl: c.action("⬇ Download", "payslip:download", "ghost") },
              { emp: "Rahul Khanna", month: "July 2026", net: c.mono("₹46,800"), status: b("SENT", "blue"), dl: c.action("⬇ Download", "payslip:download", "ghost") },
            ],
          },
        ],
      },
      {
        key: "pfpt",
        label: "PF/PT",
        blocks: [
          {
            type: "kpis",
            items: [
              { label: "PF — Employer share", value: "₹8.4L", chip: ["blue", "₹"], delta: "12% of basic" },
              { label: "PF — Employee share", value: "₹8.4L", chip: ["lavender", "₹"], delta: "12% of basic" },
              { label: "PT deducted", value: "₹0.6L", chip: ["mint", "₹"], delta: "State-mandated slab", deltaTone: "muted" },
              { label: "Filing status", value: "Jul", chip: ["amber", "◷"], delta: "ECR due 15 Aug", deltaTone: "warn" },
            ],
          },
          {
            type: "table",
            columns: [
              { key: "emp", header: "Employee" },
              { key: "pf", header: "PF Number" },
              { key: "amt", header: "PF (Employer+Employee)", align: "right" },
              { key: "pt", header: "PT", align: "right" },
            ],
            rows: [
              { emp: "James Workman", pf: c.mono("MH/PF/0441209"), amt: c.mono("₹34,800"), pt: c.mono("₹200") },
              { emp: "Rahul Khanna", pf: c.mono("MH/PF/0441882"), amt: c.mono("₹12,480"), pt: c.mono("₹200") },
              { emp: "Ananya Nair", pf: c.mono("KA/PF/0398214"), amt: c.mono("₹28,320"), pt: c.mono("₹200") },
            ],
          },
        ],
      },
      {
        key: "reports",
        label: "Reports",
        blocks: [
          {
            type: "widgets",
            cols: 3,
            items: [
              reportWidget("Payroll Reports", "blue", "Monthly register"),
              reportWidget("TDS Reports", "rose", "Form 26Q — Q1"),
              reportWidget("PF Reports", "mint", "ECR & challan — Jul"),
              reportWidget("Claim Reports", "lavender", "Reimbursements — Jul"),
              reportWidget("F&F Reports", "sage", "Full & final — Jul"),
              reportWidget("Bank Advice Reports", "blue", "Disbursement advice — Jul"),
            ],
          },
        ],
      },
      {
        key: "claims",
        label: "Claims",
        blocks: [
          {
            type: "kpis",
            items: [
              { label: "Open claims", value: "4", chip: ["amber", "◐"], delta: "₹22,850 total", deltaTone: "warn" },
              { label: "Approved (MTD)", value: "23", chip: ["mint", "✓"], delta: "₹1.2L reimbursed" },
              { label: "Rejected (MTD)", value: "2", chip: ["rose", "✕"], delta: "Policy mismatch", deltaTone: "muted" },
              { label: "Avg. processing time", value: "2.1 days", chip: ["blue", "⏱"], delta: "Submit to payout", deltaTone: "muted" },
            ],
          },
          {
            type: "approvals",
            items: [
              { id: "cl1", initials: "PS", tone: TONE.coral, name: "Priya Sharma", meta: "Client travel — Mumbai · ₹8,400" },
              { id: "cl2", initials: "JW", tone: TONE.blue, name: "James Workman", meta: "Site fuel & tolls · ₹2,150" },
            ],
          },
        ],
      },
      {
        key: "fnf",
        label: "F&F",
        blocks: [
          {
            type: "kpis",
            items: [
              { label: "Pending F&F", value: "1", chip: ["amber", "◐"], delta: "In progress", deltaTone: "warn" },
              { label: "Completed F&F (FY)", value: "6", chip: ["mint", "✓"], delta: "₹18.4L settled" },
              { label: "Avg. settlement time", value: "12 days", chip: ["blue", "⏱"], delta: "Last working day to payout", deltaTone: "muted" },
            ],
          },
          {
            type: "table",
            columns: [
              { key: "emp", header: "Employee" },
              { key: "lwd", header: "Last Working Day" },
              { key: "amt", header: "Settlement Amount", align: "right" },
              { key: "status", header: "Status" },
            ],
            rows: [
              { emp: "Vikram Singh", lwd: c.mono("31 Aug 2026"), amt: c.mono("₹1,04,200"), status: b("IN PROGRESS", "amber") },
              { emp: c.text("Deepak Rao (ex-employee)"), lwd: c.mono("15 Jun 2026"), amt: c.mono("₹86,500"), status: b("SETTLED", "emerald") },
            ],
          },
        ],
      },
    ],
  },
  {
    key: "expenses",
    label: "Expenses",
    icon: "💼",
    title: "Expenses",
    sub: "Expense Claims, Company Expenses, Petty Cash, Expense Categories, Reimbursements, Expense Approvals",
    blocks: [
      {
        type: "kpis",
        items: [
          { label: "Company expenses (MTD)", value: "₹14.6L", chip: ["rose", "₹"], delta: "Across all departments", deltaTone: "muted" },
          { label: "Pending claims", value: "4", chip: ["amber", "◐"], delta: "₹22,850 total", deltaTone: "warn" },
          { label: "Petty cash balance", value: "₹18,400", chip: ["lavender", "💵"], delta: "HQ float", deltaTone: "muted" },
          { label: "Reimbursed (MTD)", value: "₹1.2L", chip: ["mint", "✓"], delta: "23 claims" },
        ],
      },
      {
        type: "approvals",
        label: "Expense claims awaiting approval",
        items: [
          { id: "ex1", initials: "PS", tone: TONE.coral, name: "Priya Sharma", meta: "Client travel — Mumbai · ₹8,400 · Travel" },
          { id: "ex2", initials: "JW", tone: TONE.blue, name: "James Workman", meta: "Site fuel & tolls · ₹2,150 · Field Ops" },
        ],
      },
      {
        type: "chips",
        label: "Expense categories (MTD)",
        items: ["Travel — ₹6.2L", "Utilities — ₹3.1L", "Office Supplies — ₹1.4L", "Client Entertainment — ₹0.9L", "Petty Cash — ₹0.3L"],
      },
    ],
  },
  {
    key: "budgeting",
    label: "Budgeting",
    icon: "🎯",
    title: "Budgeting",
    sub: "Annual Budget, Department Budgets, Cost Centers, Forecasting, Budget vs Actual, Budget Planning, Project Budgets",
    blocks: [
      plain([["Annual budget (FY26-27)", "₹2.05Cr"], ["Spent to date", "₹1.50Cr"], ["Remaining", "₹0.55Cr", "emerald"]]),
      {
        type: "progress",
        label: "Department budgets — cost centers",
        items: [
          { label: "Field Operations", value: "₹68L / ₹80L", pct: 85, tone: "amber" },
          { label: "Sales & Marketing", value: "₹22L / ₹45L", pct: 49, tone: "emerald" },
          { label: "Engineering", value: "₹51L / ₹60L", pct: 85, tone: "amber" },
          { label: "HR & Admin", value: "₹9L / ₹20L", pct: 45, tone: "emerald" },
        ],
      },
    ],
  },
  {
    key: "assets",
    label: "Assets",
    icon: "🏷️",
    title: "Assets",
    sub: "Asset Register, Asset Allocation, Depreciation, Maintenance, Asset Transfers, Asset Disposal",
    blocks: [
      {
        type: "kpis",
        items: [
          { label: "Total assets", value: "341", chip: ["blue", "▣"], delta: "₹20.5L book value" },
          { label: "Under maintenance", value: "3", chip: ["amber", "🔧"], delta: "Vehicles & equipment", deltaTone: "muted" },
          { label: "Transfers (MTD)", value: "2", chip: ["lavender", "↔"], delta: "Between departments", deltaTone: "muted" },
          { label: "Disposed (FY)", value: "6", chip: ["rose", "🗑"], delta: "Fully depreciated", deltaTone: "muted" },
        ],
      },
      {
        type: "table",
        label: "Asset register & depreciation",
        columns: [
          { key: "asset", header: "Asset" },
          { key: "date", header: "Purchase Date" },
          { key: "cost", header: "Cost", align: "right" },
          { key: "method", header: "Method" },
          { key: "book", header: "Book Value", align: "right" },
        ],
        rows: [
          { asset: "Company Vehicle — KA-01-AB-4521", date: c.mono("4 May 2026"), cost: c.mono("₹9,80,000"), method: "WDV 15%", book: c.mono("₹9,31,000") },
          { asset: "Office Furniture — HQ", date: c.mono("3 Jan 2020"), cost: c.mono("₹4,20,000"), method: "SLM 10%", book: c.mono("₹1,68,000") },
          { asset: "Solar Testing Equipment", date: c.mono("9 Sep 2022"), cost: c.mono("₹6,50,000"), method: "WDV 20%", book: c.mono("₹3,32,800") },
        ],
      },
    ],
  },
  {
    key: "reports",
    label: "Reports",
    icon: "📈",
    title: "Reports",
    sub: "Profit & Loss, Balance Sheet, Cash Flow, Ledger Reports, GST Reports, AR/AP Reports, Financial Analytics",
    blocks: [
      {
        type: "widgets",
        items: [
          reportWidget("Profit & Loss", "sage", "Q3 statement", "READY"),
          reportWidget("Balance Sheet", "blue", "As of 31 Jul", "READY"),
          reportWidget("Cash Flow", "mint", "Q3 statement", "GENERATING"),
          reportWidget("Ledger Reports", "rose", "Jul 2026", "READY"),
        ],
      },
      {
        type: "widgets",
        items: [
          reportWidget("GST Reports", "lavender", "GSTR summary — Jul", "READY"),
          reportWidget("AR/AP Reports", "blue", "Aging summary", "READY"),
          reportWidget("Financial Analytics", "mint", "Custom dashboard"),
        ],
      },
    ],
  },
  {
    key: "audit",
    label: "Audit",
    icon: "🔍",
    title: "Audit",
    sub: "Financial Review, Transaction History, User Activity, Document Verification, Compliance, Audit Reports",
    blocks: [
      {
        type: "kpis",
        items: [
          { label: "Compliance score", value: "96%", chip: ["mint", "✓"], delta: "Last review 15 Jul" },
          { label: "Flagged transactions", value: "2", chip: ["rose", "!"], delta: "Under review", deltaTone: "down" },
          { label: "Documents verified", value: "128/132", chip: ["blue", "📄"], delta: "97% complete", deltaTone: "muted" },
          { label: "Next audit", value: "Q3 2026", chip: ["lavender", "◷"], delta: "External auditor", deltaTone: "muted" },
        ],
      },
      {
        type: "table",
        label: "User activity & transaction history",
        columns: [
          { key: "ts", header: "Timestamp" },
          { key: "user", header: "User" },
          { key: "action", header: "Action" },
          { key: "rec", header: "Record" },
        ],
        rows: [
          { ts: c.mono("28 Jul, 14:22"), user: "Anita Desai", action: "Approved vendor bill", rec: c.mono("PO-2291") },
          { ts: c.mono("28 Jul, 11:05"), user: "James Workman", action: "Submitted expense claim", rec: c.mono("EXP-0842") },
          { ts: c.mono("27 Jul, 16:40"), user: "System", action: "Bank reconciliation run", rec: c.mono("HDFC — Jul") },
          { ts: c.mono("27 Jul, 09:18"), user: "Anita Desai", action: "Edited journal entry", rec: c.mono("JE-1042") },
        ],
      },
      {
        type: "approvals",
        label: "Flagged for review",
        items: [
          {
            id: "au1", initials: "?", tone: TONE.coral, name: "Unidentified bank credit", meta: "₹5,000 · 26 Jul 2026 · No matching invoice",
            buttons: [
              { label: "Investigate", variant: "secondary", outcome: { text: "INVESTIGATING", tone: "amber" } },
              { label: "Resolve", variant: "primary", outcome: { text: "RESOLVED", tone: "emerald" } },
            ],
          },
        ],
      },
    ],
  },
];
