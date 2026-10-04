import { cell as c, TONE, type BadgeSpec, type CelebrationSpec, type ModuleSpec } from "../modules/schema";

/* ---------- Dashboard: department-scoped figures ---------- */

export type HrDeptSnapshot = {
  label: string;
  headcount: number;
  headcountDelta: string;
  present: number;
  attendance: string;
  leave: number;
  leaveDelta: string;
  openpos: number;
  openposDelta: string;
  apprLeave: number;
  apprExp: number;
  apprProfile: number;
  notif: [string, string, string];
  reports: Array<[string, BadgeSpec]>;
};

const READY: BadgeSpec = { text: "READY", tone: "emerald" };
const GENERATING: BadgeSpec = { text: "GENERATING", tone: "amber" };

export const HR_DEPT_FILTERS: Array<{ value: string; label: string }> = [
  { value: "all", label: "All" },
  { value: "accounts", label: "Accounts" },
  { value: "hrops", label: "HR Ops" },
  { value: "admin", label: "Admin" },
  { value: "marketing", label: "Marketing" },
  { value: "sales", label: "Sales" },
  { value: "service", label: "Service" },
  { value: "projects", label: "Projects" },
  { value: "engineering", label: "Engineering" },
  { value: "inventory", label: "Inventory" },
  { value: "products", label: "Products" },
];

export const HR_DEPT_DATA: Record<string, HrDeptSnapshot> = {
  all: { label: "", headcount: 214, headcountDelta: "▲ 6 this quarter", present: 198, attendance: "92.5% attendance", leave: 9, leaveDelta: "4 awaiting approval", openpos: 6, openposDelta: "19 candidates in pipeline", apprLeave: 4, apprExp: 2, apprProfile: 1, notif: ["Payroll processed for July", "New WFH policy published", "3 documents pending verification"], reports: [["Monthly attendance report", GENERATING], ["Q3 payroll cost report", READY], ["Attrition summary — Jul", GENERATING]] },
  accounts: { label: "— Accounts", headcount: 22, headcountDelta: "▲ 1 this quarter", present: 21, attendance: "95.5% attendance", leave: 1, leaveDelta: "0 awaiting approval", openpos: 0, openposDelta: "No open roles", apprLeave: 0, apprExp: 1, apprProfile: 0, notif: ["July closing reconciled", "2 invoices flagged for review", "Vendor payment batch processed"], reports: [["Accounts attendance report", READY], ["Team payroll summary", READY], ["Attrition summary — Jul", READY]] },
  hrops: { label: "— HR Ops", headcount: 8, headcountDelta: "No change", present: 8, attendance: "100% attendance", leave: 0, leaveDelta: "1 awaiting approval", openpos: 0, openposDelta: "No open roles", apprLeave: 1, apprExp: 0, apprProfile: 2, notif: ["Policy acknowledgment reminders sent", "New joiner onboarding — 2 this week", "Q3 appraisal cycle 66% complete"], reports: [["HR Ops attendance report", READY], ["Team payroll summary", READY], ["Policy compliance summary", GENERATING]] },
  admin: { label: "— Admin", headcount: 12, headcountDelta: "▲ 1 this quarter", present: 11, attendance: "91.7% attendance", leave: 1, leaveDelta: "0 awaiting approval", openpos: 1, openposDelta: "3 candidates in pipeline", apprLeave: 0, apprExp: 1, apprProfile: 0, notif: ["Facilities audit scheduled 3 Aug", "New ID cards issued — 2 joiners", "Vendor contract renewal due"], reports: [["Admin attendance report", READY], ["Team payroll summary", READY], ["Asset audit summary", GENERATING]] },
  marketing: { label: "— Marketing", headcount: 14, headcountDelta: "▲ 2 this quarter", present: 13, attendance: "92.9% attendance", leave: 1, leaveDelta: "1 awaiting approval", openpos: 1, openposDelta: "4 candidates in pipeline", apprLeave: 1, apprExp: 1, apprProfile: 0, notif: ["Campaign budget approved for Q3", "2 team members on client travel", "Brand guideline update published"], reports: [["Marketing attendance report", READY], ["Team payroll summary", READY], ["Attrition summary — Jul", READY]] },
  sales: { label: "— Sales", headcount: 51, headcountDelta: "▲ 3 this quarter", present: 47, attendance: "92.2% attendance", leave: 4, leaveDelta: "2 awaiting approval", openpos: 1, openposDelta: "5 candidates in pipeline", apprLeave: 2, apprExp: 3, apprProfile: 1, notif: ["Q3 quota review scheduled", "New CRM training rollout", "Client travel reimbursements pending"], reports: [["Sales attendance report", READY], ["Team payroll summary", READY], ["Attrition summary — Jul", GENERATING]] },
  service: { label: "— Service", headcount: 19, headcountDelta: "No change", present: 17, attendance: "89.5% attendance", leave: 2, leaveDelta: "1 awaiting approval", openpos: 0, openposDelta: "No open roles", apprLeave: 1, apprExp: 0, apprProfile: 0, notif: ["Field service SLA at 94% this month", "2 technicians on-site training", "Spare parts inventory low — 3 items"], reports: [["Service attendance report", READY], ["Team payroll summary", READY], ["SLA compliance summary", GENERATING]] },
  projects: { label: "— Projects", headcount: 16, headcountDelta: "▲ 1 this quarter", present: 15, attendance: "93.8% attendance", leave: 1, leaveDelta: "0 awaiting approval", openpos: 0, openposDelta: "No open roles", apprLeave: 0, apprExp: 0, apprProfile: 0, notif: ["Milestone review — 2 projects on track", "1 project delayed, root cause logged", "Resource allocation updated"], reports: [["Projects attendance report", READY], ["Team payroll summary", READY], ["Utilization summary", READY]] },
  engineering: { label: "— Engineering", headcount: 43, headcountDelta: "▲ 2 this quarter", present: 40, attendance: "93.0% attendance", leave: 3, leaveDelta: "0 awaiting approval", openpos: 2, openposDelta: "3 candidates in pipeline", apprLeave: 0, apprExp: 1, apprProfile: 1, notif: ["Sprint 14 retro completed", "New certification — 2 engineers", "Code freeze starts Friday"], reports: [["Engineering attendance report", READY], ["Team payroll summary", READY], ["Attrition summary — Jul", READY]] },
  inventory: { label: "— Inventory", headcount: 11, headcountDelta: "No change", present: 10, attendance: "90.9% attendance", leave: 1, leaveDelta: "0 awaiting approval", openpos: 0, openposDelta: "No open roles", apprLeave: 0, apprExp: 0, apprProfile: 0, notif: ["Stock audit completed — 2 discrepancies", "Low stock alert — 4 SKUs", "Warehouse safety inspection passed"], reports: [["Inventory attendance report", READY], ["Team payroll summary", READY], ["Stock audit summary", READY]] },
  products: { label: "— Products", headcount: 18, headcountDelta: "▲ 1 this quarter", present: 16, attendance: "88.9% attendance", leave: 2, leaveDelta: "1 awaiting approval", openpos: 1, openposDelta: "1 candidate in pipeline", apprLeave: 1, apprExp: 0, apprProfile: 0, notif: ["Roadmap review scheduled 5 Aug", "New feature spec published", "1 team member on paternity leave"], reports: [["Products attendance report", READY], ["Team payroll summary", READY], ["Attrition summary — Jul", GENERATING]] },
};

