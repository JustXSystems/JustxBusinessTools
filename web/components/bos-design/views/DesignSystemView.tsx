"use client";

import { Fragment, useState, type CSSProperties } from "react";
import {
  Alert,
  AppShell,
  Avatar,
  Badge,
  BarChart,
  BlockLabel,
  BOS_COLOR_TOKENS,
  BOS_MOTION_TOKENS,
  BOS_RADIUS_TOKENS,
  BOS_SPACE_TOKENS,
  BOS_TOKEN_GROUPS,
  BOS_TOKEN_GROUP_LABELS,
  BOS_TYPE_SCALE,
  BosIcon,
  Breadcrumbs,
  Button,
  Card,
  ChartCard,
  CommandPalette,
  DataTable,
  Dialog,
  DonutChart,
  EmptyState,
  Field,
  FormGrid,
  Grid,
  Hero,
  IconButton,
  Input,
  Kanban,
  KpiCard,
  MonthCalendar,
  NavBrand,
  Section,
  Segmented,
  Select,
  Skeleton,
  Sparkline,
  StatusLight,
  Switch,
  TimePill,
  tokensByGroup,
  useBosTheme,
  useToast,
  type BosCommand,
  type BosKanbanColumn,
} from "@/components/bos";
import { SAMPLE_CALENDAR_EVENTS, SAMPLE_TODAY } from "../data/common";

/* ---------- Sample data ---------- */

const INVOICE_ROWS = [
  { id: "INV-2026-0441", customer: "Meridian Solar EPC", amount: "₹4,82,000", status: ["PAID", "emerald"], due: "—" },
  { id: "INV-2026-0442", customer: "Vertex Industrial Automation", amount: "₹1,15,500", status: ["PENDING", "amber"], due: "3 Aug" },
  { id: "INV-2026-0439", customer: "Coastal Resorts & Hotels", amount: "₹92,000", status: ["OVERDUE", "coral"], due: "18 Jul" },
  { id: "INV-2026-0443", customer: "Anaya Jewellery Design", amount: "₹2,30,000", status: ["DRAFT", "blue"], due: "—" },
] as const;

const ACTION_VOCABULARY: Array<[string, "primary" | "secondary" | "ghost" | "destructive"]> = [
  ["Create Quotation", "secondary"],
  ["Upload Quotation", "secondary"],
  ["New Purchase Order", "primary"],
  ["Create Report", "secondary"],
  ["Save Report", "primary"],
  ["Send Invoice", "primary"],
  ["Request Leave", "secondary"],
  ["Approve", "primary"],
  ["Send Report", "secondary"],
  ["Upload Photo", "secondary"],
  ["Upload Report", "secondary"],
  ["Upload Documents", "secondary"],
  ["Edit Report", "ghost"],
  ["Reject with notes", "destructive"],
  ["Reject", "destructive"],
  ["Assign Task", "secondary"],
  ["Assign Project", "secondary"],
];

const mini = (initials: string, ink: string) => (
  <Avatar size="xs" pastel={{ fill: `var(--bos-pastel-${ink}-ink)`, ink: "#fff" }}>
    {initials}
  </Avatar>
);

const INITIAL_BOARD: BosKanbanColumn[] = [
  {
    id: "backlog",
    title: "Backlog",
    dot: "var(--bos-text-faint)",
    cards: [
      { id: "k1", title: "Renew AMC — Vertex Industrial", tag: <Badge tag="blue">FINANCE</Badge>, people: mini("AD", "blue"), due: "4 Aug" },
      { id: "k2", title: "Site survey — Coastal Resorts rooftop", tag: <Badge tag="sage">FIELD OPS</Badge>, people: mini("JW", "sage"), due: "6 Aug" },
    ],
  },
  {
    id: "progress",
    title: "In Progress",
    dot: "var(--bos-amber)",
    cards: [
      {
        id: "k3",
        title: "Quotation — Anaya Jewellery showroom lighting",
        tag: <Badge tag="rose">SALES</Badge>,
        people: (
          <>
            {mini("RK", "rose")}
            {mini("AD", "blue")}
          </>
        ),
        due: "1 Aug",
      },
      { id: "k4", title: "Onboarding kit — new field technician", tag: <Badge tag="lavender">SUPPORT</Badge>, people: mini("PS", "lavender"), due: "31 Jul" },
    ],
  },
  {
    id: "review",
    title: "Review",
    dot: "var(--bos-blue)",
    cards: [{ id: "k5", title: "PO-2291 approval — panel procurement", tag: <Badge tag="blue">FINANCE</Badge>, people: mini("AD", "blue"), due: "Today" }],
  },
  {
    id: "done",
    title: "Done",
    dot: "var(--bos-emerald)",
    cards: [{ id: "k6", title: "AMC renewal — Meridian Solar EPC", tag: <Badge tag="mint">DESIGN</Badge>, people: mini("JW", "mint"), due: "22 Jul" }],
  },
];

const TOASTS = {
  success: { tone: "emerald", title: "AMC renewal generated", description: "3 contracts were auto-renewed and invoiced." },
  warning: { tone: "amber", title: "Approval waiting on you", description: "PO-2291 exceeds the auto-approve threshold." },
  error: { tone: "coral", title: "Sync failed", description: "Inventory count could not be reconciled." },
} as const;

/* ---------- Interactive demos ---------- */

function BoardDemo() {
  const [columns, setColumns] = useState(INITIAL_BOARD);
  return (
    <Kanban
      aria-label="Sample work board"
      columns={columns}
      onMove={(cardId, from, to) =>
        setColumns((cols) => {
          const card = cols.find((c) => c.id === from)?.cards.find((k) => k.id === cardId);
          if (!card) return cols;
          return cols.map((c) =>
            c.id === from ? { ...c, cards: c.cards.filter((k) => k.id !== cardId) } : c.id === to ? { ...c, cards: [...c.cards, card] } : c,
          );
        })
      }
    />
  );
}

function CalendarDemo() {
  const [view, setView] = useState({ year: 2026, month: 6 });
  return <MonthCalendar year={view.year} month={view.month} events={SAMPLE_CALENDAR_EVENTS} today={SAMPLE_TODAY} onNavigate={setView} />;
}

function DialogDemo() {
  const [open, setOpen] = useState(false);
  const { show } = useToast();
  return (
    <div className="bos-demo-frame">
      <Button size="sm" onClick={() => setOpen(true)}>
        Open dialog
      </Button>
      <Dialog
        contained
        open={open}
        onClose={() => setOpen(false)}
        icon={{ tone: "coral", name: "warning" }}
        title="Delete purchase order PO-2291?"
        description="This will permanently remove the order and its line items. Vendors who were notified will receive a cancellation email. This can't be undone."
        actions={
          <>
            <Button size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => {
                setOpen(false);
                show({ tone: "coral", title: "Demo only", description: "PO-2291 was not deleted." });
              }}
            >
              Delete order
            </Button>
          </>
        }
      />
    </div>
  );
}

function ToastDemo() {
  const { show } = useToast();
  return (
    <div className="bos-demo-frame bos-demo-frame-sm">
      {(Object.keys(TOASTS) as Array<keyof typeof TOASTS>).map((k) => (
        <Button key={k} size="sm" onClick={() => show(TOASTS[k])}>
          Trigger {k}
        </Button>
      ))}
    </div>
  );
}

function PaletteDemo() {
  const [open, setOpen] = useState(false);
  const { show } = useToast();
  const run = (label: string) => () => show({ title: label, description: "Command palette demo." });
  const commands: BosCommand[] = [
    { id: "po", section: "Quick actions", label: "New purchase order", icon: "＋", hint: "P then O", onSelect: run("New purchase order") },
    { id: "ai", section: "Quick actions", label: "Ask AI Assistant", icon: "✦", hint: "⌘ J", onSelect: run("Ask AI Assistant") },
    { id: "inv", section: "Recent", label: "INV-2026-0441 — Meridian Solar EPC", icon: "🧾", onSelect: run("INV-2026-0441") },
    { id: "jw", section: "Recent", label: "James Workman — Field Operations", icon: "👤", onSelect: run("James Workman") },
    { id: "fin", section: "Navigate", label: "Finance", icon: "⧉", hint: "G F", onSelect: run("Finance") },
    { id: "invn", section: "Navigate", label: "Inventory", icon: "⧉", hint: "G I", onSelect: run("Inventory") },
  ];
  return (
    <div className="bos-demo-frame">
      <Button size="sm" onClick={() => setOpen(true)}>
        Open command palette <kbd className="bos-kbd">⌘K</kbd>
      </Button>
      <CommandPalette contained open={open} onClose={() => setOpen(false)} commands={commands} />
    </div>
  );
}