export const HR_CELEBRATIONS: CelebrationSpec[] = [
  { initials: "PS", name: "Priya Sharma", tag: "BIRTHDAY · TODAY", pastel: "rose", tint: "coral" },
  { initials: "RK", name: "Rahul Khanna", tag: "3-YR ANNIV. · TOMORROW", pastel: "sage", tint: "amber" },
];

/* ---------- Policies ---------- */

export type PolicyRow = {
  key: string;
  name: string;
  category: BadgeSpec;
  updated: string;
  ack: string;
  mandatory?: boolean;
  acknowledged: boolean;
  dialog?: { icon: string; summary: string };
};

export const HR_POLICIES: PolicyRow[] = [
  { key: "leave", name: "Leave Policy", category: { text: "HR", tag: "sage" }, updated: "1 Jun 2026", ack: "92%", acknowledged: true },
  { key: "wfh", name: "Work From Home Policy", category: { text: "HR", tag: "sage" }, updated: "10 Mar 2026", ack: "74%", acknowledged: true },
  {
    key: "conduct", name: "Code of Conduct", category: { text: "COMPLIANCE", tag: "rose" }, updated: "15 Jan 2026", ack: "98%", acknowledged: false,
    dialog: { icon: "📋", summary: "Sets expectations for professional behavior, workplace ethics, conflicts of interest, and how to report concerns. Applies to every employee regardless of role or location." },
  },
  {
    key: "posh", name: "POSH Policy", category: { text: "COMPLIANCE", tag: "rose" }, updated: "5 Jan 2026", ack: "99%", mandatory: true, acknowledged: false,
    dialog: { icon: "🛡️", summary: "Prevention of Sexual Harassment policy, as required under the POSH Act. Covers reporting channels, the Internal Committee, and timelines for resolution. Acknowledgment is mandatory for all employees." },
  },
  { key: "travel", name: "Travel & Expense Policy", category: { text: "FINANCE", tag: "blue" }, updated: "22 Feb 2026", ack: "81%", acknowledged: true },
  {
    key: "it", name: "IT & Data Security Policy", category: { text: "IT", tag: "lavender" }, updated: "18 Apr 2026", ack: "88%", acknowledged: false,
    dialog: { icon: "🔒", summary: "Rules for handling company data, acceptable use of devices and accounts, password requirements, and what to do if you suspect a security incident." },
  },
];

/* ---------- Module catalogue ---------- */

const LEAVE_SUB = "Attendance, Biometric, Shifts & OT, Remote Work, Holidays, Leave, Regularization, LOP";
const pending = { text: "PENDING", tone: "amber" } as const;
const done = { text: "DONE", tone: "emerald" } as const;
const b = c.badge;

const TRAINING_ACTIONS = {
  type: "actions" as const,
  items: [
    { label: "Apply For Training", action: "training:apply", variant: "primary" as const },
    { label: "Training Schedules", action: "training:schedules" },
    { label: "⬇ Training Certificate", action: "training:certificate" },
  ],
};