function NavigationDemo({ logoSrc }: { logoSrc: string }) {
  const [active, setActive] = useState("dashboard");
  const items = [
    { key: "dashboard", label: "Dashboard", icon: <BosIcon name="grid" /> },
    { key: "ai", label: "AI Assistant", icon: <BosIcon name="sparkle" /> },
    { key: "sales", label: "Sales & CRM", icon: <BosIcon name="trend" />, section: "Revenue" },
    { key: "projects", label: "Projects", icon: <BosIcon name="layers" />, section: "Revenue" },
    { key: "inventory", label: "Inventory", icon: <BosIcon name="box" />, section: "Operations" },
    { key: "finance", label: "Finance", icon: <BosIcon name="wallet" />, section: "Operations" },
  ];
  const label = items.find((i) => i.key === active)?.label ?? "";
  return (
    <AppShell size="fixed" brand={<NavBrand name="Justx BOS" logoSrc={logoSrc} />} items={items} active={active} onSelect={setActive} onSearch={() => undefined} aria-label="Demo navigation">
      <div className="bos-row-between" style={{ marginBottom: 16 }}>
        <Breadcrumbs items={[{ label: "Justx BOS", onClick: () => setActive("dashboard") }, { label }]} />
        <div className="bos-row" style={{ gap: 10 }}>
          <TimePill />
          <IconButton icon="bell" dot aria-label="Notifications" />
        </div>
      </div>
      <Grid cols={2} min={140} style={{ marginBottom: 16 }}>
        <KpiCard label="Total Energy Generated" value="1,220 kWh" chip={{ color: "rose", glyph: "◐" }} delta="▲ 9% since last month" />
        <KpiCard label="Efficiency" value="91%" chip={{ color: "blue", glyph: "◎" }} delta="On target" />
      </Grid>
      <Skeleton width="60%" height={12} style={{ marginBottom: 8, display: "block" }} />
      <Skeleton width="40%" height={12} style={{ display: "block" }} />
    </AppShell>
  );
}

/* ---------- View ---------- */

export function DesignSystemView({ logoSrc, onOpenLaunch }: { logoSrc: string; onOpenLaunch?: () => void }) {
  const { theme } = useBosTheme();
  const [segment, setSegment] = useState("overview");
  const [autoApprove, setAutoApprove] = useState(true);
  const block = (props: CSSProperties = {}): CSSProperties => ({ display: "block", ...props });

  return (
    <>
      <Hero
        eyebrow="Justx BOS · Soft System"
        title="Calm, soft, and effortless."
        lede="The Justx BOS design system: soft shadows instead of glass or emboss, low-saturation accents, generous rounding, and gentle 150–250ms motion everywhere. Every component below is a live React component from @/components/bos — toggle Light/Dark in the top bar to see the same calm philosophy carried into dark mode."
      />

      <Section id="brand" num="00 — Brand" title="Same mark, new light" description="The Justx Systems glyph on white — it needs to hold up without the dark canvas and glow it was designed against.">
        <Card className="bos-brand-card">
          {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset under the app base path */}
          <img src={logoSrc} alt="Justx BOS" />
          <div className="bos-text-h2" style={{ fontSize: 16 }}>
            Justx BOS
          </div>
          <div className="bos-overline" style={{ marginTop: 2 }}>
            Powered by Justx Systems
          </div>
        </Card>
      </Section>

      <Section
        id="color"
        num="01 — Color"
        title="Neutral base, four quiet accents"
        description="Whites and grays carry the interface; blue/emerald/amber/coral are status-only; the five pastels are decorative — never status, never actions."
      >
        {BOS_TOKEN_GROUPS.map((group) => (
          <Fragment key={group}>
            <div className="bos-overline bos-swatch-group-label">{BOS_TOKEN_GROUP_LABELS[group]}</div>
            <div className="bos-swatch-grid">
              {tokensByGroup(group).map((t) => (
                <div key={t.cssVar} className="bos-swatch">
                  <div className="bos-swatch-color" style={{ background: `var(${t.cssVar})` }} />
                  <div className="bos-swatch-meta">
                    <div className="bos-swatch-name">{t.name}</div>
                    <div className="bos-swatch-hex">{theme === "dark" ? t.dark : t.light}</div>
                    <div className="bos-swatch-use">{t.role}</div>
                  </div>
                </div>
              ))}
            </div>
          </Fragment>
        ))}
      </Section>

      <Section
        id="type"
        num="02 — Typography"
        title="IBM Plex Sans, lighter touch"
        description="Tracking opens up and weights ease back — 600 tops out for headings, which is what makes text feel soft rather than assertive."
      >
        {BOS_TYPE_SCALE.map((t) => (
          <div key={t.id} className="bos-type-row">
            <span className="bos-type-label">{t.label}</span>
            <span className={t.className}>{t.sample}</span>
          </div>
        ))}
      </Section>

      <Section
        id="buttons"
        num="03 — Buttons & Segmented Tabs"
        title="Solid, not glass"
        description="No blur, no emboss — a solid fill and a soft shadow that grows slightly on hover. Destructive is a coral outline, so “delete” doesn't shout on a calm screen."
      >
        <div className="bos-row" style={{ marginBottom: 20 }}>
          <Button variant="primary">Create invoice</Button>
          <Button>Export</Button>
          <Button variant="ghost">Cancel</Button>
          <Button variant="destructive">Delete record</Button>
          <Button disabled>Disabled</Button>
        </div>
        <p className="bos-section-desc" style={{ marginBottom: 12 }}>
          Segmented control — macOS System Preferences pattern, for module sub-views:
        </p>
        <Segmented
          aria-label="Sample sub-views"
          options={[
            { value: "overview", label: "Overview" },
            { value: "list", label: "List" },
            { value: "kanban", label: "Kanban" },
            { value: "analytics", label: "Analytics" },
          ]}
          value={segment}
          onChange={setSegment}
        />
        <p className="bos-section-desc" style={{ margin: "20px 0 12px" }}>
          Toolbar controls — same segmented styling, used for filters and overflow menus instead of tabs:
        </p>
        <div className="bos-row" style={{ gap: 10 }}>
          <Select size="sm" aria-label="Date range" defaultValue="30" style={{ width: "auto" }}>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
          </Select>
          <Button size="sm" iconOnly icon="grid" aria-label="Change layout" />
          <Button size="sm" iconOnly icon="settings" aria-label="More options" />
        </div>
      </Section>

      <Section
        id="forms"
        num="04 — Forms & Inputs"
        title="Flat, quiet, focused"
        description="Inputs sit flush with a hairline border; focus is a soft blue ring, not a fill change — the form stays calm until you interact with it."
      >
        <FormGrid>
          <Field label="Vendor name">{({ id }) => <Input id={id} defaultValue="Suntech Power Pvt. Ltd." />}</Field>
          <Field label="Payment terms">
            {({ id }) => (
              <Select id={id} defaultValue="30">
                <option value="30">Net 30</option>
                <option value="45">Net 45</option>
              </Select>
            )}
          </Field>
          <Field label="PO amount" hint="Amounts above ₹5,00,000 require finance approval.">
            {({ id, describedBy }) => <Input id={id} placeholder="₹0.00" inputMode="decimal" aria-describedby={describedBy} />}
          </Field>
          <Field label="Auto-approve recurring POs">
            {({ id }) => (
              <div className="bos-row" style={{ marginTop: 8 }}>
                <Switch id={id} checked={autoApprove} onChange={setAutoApprove} />
                <span className="bos-text-muted" style={{ fontSize: 13 }}>
                  {autoApprove ? "Enabled for this vendor" : "Disabled for this vendor"}
                </span>
              </div>
            )}
          </Field>
        </FormGrid>
      </Section>

      <Section
        id="status"
        num="05 — Status, Badges & Alerts"
        title="Tinted, never bordered"
        description="Status badges keep their semantic colors; the pastel set is for category tags — where color means “which,” not “what state.”"
      >
        <div className="bos-row" style={{ marginBottom: 20 }}>
          <StatusLight state="on">Operational</StatusLight>
          <StatusLight state="warn">Needs attention</StatusLight>
          <StatusLight state="off">Down</StatusLight>
          <StatusLight state="idle">Idle</StatusLight>
        </div>
        <div className="bos-row" style={{ marginBottom: 16 }}>
          <Badge tone="emerald">PAID</Badge>
          <Badge tone="amber">PENDING</Badge>
          <Badge tone="coral">OVERDUE</Badge>
          <Badge tone="blue">DRAFT</Badge>
        </div>
        <p className="bos-section-desc" style={{ marginBottom: 10 }}>
          Category tags — pastel set, for labels rather than status:
        </p>
        <div className="bos-row" style={{ marginBottom: 24 }}>
          <Badge tag="sage">FIELD OPS</Badge>
          <Badge tag="blue">FINANCE</Badge>
          <Badge tag="rose">SALES</Badge>
          <Badge tag="mint">DESIGN</Badge>
          <Badge tag="lavender">SUPPORT</Badge>
        </div>
        <div className="bos-stack">
          <Alert tone="emerald" title="AMC renewal generated">
            3 solar O&amp;M contracts were auto-renewed and invoiced for Q3.
          </Alert>
          <Alert tone="amber" title="Approval waiting on you">
            PO-2291 for ₹6,40,000 exceeds the auto-approve threshold.
          </Alert>
          <Alert tone="coral" title="Sync failed">
            Inventory count for Warehouse 2 could not be reconciled.
          </Alert>
        </div>
      </Section>

      <Section
        id="cards"
        num="06 — Cards"
        title="Soft shadow, real lift on hover"
        description="A gentle shadow at rest, a deeper one plus a 2px lift on hover. Icon chips are decorative pastel context — the delta line carries the real signal."
      >
        <Grid cols={3} min={140}>
          <KpiCard label="Monthly recurring revenue" value="₹18.4L" chip={{ color: "blue", glyph: "◎" }} delta="▲ 12.4% vs last month" />
          <KpiCard label="Open service tickets" value="27" chip={{ color: "rose", glyph: "✦" }} delta="▲ 6 since yesterday" deltaTone="down" />
          <KpiCard label="Inventory accuracy" value="98.2%" chip={{ color: "mint", glyph: "✓" }} delta="▲ 0.6% vs last audit" />
        </Grid>
      </Section>

      <Section id="tables" num="07 — Tables" title="Zebra rows, soft hover" description="Hover uses a soft tint that ties the table back to “this is interactive.” Money and IDs are mono; status is always a badge.">
        <DataTable
          caption="Sample invoices"
          rowKey={(r) => r.id}
          rows={INVOICE_ROWS}
          columns={[
            { key: "id", header: "Invoice", mono: true },
            { key: "customer", header: "Customer" },
            { key: "amount", header: "Amount", mono: true },
            { key: "status", header: "Status", cell: (r) => <Badge tone={r.status[1]}>{r.status[0]}</Badge> },
            { key: "due", header: "Due", mono: true },
          ]}
        />
      </Section>

      <Section
        id="navigation"
        num="08 — Navigation"
        title="Sidebar, search, breadcrumbs"
        description="Active state is a flat soft-blue tint — no glow or outline needed on a light surface. Breadcrumbs sit at the top of the content area."
      >
        <NavigationDemo logoSrc={logoSrc} />
      </Section>

      <Section
        id="empty"
        num="09 — Empty & Loading States"
        title="Friendly, not clinical"
        description="A soft blue icon tile instead of a flat gray square. Skeletons shimmer at the same duration/ease as every other transition."
      >
        <div className="bos-stack" style={{ "--bos-gap": "20px" } as CSSProperties}>
          <EmptyState
            title="No purchase orders yet"
            actions={
              <>
                <Button size="sm" variant="primary">
                  New purchase order
                </Button>
                <Button size="sm">Upload quotation</Button>
              </>
            }
          >
            Create your first PO, or let AI draft one from a vendor quotation you upload.
          </EmptyState>
          <EmptyState
            title="No quotations yet"
            actions={
              <>
                <Button size="sm" variant="primary">
                  Create Quotation
                </Button>
                <Button size="sm">Upload Quotation</Button>
              </>
            }
          >
            Create a quotation from scratch, or let AI generate one from your last customer conversation.
          </EmptyState>
        </div>
        <p className="bos-section-desc" style={{ margin: "24px 0 12px" }}>
          Loading skeletons — same shimmer, four common shapes:
        </p>
        <Grid cols={4} min={140} style={{ marginBottom: 24 }}>
          <Card style={{ padding: 16 }} aria-busy="true">
            <Skeleton width={34} height={34} radius="var(--bos-r-md)" style={block({ marginBottom: 12 })} />
            <Skeleton width="70%" style={block({ marginBottom: 8 })} />
            <Skeleton width="45%" height={18} style={block()} />
          </Card>
          <Card style={{ padding: 16 }} aria-busy="true">
            <div className="bos-row" style={{ marginBottom: 14 }}>
              <Skeleton width={32} height={32} radius="50%" />
              <div style={{ flex: 1 }}>
                <Skeleton width="60%" height={9} style={block({ marginBottom: 6 })} />
                <Skeleton width="40%" height={9} style={block()} />
              </div>
            </div>
            <Skeleton width="90%" height={9} style={block({ marginBottom: 6 })} />
            <Skeleton width="75%" height={9} style={block()} />
          </Card>
          <Card style={{ padding: 16 }} aria-busy="true">
            <Skeleton width="50%" height={9} style={block({ marginBottom: 12 })} />
            <Skeleton height={9} style={block({ marginBottom: 8 })} />
            <Skeleton height={9} style={block({ marginBottom: 8 })} />
            <Skeleton width="65%" height={9} style={block()} />
          </Card>
          <Card style={{ padding: 16, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8 }} aria-busy="true">
            <Skeleton width={44} height={44} radius="50%" />
            <Skeleton width="60%" height={9} />
          </Card>
        </Grid>
        <BlockLabel>The action-button vocabulary — three intents applied consistently, whatever the label:</BlockLabel>
        <div className="bos-row">
          {ACTION_VOCABULARY.map(([label, variant]) => (
            <Button key={label} size="sm" variant={variant}>
              {label}
            </Button>
          ))}
        </div>
      </Section>

      <Section
        id="login"
        num="10 — Login & Onboarding"
        title="Splash → sign in → home, one flow"
        description="Single column throughout: logo scale-in, “Welcome to Justx,” the tenant sign-in, then a home dashboard with the signed-in user's profile front and center."
      >
        <Button variant="primary" icon="login" onClick={onOpenLaunch}>
          Open the Launch &amp; Login workspace
        </Button>
      </Section>

      <Section id="charts" num="11 — Charts" title="Data, not decoration" description="Charts use the same semantic palette — blue for volume/trend, emerald/amber/coral for status breakdowns. No gridlines unless they carry information.">
        <Grid template="1.3fr 1fr 1fr">
          <ChartCard title="Monthly recurring revenue" delta="▲ 12.4% vs last month · ₹18.4L this month">
            <BarChart
              ariaLabel="Monthly recurring revenue, February to July"
              data={[
                { label: "Feb", value: 58 },
                { label: "Mar", value: 78 },
                { label: "Apr", value: 68 },
                { label: "May", value: 92 },
                { label: "Jun", value: 84 },
                { label: "Jul", value: 110 },
              ]}
            />
          </ChartCard>
          <ChartCard
            title="Service tickets"
            center
            legend={[
              { label: "Resolved", tone: "emerald" },
              { label: "Open", tone: "blue" },
              { label: "Overdue", tone: "coral" },
            ]}
          >
            <DonutChart
              rounded
              ariaLabel="Service tickets: 64 resolved, 25 open, 13 overdue"
              centerValue="102"
              centerLabel="TICKETS"
              segments={[
                { label: "Resolved", value: 64, tone: "emerald" },
                { label: "Open", value: 25, tone: "blue" },
                { label: "Overdue", value: 13, tone: "coral" },
              ]}
            />
          </ChartCard>
          <ChartCard title="Weekly active users" delta="▲ 21% vs last week · 4,820 active">
            <Sparkline ariaLabel="Weekly active users trend" values={[30, 45, 40, 68, 60, 82, 74]} />
          </ChartCard>
        </Grid>
      </Section>

      <Section id="kanban" num="12 — Kanban Board" title="Columns, cards, calm" description="Column headers use the status-light colors. Cards keep to one tag, one due date, one avatar cluster — drag cards between columns.">
        <BoardDemo />
      </Section>

      <Section id="calendar" num="13 — Calendar" title="Month view" description="Today gets a filled blue date, never a border. Events are tinted chips using the badge colors — no new color language to learn.">
        <CalendarDemo />
      </Section>

      <Section
        id="dialogs"
        num="14 — Dialogs & Modals"
        title="Interrupt sparingly, confirm clearly"
        description="A dimmed, blurred backdrop; the dialog scales in. Destructive actions get a coral icon and an explicit question — never just “Are you sure?”"
      >
        <DialogDemo />
      </Section>

      <Section id="toasts" num="15 — Toast Notifications" title="Confirm, don't interrupt" description="Slides in top-right, sits for a few seconds, slides out. Never blocks the interface — anything that needs a decision is a dialog.">
        <ToastDemo />
      </Section>

      <Section
        id="cmdk"
        num="16 — Command Palette"
        title="⌘K, and you're anywhere"
        description="Every module, record, and action is one keystroke away — quick actions first, then recent records, then navigation."
      >
        <PaletteDemo />
      </Section>

      <Section id="tokens" num="20 — Token Reference" title="CSS custom properties" description="Every --bos-* variable, grouped like the Color section. Source of truth: components/bos/tokens.ts (CSS is verified against it by tests).">
        <div className="bos-table-wrap">
          <div className="bos-table-scroll">
            <table className="bos-table bos-token-table">
              <caption className="bos-sr-only">Design tokens</caption>
              <tbody>
                {BOS_TOKEN_GROUPS.map((group) => (
                  <Fragment key={group}>
                    <tr className="bos-token-group-row">
                      <td colSpan={4}>{BOS_TOKEN_GROUP_LABELS[group].toUpperCase()}</td>
                    </tr>
                    {tokensByGroup(group).map((t) => (
                      <tr key={t.cssVar}>
                        <td>
                          <span className="bos-token-swatch-sm" style={{ background: `var(${t.cssVar})` }} />
                          {t.cssVar}
                        </td>
                        <td>{t.light}</td>
                        <td>{t.dark}</td>
                        <td className="bos-text-faint">{t.role}</td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
                {(
                  [
                    ["RADIUS", BOS_RADIUS_TOKENS],
                    ["SPACING", BOS_SPACE_TOKENS],
                    ["MOTION", BOS_MOTION_TOKENS],
                  ] as const
                ).map(([label, list]) => (
                  <Fragment key={label}>
                    <tr className="bos-token-group-row">
                      <td colSpan={4}>{label}</td>
                    </tr>
                    {list.map((t) => (
                      <tr key={t.cssVar}>
                        <td>{t.cssVar}</td>
                        <td colSpan={2}>{t.value}</td>
                        <td className="bos-text-faint">{t.role}</td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <p className="bos-section-desc" style={{ marginTop: 12 }}>
          {BOS_COLOR_TOKENS.length} color tokens · light and dark values shown side by side.
        </p>
      </Section>
    </>
  );
}