export const HR_MODULES: ModuleSpec[] = [
  {
    key: "overview",
    label: "HR Dashboard",
    icon: "📊",
    title: "HR Dashboard",
    sub: "Overview, Quick numbers, Charts, Notifications, Pending reposts & Approvals, Filters",
    compact: true,
    blocks: [{ type: "custom", id: "hr-overview" }],
  },
  {
    key: "employees",
    label: "Employee Management",
    icon: "👤",
    title: "Employee Management",
    sub: "Employee records, Documents, KYC, Emergency Contacts, Bank details, Email IDs",
    blocks: [{ type: "custom", id: "hr-employees" }],
  },
  {
    key: "orgchart",
    label: "Organization",
    icon: "🏢",
    title: "Organization",
    sub: "Departments, Designations, Reporting managers, Org chart, Custom dashboards, Announcements",
    blocks: [
      {
        type: "grid",
        template: "1.4fr 1fr",
        children: [
          {
            type: "table",
            columns: [
              { key: "dept", header: "Department" },
              { key: "head", header: "Head" },
              { key: "hc", header: "Headcount" },
              { key: "open", header: "Open Roles" },
            ],
            rows: [
              { dept: "Field Operations", head: "James Workman", hc: c.mono("90"), open: c.mono("3") },
              { dept: "Sales", head: "Anita Desai", hc: c.mono("51"), open: c.mono("1") },
              { dept: "Engineering", head: "Vivek Rao", hc: c.mono("43"), open: c.mono("2") },
              { dept: "Human Resources", head: "Anita Desai", hc: c.mono("8"), open: c.mono("0") },
              { dept: "Finance", head: "—", hc: c.mono("22"), open: c.mono("0") },
            ],
          },
          {
            type: "widgets",
            cols: 1,
            items: [
              {
                title: "📢 Announcements",
                dot: "blue",
                rows: [
                  { label: "Office closed — Independence Day", value: "15 Aug", valueTone: "faint" },
                  { label: "Q3 town hall — all hands", value: "2 Aug", valueTone: "faint" },
                  { label: "New WFH policy rollout", value: "28 Jul", valueTone: "faint" },
                ],
              },
            ],
          },
        ],
      },
      { type: "label", text: "Org chart" },
      { type: "custom", id: "hr-orgchart" },
      { type: "note", center: true, text: "Solid border = employee record on file, click to open. Dashed border = role not yet added as an employee." },
    ],
  },
  {
    key: "leave",
    label: "Leave & Attendance",
    icon: "🗓️",
    title: "Leave & Attendance",
    sub: LEAVE_SUB,
    subtabs: [
      {
        key: "requests",
        label: "Leave Requests",
        blocks: [
          {
            type: "balances",
            items: [
              { label: "Casual leave (team avg.)", value: "6.2", unit: "days left" },
              { label: "Sick leave (team avg.)", value: "4.8", unit: "days left" },
              { label: "Earned leave (team avg.)", value: "11.4", unit: "days left" },
            ],
          },
          {
            type: "approvals",
            items: [
              { id: "l1", initials: "RK", tone: TONE.amber, name: "Rahul Khanna", meta: "Casual Leave · 29–31 Jul · 3 days" },
              { id: "l2", initials: "PS", tone: TONE.coral, name: "Priya Sharma", meta: "Sick Leave · 28 Jul · 1 day" },
              { id: "l3", initials: "VS", tone: TONE.pastelBlue, name: "Vikram Singh", meta: "Earned Leave · 4–8 Aug · 5 days" },
              { id: "l4", initials: "AN", tone: TONE.emerald, name: "Ananya Nair", meta: "Casual Leave · 1 Aug · 1 day" },
            ],
          },
        ],
      },
      {
        key: "calendar",
        label: "Leave Calendar",
        blocks: [
          {
            type: "calendar",
            title: "July 2026 — Team leave",
            year: 2026,
            month: 6,
            today: 27,
            events: [
              { day: 3, label: "R. Khanna – CL", tint: "blue" },
              { day: 9, label: "2 on leave", tint: "amber" },
              { day: 14, label: "P. Sharma – SL", tint: "emerald" },
              { day: 21, label: "1 on leave", tint: "amber" },
              { day: 27, label: "3 on leave", tint: "amber" },
              { day: 28, label: "P. Sharma – SL", tint: "coral" },
              { day: 29, label: "R. Khanna – CL", tint: "blue" },
              { day: 30, label: "R. Khanna – CL", tint: "blue" },
              { day: 31, label: "R. Khanna – CL", tint: "blue" },
            ],
          },
        ],
      },
      {
        key: "regularization",
        label: "Regularization",
        blocks: [
          { type: "note", text: "Missed punch-ins, forgotten check-outs, or biometric mismatches — employees raise a regularization request explaining the gap, and it's approved against the actual attendance record." },
          {
            type: "approvals",
            items: [
              { id: "r1", initials: "RK", tone: TONE.amber, name: "Rahul Khanna", meta: "26 Jul 2026 · Missed punch-out · Biometric device offline on-site" },
              { id: "r2", initials: "PS", tone: TONE.coral, name: "Priya Sharma", meta: "25 Jul 2026 · Late punch-in · Client meeting ran early, arrived office late" },
              { id: "r3", initials: "VS", tone: TONE.pastelBlue, name: "Vikram Singh", meta: "23 Jul 2026 · No punch recorded · On-site inspection, phone battery died", decided: "approved" },
            ],
          },
        ],
      },
      {
        key: "fieldwork",
        label: "Field Work Request",
        blocks: [
          { type: "note", text: "For employees whose attendance is marked at a client site or field location instead of the office — request logged with location and purpose, counted as present once approved." },
          {
            type: "approvals",
            items: [
              { id: "f1", initials: "JW", tone: TONE.blue, name: "James Workman", meta: "28 Jul 2026 · Coastal Resorts Pvt Ltd · Site inspection, rooftop solar survey" },
              { id: "f2", initials: "RK", tone: TONE.amber, name: "Rahul Khanna", meta: "28–29 Jul 2026 · Meridian Solar EPC · Panel installation, 2-day site work", decided: "approved" },
              { id: "f3", initials: "VS", tone: TONE.pastelBlue, name: "Vikram Singh", meta: "30 Jul 2026 · Anaya Jewellery showroom · Lighting installation follow-up" },
            ],
          },
        ],
      },
      {
        key: "holidays",
        label: "Holidays",
        blocks: [
          {
            type: "table",
            columns: [
              { key: "date", header: "Date" },
              { key: "day", header: "Day" },
              { key: "name", header: "Holiday" },
              { key: "type", header: "Type" },
            ],
            rows: [
              { date: c.mono("15 Aug 2026"), day: "Saturday", name: "Independence Day", type: b("MANDATORY", "emerald") },
              { date: c.mono("27 Aug 2026"), day: "Thursday", name: "Ganesh Chaturthi", type: b("RESTRICTED", "blue") },
              { date: c.mono("2 Oct 2026"), day: "Friday", name: "Gandhi Jayanti", type: b("MANDATORY", "emerald") },
              { date: c.mono("20 Oct 2026"), day: "Tuesday", name: "Dussehra", type: b("RESTRICTED", "blue") },
              { date: c.mono("8 Nov 2026"), day: "Sunday", name: "Diwali", type: b("MANDATORY", "emerald") },
              { date: c.mono("25 Dec 2026"), day: "Friday", name: "Christmas", type: b("MANDATORY", "emerald") },
            ],
          },
        ],
      },
      {
        key: "biometric",
        label: "Attendance / Biometric",
        blocks: [
          {
            type: "kpis",
            items: [
              { label: "Present today", value: "198", chip: ["mint", "✓"], delta: "92.5% attendance" },
              { label: "Late arrivals", value: "7", chip: ["amber", "◐"], delta: "Past 09:15", deltaTone: "warn" },
              { label: "Devices online", value: "4/4", chip: ["blue", "📡"], delta: "All sites synced" },
              { label: "Last sync", value: "3 min", chip: ["lavender", "◷"], delta: "Auto-sync every 5 min", deltaTone: "muted" },
            ],
          },
          {
            type: "table",
            columns: [
              { key: "emp", header: "Employee" },
              { key: "in", header: "Check-in" },
              { key: "out", header: "Check-out" },
              { key: "device", header: "Device" },
              { key: "status", header: "Status" },
            ],
            rows: [
              { emp: "James Workman", in: c.mono("09:02"), out: c.mono("—"), device: "HQ — Biometric", status: b("PRESENT", "emerald") },
              { emp: "Priya Sharma", in: c.mono("09:22"), out: c.mono("—"), device: "HQ — Biometric", status: b("LATE", "amber") },
              { emp: "Ananya Nair", in: c.mono("08:55"), out: c.mono("—"), device: "HQ — Biometric", status: b("PRESENT", "emerald") },
              { emp: "Vikram Singh", in: c.mono("—"), out: c.mono("—"), device: "Field — Mobile GPS", status: b("FIELD WORK", "blue") },
            ],
          },
        ],
      },
    ],
  },
  {
    key: "recruit",
    label: "Recruitment & Onboarding",
    icon: "📋",
    title: "Recruitment & Onboarding",
    sub: "Job Posts, Applicants, Interviews, Offer Letters, Documents, Joining, Induction",
    subtabs: [
      {
        key: "all",
        label: "All",
        blocks: [
          {
            type: "kpis",
            items: [
              { label: "Open positions", value: "6", chip: ["blue", "◈"], delta: "Across 3 departments", deltaTone: "muted" },
              { label: "Active applicants", value: "19", chip: ["lavender", "👤"], delta: "In the pipeline now", deltaTone: "muted" },
              { label: "Avg. time to hire", value: "21 days", chip: ["amber", "◷"], delta: "▼ 3 days vs last quarter" },
              { label: "Offer acceptance rate", value: "88%", chip: ["mint", "✓"], delta: "7 of 8 offers accepted" },
            ],
          },
          {
            type: "kanban",
            label: "Hiring Pipeline",
            draggable: true,
            columns: [
              {
                id: "applied", title: "Applied", dot: "var(--bos-text-faint)", highlight: { value: "12", color: "var(--bos-text-muted)" },
                cards: [{ id: "k1", title: "Solar Installation Technician", tag: { text: "NAUKRI", tag: "sage" }, people: [{ initials: "SK", color: TONE.sage }], due: "Applied 2d ago" }],
              },
              {
                id: "interview", title: "Interview", dot: "var(--bos-amber)", highlight: { value: "5", color: "var(--bos-amber-600)" },
                cards: [{ id: "k2", title: "Sales Executive — Enterprise", tag: { text: "LINKEDIN", tag: "rose" }, people: [{ initials: "NG", color: TONE.rose }, { initials: "AD", color: TONE.pastelBlue }], due: "Tue 2pm" }],
              },
              {
                id: "offer", title: "Offer", dot: "var(--bos-blue)", highlight: { value: "2", color: "var(--bos-blue-600)" },
                cards: [{ id: "k3", title: "HR Generalist", tag: { text: "REFERRAL", tag: "lavender" }, people: [{ initials: "KJ", color: TONE.lavender }], due: "Offer sent" }],
              },
              {
                id: "hired", title: "Hired", dot: "var(--bos-emerald)", highlight: { value: "3", color: "var(--bos-emerald-600)" },
                cards: [{ id: "k4", title: "Site Engineer", tag: { text: "NAUKRI", tag: "mint" }, people: [{ initials: "VS", color: TONE.mint }], due: "Starts 4 Aug" }],
              },
            ],
          },
          {
            type: "table",
            label: "Onboarding — New Joiners",
            columns: [
              { key: "emp", header: "Employee" },
              { key: "role", header: "Role" },
              { key: "start", header: "Start Date" },
              { key: "docs", header: "Documents" },
              { key: "it", header: "IT Setup" },
              { key: "ind", header: "Induction" },
              { key: "status", header: "Status" },
            ],
            rows: [
              { emp: "Vikram Singh", role: "Site Engineer", start: c.mono("4 Aug 2026"), docs: b(done.text, done.tone), it: b(pending.text, pending.tone), ind: b(pending.text, pending.tone), status: b("ON TRACK", "blue") },
              { emp: "Karan Joshi", role: "HR Generalist", start: c.mono("11 Aug 2026"), docs: b(pending.text, pending.tone), it: b(pending.text, pending.tone), ind: b(pending.text, pending.tone), status: b("ON TRACK", "blue") },
              { emp: "Sneha Kulkarni", role: "Solar Installation Technician", start: c.mono("28 Jul 2026"), docs: b(done.text, done.tone), it: b(done.text, done.tone), ind: b(done.text, done.tone), status: b("COMPLETED", "emerald") },
            ],
          },
        ],
      },
      {
        key: "openpos",
        label: "Open Position",
        blocks: [
          {
            type: "kpis",
            items: [
              { label: "Total open positions", value: "6", chip: ["blue", "◈"], delta: "Across 3 departments", deltaTone: "muted" },
              { label: "Departments hiring", value: "3", chip: ["lavender", "🏢"], delta: "Field Ops, Sales, Engineering", deltaTone: "muted" },
              { label: "Job posts published", value: "4", chip: ["mint", "✓"], delta: "Live on job boards" },
              { label: "Job posts pending", value: "2", chip: ["amber", "◷"], delta: "Awaiting approval to publish", deltaTone: "warn" },
            ],
          },
          {
            type: "table",
            label: "Position details",
            columns: [
              { key: "pos", header: "Position" },
              { key: "dept", header: "Department" },
              { key: "open", header: "Openings" },
              { key: "pri", header: "Priority" },
              { key: "post", header: "Job Post" },
            ],
            rows: [
              { pos: "Solar Installation Technician", dept: "Field Operations", open: c.mono("2"), pri: b("HIGH", "coral"), post: b("PUBLISHED", "emerald") },
              { pos: "Field Service Engineer", dept: "Field Operations", open: c.mono("1"), pri: b("MEDIUM", "amber"), post: b("PUBLISHED", "emerald") },
              { pos: "Sales Executive — Enterprise", dept: "Sales", open: c.mono("1"), pri: b("HIGH", "coral"), post: b("PUBLISHED", "emerald") },
              { pos: "Backend Engineer", dept: "Engineering", open: c.mono("1"), pri: b("MEDIUM", "amber"), post: b("PUBLISHED", "emerald") },
              { pos: "QA Engineer", dept: "Engineering", open: c.mono("1"), pri: b("LOW", "blue"), post: b("PENDING", "amber") },
              { pos: "HR Generalist", dept: "Human Resources", open: c.mono("1"), pri: b("MEDIUM", "amber"), post: b("PENDING", "amber") },
            ],
          },
        ],
      },
      {
        key: "applications",
        label: "Applications",
        blocks: [
          {
            type: "kpis",
            items: [
              { label: "Total applications", value: "19", chip: ["blue", "👤"], delta: "This hiring cycle", deltaTone: "muted" },
              { label: "Review applications", value: "12", chip: ["lavender", "📋"], delta: "Awaiting first review", deltaTone: "warn" },
              { label: "Interview", value: "5", chip: ["amber", "🎤"], delta: "Scheduled or in progress", deltaTone: "muted" },
              { label: "Shortlisted", value: "2", chip: ["mint", "★"], delta: "Moving to offer stage" },
            ],
          },
          {
            type: "table",
            columns: [
              { key: "cand", header: "Candidate" },
              { key: "for", header: "Applying For" },
              { key: "src", header: "Source" },
              { key: "on", header: "Applied On" },
              { key: "stage", header: "Stage" },
            ],
            rows: [
              { cand: "Sanjay Kumar", for: "Solar Installation Technician", src: "Naukri", on: c.mono("26 Jul 2026"), stage: b("REVIEW", "blue") },
              { cand: "Meera Tandon", for: "Backend Engineer", src: "Referral", on: c.mono("27 Jul 2026"), stage: b("REVIEW", "blue") },
              { cand: "Nisha Gupta", for: "Sales Executive — Enterprise", src: "LinkedIn", on: c.mono("21 Jul 2026"), stage: b("INTERVIEW", "amber") },
              { cand: "Karan Joshi", for: "HR Generalist", src: "Referral", on: c.mono("15 Jul 2026"), stage: b("SHORTLISTED", "emerald") },
            ],
          },
        ],
      },
      {
        key: "onboarding",
        label: "Onboarding",
        blocks: [
          {
            type: "kpis",
            items: [
              { label: "Offer letters sent", value: "8", chip: ["blue", "✉"], delta: "7 accepted, 1 pending" },
              { label: "New joiners (Aug)", value: "3", chip: ["mint", "＋"], delta: "Confirmed start dates", deltaTone: "muted" },
              { label: "Documents pending", value: "2", chip: ["amber", "📄"], delta: "Awaiting submission", deltaTone: "warn" },
              { label: "Induction scheduled", value: "2", chip: ["lavender", "🎓"], delta: "This week", deltaTone: "muted" },
            ],
          },
          {
            type: "table",
            columns: [
              { key: "emp", header: "Employee" },
              { key: "role", header: "Role" },
              { key: "start", header: "Start Date" },
              { key: "offer", header: "Offer Letter" },
              { key: "docs", header: "Documents" },
              { key: "ind", header: "Induction" },
            ],
            rows: [
              { emp: "Vikram Singh", role: "Site Engineer", start: c.mono("4 Aug 2026"), offer: b("ACCEPTED", "emerald"), docs: b("SUBMITTED", "emerald"), ind: b("NOT SCHEDULED", "amber") },
              { emp: "Karan Joshi", role: "HR Generalist", start: c.mono("11 Aug 2026"), offer: b("ACCEPTED", "emerald"), docs: b("PENDING", "amber"), ind: b("SCHEDULED — 11 Aug", "blue") },
              { emp: "Sneha Kulkarni", role: "Solar Installation Technician", start: c.mono("28 Jul 2026"), offer: b("ACCEPTED", "emerald"), docs: b("SUBMITTED", "emerald"), ind: b("COMPLETED", "emerald") },
            ],
          },
        ],
      },
      {
        key: "status",
        label: "Status",
        blocks: [
          {
            type: "kpis",
            items: [
              { label: "IT Setup done", value: "1/3", chip: ["blue", "💻"], delta: "2 laptops pending", deltaTone: "warn" },
              { label: "KYC verified", value: "2/3", chip: ["mint", "✓"], delta: "Aadhaar & PAN checked", deltaTone: "muted" },
              { label: "KRA updated", value: "0/3", chip: ["amber", "🎯"], delta: "Awaiting manager input", deltaTone: "warn" },
              { label: "Sync to HRMS", value: "2/3", chip: ["lavender", "🔄"], delta: "Employee record live", deltaTone: "muted" },
            ],
          },
          {
            type: "table",
            columns: [
              { key: "emp", header: "Employee" },
              { key: "it", header: "IT Setup" },
              { key: "kyc", header: "KYC" },
              { key: "kra", header: "KRA Update" },
              { key: "sync", header: "Sync Data" },
            ],
            rows: [
              { emp: "Vikram Singh", it: b("PENDING", "amber"), kyc: b("VERIFIED", "emerald"), kra: b("PENDING", "amber"), sync: b("SYNCED", "emerald") },
              { emp: "Karan Joshi", it: b("PENDING", "amber"), kyc: b("PENDING", "amber"), kra: b("PENDING", "amber"), sync: b("PENDING", "amber") },
              { emp: "Sneha Kulkarni", it: b("DONE", "emerald"), kyc: b("VERIFIED", "emerald"), kra: b("PENDING", "amber"), sync: b("SYNCED", "emerald") },
            ],
          },
        ],
      },
    ],
  },
  {
    key: "performance",
    label: "Performance & Learning",
    icon: "🎯",
    title: "Performance & Learning",
    sub: "KPIs, KRAs, Appraisals, Promotions, PIP, LMS, Certifications, Recognition",
    subtabs: [
      {
        key: "all",
        label: "All",
        blocks: [
          {
            type: "kpis",
            items: [
              { label: "Promotions Details", value: "9", chip: ["blue", "◈"], delta: "Pending sign-off", deltaTone: "muted" },
              { label: "Training Programs", value: "14", chip: ["mint", "🎓"], delta: "Company training catalog" },
              { label: "Certifications", value: "186/214", chip: ["lavender", "📜"], delta: "87% certified" },
              { label: "On PIP", value: "2", chip: ["rose", "!"], delta: "Review in 30 days", deltaTone: "down" },
            ],
          },
          {
            type: "widgets",
            items: [
              {
                title: "🎓 Training Programs",
                dot: "mint",
                rows: [
                  { label: "Solar EPC Training", value: "3 Days", valueTone: "faint" },
                  { label: "BESS — System Training", value: "2 Days", valueTone: "faint" },
                  { label: "UPS & Power Backup Training", value: "3 Days", valueTone: "faint" },
                  { label: "Sales & Marketing Training", value: "3 Days", valueTone: "faint" },
                  { label: "Leadership Development", value: "2 Days", valueTone: "faint" },
                ],
              },
              {
                title: "🏆 Rewards & Recognition",
                dot: "rose",
                rows: [
                  { label: "🏆 Employee of the Month", value: "Ananya Nair" },
                  { label: "🌟 Top Performer — Sales", value: "Priya Sharma" },
                  { label: "🔧 Star Technician", value: "Rahul Khanna" },
                  { label: "🎖️ 3-Year Milestone", value: "Rahul Khanna" },
                ],
              },
            ],
          },
          TRAINING_ACTIONS,
        ],
      },
      {
        key: "performance",
        label: "Performance",
        blocks: [
          {
            type: "kpis",
            cols: 2,
            items: [
              { label: "Promotions Details", value: "9", chip: ["blue", "◈"], delta: "Pending sign-off", deltaTone: "muted" },
              { label: "On PIP", value: "2", chip: ["rose", "!"], delta: "Review in 30 days", deltaTone: "down" },
            ],
          },
          {
            type: "table",
            label: "Promotion pipeline",
            columns: [
              { key: "emp", header: "Employee" },
              { key: "cur", header: "Current Role" },
              { key: "next", header: "Proposed Role" },
              { key: "status", header: "Status" },
            ],
            rows: [
              { emp: "James Workman", cur: "Operations Manager", next: "Senior Operations Manager", status: b("PENDING SIGN-OFF", "amber") },
              { emp: "Ananya Nair", cur: "Backend Engineer", next: "Senior Backend Engineer", status: b("PENDING SIGN-OFF", "amber") },
              { emp: "Priya Sharma", cur: "Sales Executive", next: "Senior Sales Executive", status: b("APPROVED", "emerald") },
            ],
          },
          {
            type: "approvals",
            label: "Performance Improvement Plan",
            items: [
              { id: "p1", initials: "?", tone: TONE.coral, name: "Field Technician — Site B", meta: "Attendance & quality concerns · Review due 25 Aug 2026", badge: { text: "ON PIP", tone: "coral" } },
              { id: "p2", initials: "?", tone: TONE.coral, name: "Sales Associate — Region West", meta: "Missed quota 2 consecutive quarters · Review due 30 Aug 2026", badge: { text: "ON PIP", tone: "coral" } },
            ],
          },
        ],
      },
      {
        key: "training",
        label: "Training Programs",
        blocks: [
          {
            type: "kpis",
            items: [
              { label: "Total programs", value: "14", chip: ["mint", "🎓"], delta: "Company training catalog" },
              { label: "Enrolled this quarter", value: "62", chip: ["blue", "👤"], delta: "Across departments", deltaTone: "muted" },
              { label: "Completed", value: "41", chip: ["mint", "✓"], delta: "66% completion" },
              { label: "Upcoming sessions", value: "5", chip: ["lavender", "◷"], delta: "Next 30 days", deltaTone: "muted" },
            ],
          },
          {
            type: "widgets",
            items: [
              {
                title: "👔 Management Team",
                dot: "lavender",
                rows: [
                  { label: "Leadership Development", value: "2 Days", valueTone: "faint" },
                  { label: "Sales & Marketing Training", value: "3 Days", valueTone: "faint" },
                  { label: "Customer Service & Team Coordination", value: "1 Day", valueTone: "faint" },
                  { label: "Soft Skills & Communications", value: "1 Day", valueTone: "faint" },
                  { label: "Knowledge Sharing Sessions", value: "Ongoing", valueTone: "faint" },
                ],
              },
              {
                title: "🛠️ Technical Team",
                dot: "blue",
                rows: [
                  { label: "Solar EPC Training", value: "3 Days", valueTone: "faint" },
                  { label: "BESS — System Training", value: "2 Days", valueTone: "faint" },
                  { label: "UPS & Power Backup Training", value: "3 Days", valueTone: "faint" },
                  { label: "EV Charging Solutions Training", value: "2 Days", valueTone: "faint" },
                  { label: "Engineering & Software Training", value: "2 Days", valueTone: "faint" },
                  { label: "Digital Tools Training", value: "1 Day", valueTone: "faint" },
                ],
              },
              {
                title: "🧰 Operation Team",
                dot: "sage",
                rows: [
                  { label: "AMC and O&M Training", value: "2 Days", valueTone: "faint" },
                  { label: "Field Service & Tool Kits Training", value: "2 Days", valueTone: "faint" },
                  { label: "Safety Training · CERTIFICATE", value: "1 Day", valueTone: "faint" },
                ],
              },
            ],
          },
          TRAINING_ACTIONS,
        ],
      },
      {
        key: "recognition",
        label: "Recognition",
        blocks: [
          {
            type: "chips",
            label: "Recognition categories",
            items: [
              "Employee of the Month", "Top Performer — Sales", "Top Performer — Service", "Top Performer — Marketing",
              "Star Performer", "Best Performer", "Project Spotlight", "Star Technician", "Rising Star (Junior)",
              "Employee of the Year", "Best Helping Hand", "3-Year Milestone",
            ],
          },
          {
            type: "celebrations",
            title: "Recent recognitions",
            label: "🏆 This Month",
            items: [
              { initials: "AN", name: "Ananya Nair", tag: "EMPLOYEE OF THE MONTH", pastel: "mint", tint: "blue" },
              { initials: "PS", name: "Priya Sharma", tag: "TOP PERFORMER — SALES", pastel: "rose", tint: "emerald" },
              { initials: "RK", name: "Rahul Khanna", tag: "STAR TECHNICIAN", pastel: "sage", tint: "amber" },
            ],
          },
        ],
      },
      {
        key: "kras",
        label: "KRAs",
        blocks: [
          {
            type: "kpis",
            items: [
              { label: "KRAs set", value: "214", chip: ["blue", "🎯"], delta: "100% of headcount" },
              { label: "On track", value: "178", chip: ["mint", "✓"], delta: "83%" },
              { label: "At risk", value: "28", chip: ["amber", "◐"], delta: "13%", deltaTone: "warn" },
              { label: "Off track", value: "8", chip: ["rose", "!"], delta: "4%", deltaTone: "down" },
            ],
          },
          {
            type: "table",
            columns: [
              { key: "emp", header: "Employee" },
              { key: "kra", header: "KRA" },
              { key: "target", header: "Target" },
              { key: "progress", header: "Progress" },
            ],
            rows: [
              { emp: "James Workman", kra: "Field project delivery SLA", target: c.mono("95%"), progress: b("ON TRACK", "emerald") },
              { emp: "Priya Sharma", kra: "Quarterly sales target", target: c.mono("₹40L"), progress: b("ON TRACK", "emerald") },
              { emp: "Ananya Nair", kra: "Sprint delivery accuracy", target: c.mono("90%"), progress: b("AT RISK", "amber") },
            ],
          },
        ],
      },
      {
        key: "certifications",
        label: "Certifications",
        blocks: [
          {
            type: "kpis",
            items: [
              { label: "Certified employees", value: "186/214", chip: ["mint", "✓"], delta: "87%" },
              { label: "Safety certified", value: "198/214", chip: ["blue", "🦺"], delta: "Mandatory certificate" },
              { label: "Expiring in 30 days", value: "6", chip: ["amber", "◷"], delta: "Renewal needed", deltaTone: "warn" },
              { label: "Certificates issued (FY)", value: "312", chip: ["lavender", "📜"], delta: "Across all programs", deltaTone: "muted" },
            ],
          },
          {
            type: "table",
            columns: [
              { key: "emp", header: "Employee" },
              { key: "cert", header: "Certification" },
              { key: "issued", header: "Issued" },
              { key: "status", header: "Status" },
              { key: "dl", header: "" },
            ],
            rows: [
              { emp: "Rahul Khanna", cert: "Safety Training", issued: c.mono("10 Jan 2026"), status: b("VALID", "emerald"), dl: c.action("⬇ Download", "cert:download", "ghost") },
              { emp: "Vikram Singh", cert: "Field Service & Tool Kits Training", issued: c.mono("2 Feb 2026"), status: b("EXPIRING SOON", "amber"), dl: c.action("⬇ Download", "cert:download", "ghost") },
              { emp: "Ananya Nair", cert: "Engineering & Software Training", issued: c.mono("18 Mar 2026"), status: b("VALID", "emerald"), dl: c.action("⬇ Download", "cert:download", "ghost") },
            ],
          },
          { type: "actions", items: [{ label: "⬇ Training Certificate", action: "training:certificate" }] },
        ],
      },
    ],
  },
  {
    key: "expenses",
    label: "Expenses & Assets",
    icon: "💼",
    title: "Expenses & Assets",
    sub: "Asset Assignment, Laptop, Tools, Software Licenses, Field work, Equipments, Travel Requests, Expense Claims",
    blocks: [
      {
        type: "kpis",
        items: [
          { label: "Assets assigned", value: "341", chip: ["blue", "▣"], delta: "Laptops, tools, devices" },
          { label: "Pending travel requests", value: "6", chip: ["rose", "✈"], delta: "Needs approval", deltaTone: "warn" },
          { label: "Open expense claims", value: "14", chip: ["mint", "₹"], delta: "₹1.8L total" },
          { label: "Overdue asset returns", value: "3", chip: ["lavender", "↩"], delta: "Ex-employees", deltaTone: "down" },
        ],
      },
      {
        type: "table",
        columns: [
          { key: "item", header: "Item" },
          { key: "to", header: "Assigned To" },
          { key: "cat", header: "Category" },
          { key: "on", header: "Assigned On" },
          { key: "status", header: "Status" },
        ],
        rows: [
          { item: 'MacBook Pro 14"', to: "Ananya Nair", cat: c.tag("LAPTOP", "blue"), on: c.mono("9 Sep 2022"), status: b("ACTIVE", "emerald") },
          { item: "Site Safety Kit + Tools", to: "Rahul Khanna", cat: c.tag("FIELD EQUIPMENT", "sage"), on: c.mono("15 Jul 2021"), status: b("ACTIVE", "emerald") },
          { item: "Figma + Adobe Licenses", to: "Design Team", cat: c.tag("SOFTWARE", "lavender"), on: c.mono("1 Jan 2026"), status: b("ACTIVE", "emerald") },
          { item: "Company Vehicle — KA-01-AB-4521", to: "Vikram Singh", cat: c.tag("FIELD EQUIPMENT", "mint"), on: c.mono("4 May 2026"), status: b("PROBATION HOLD", "blue") },
          { item: "iPhone 14 (ex-employee)", to: "Unassigned", cat: c.tag("MOBILE", "blue"), on: c.mono("—"), status: b("OVERDUE RETURN", "coral") },
        ],
      },
    ],
  },
  {
    key: "services",
    label: "Employee Services",
    icon: "🎧",
    title: "Employee Services",
    sub: "HR Helpdesk, Employee Requests, Certificates, ID Cards, Profile Updates, T-Shirts",
    blocks: [
      {
        type: "kpis",
        items: [
          { label: "Open helpdesk tickets", value: "11", chip: ["rose", "🎧"], delta: "3 unassigned", deltaTone: "warn" },
          { label: "Avg. resolution time", value: "1.4d", chip: ["mint", "⏱"], delta: "▼ 0.3d vs last month" },
          { label: "Certificate requests", value: "4", chip: ["blue", "📄"], delta: "Experience letters, bonafide", deltaTone: "muted" },
          { label: "ID card / kit requests", value: "2", chip: ["lavender", "🪪"], delta: "New joiners", deltaTone: "muted" },
        ],
      },
      {
        type: "table",
        columns: [
          { key: "req", header: "Request" },
          { key: "by", header: "Raised By" },
          { key: "type", header: "Type" },
          { key: "on", header: "Raised On" },
          { key: "status", header: "Status" },
        ],
        rows: [
          { req: "Bonafide certificate for visa", by: "Ananya Nair", type: c.tag("CERTIFICATE", "lavender"), on: c.mono("27 Jul 2026"), status: b("IN PROGRESS", "amber") },
          { req: "Replacement ID card", by: "Vikram Singh", type: c.tag("ID CARD", "blue"), on: c.mono("26 Jul 2026"), status: b("IN PROGRESS", "amber") },
          { req: "Salary account not linked", by: "Rahul Khanna", type: c.tag("HELPDESK", "rose"), on: c.mono("25 Jul 2026"), status: b("UNASSIGNED", "coral") },
          { req: "Experience letter", by: "Priya Sharma", type: c.tag("CERTIFICATE", "lavender"), on: c.mono("20 Jul 2026"), status: b("RESOLVED", "emerald") },
          { req: "New joiner welcome kit + T-shirt", by: "Onboarding — 2 joiners", type: c.tag("KIT REQUEST", "mint"), on: c.mono("18 Jul 2026"), status: b("RESOLVED", "emerald") },
        ],
      },
    ],
  },
  {
    key: "policies",
    label: "HR Policies & Compliance",
    icon: "🔖",
    title: "HR Policies & Compliance",
    sub: "HR Policies, Contracts, Compliance, Labor Laws, Audit Records, Agreements",
    blocks: [{ type: "custom", id: "hr-policies" }],
  },
  {
    key: "reports",
    label: "Reports & Analytics",
    icon: "📈",
    title: "Reports & Analytics",
    sub: "Attendance Reports, Payroll Reports, Attrition, Hiring Metrics, Assets Reports, Expense Reports",
    blocks: [
      {
        type: "charts",
        items: [
          { kind: "spark", title: "Attrition trend (voluntary, %)", values: [40, 50, 42, 60, 54, 70, 66], tone: "coral", delta: "▼ 2.1% vs last quarter · 8.4% annualized", deltaTone: "down" },
          {
            kind: "donut",
            title: "Hiring funnel",
            size: 120,
            segments: [
              { label: "Applied", value: 147, tone: "faint" },
              { label: "Interview", value: 65, tone: "amber" },
              { label: "Offer", value: 26, tone: "blue" },
              { label: "Hired", value: 39, tone: "emerald" },
            ],
          },
        ],
      },
      {
        type: "widgets",
        items: [
          { title: "Attendance Report", dot: "sage", rows: [{ label: "Monthly attendance summary", chevron: true, action: "report:open" }, { label: "Late & absence trends", chevron: true, action: "report:open" }] },
          { title: "Payroll Report", dot: "blue", rows: [{ label: "Monthly payroll register", chevron: true, action: "report:open" }, { label: "Cost-to-company by department", chevron: true, action: "report:open" }] },
          { title: "Custom Dashboards", dot: "rose", rows: [{ label: "Build a new dashboard", chevron: true, action: "report:open" }, { label: "Shared with leadership", chevron: true, action: "report:open" }] },
        ],
      },
    ],
  },
  {
    key: "settings",
    label: "Settings & Access",
    icon: "⚙️",
    title: "Settings & Access",
    sub: "Employee Roles, Permissions, Workflow Rules, Approval Matrix, Masters, Dashboard Edit",
    blocks: [
      {
        type: "table",
        columns: [
          { key: "role", header: "Role" },
          { key: "members", header: "Members" },
          { key: "leave", header: "Can Approve Leave" },
          { key: "payroll", header: "Can View Payroll" },
          { key: "edit", header: "Can Edit Employee Records" },
        ],
        rows: [
          { role: "HR Admin", members: c.mono("3"), leave: b("YES", "emerald"), payroll: b("YES", "emerald"), edit: b("YES", "emerald") },
          { role: "Payroll Team", members: c.mono("2"), leave: b("NO", "coral"), payroll: b("YES", "emerald"), edit: b("NO", "coral") },
          { role: "Reporting Manager", members: c.mono("18"), leave: b("YES", "emerald"), payroll: b("NO", "coral"), edit: b("NO", "coral") },
          { role: "Employee", members: c.mono("191"), leave: b("NO", "coral"), payroll: b("NO", "coral"), edit: b("NO", "coral") },
        ],
      },
      {
        type: "table",
        label: "Approval matrix",
        columns: [
          { key: "type", header: "Request Type" },
          { key: "l1", header: "Level 1" },
          { key: "l2", header: "Level 2" },
          { key: "auto", header: "Auto-approve threshold" },
        ],
        rows: [
          { type: "Leave", l1: "Reporting Manager", l2: "—", auto: c.mono("≤ 2 days") },
          { type: "Expense claim", l1: "Reporting Manager", l2: "Finance", auto: c.mono("≤ ₹2,000") },
          { type: "Profile change (sensitive fields)", l1: "HR Admin", l2: "—", auto: c.mono("None") },
        ],
      },
      { type: "chips", label: "Masters", items: ["Departments", "Designations", "Leave Types", "Holiday List", "Document Types", "Locations"] },
    ],
  },
];
