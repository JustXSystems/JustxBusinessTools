# Justx BOS Design System

The company-standard UI/UX system, implemented from `Justxsystems_BOS_Design.html` as a reusable React kit plus a live reference tool (**Justx BOS Design**, `/tools/bosdesign`).

| Layer | Location | Purpose |
|------|----------|---------|
| Tokens | `web/components/bos/tokens.ts` | Single source of truth for colour, type, radius, spacing and motion (light + dark) |
| Styles | `web/components/bos/styles/bos.*.css` | Scoped CSS: `tokens` → `components` → `patterns` |
| Kit | `web/components/bos/` (`index.ts`) | Primitives, overlays, charts and page patterns |
| Pure logic | `web/lib/bos/` | Invoice math, month grid, chart geometry, theme resolution, clock (unit-tested) |
| Module engine | `web/components/bos-design/modules/` | Declarative `ModuleSpec` → full module workspace |
| Reference tool | `web/components/bos-design/` | Design System, Launch & Login, HR, Invoice and Finance samples |

## Isolation contract (why live customers are unaffected)

1. **Opt-in boundary.** Nothing is styled unless it sits inside `<BosRoot>`, which renders `<div class="bos" data-bos-theme="light|dark">`. `BosRoot` is the only file that imports the BOS CSS.
2. **Scoped selectors.** Every rule starts with `.bos` (or `body.bos-printing` for print). Tokens are `--bos-*`, classes `bos-*`. `web/lib/bos/tokens-sync.test.ts` fails the build if a selector escapes the scope or if CSS and `tokens.ts` drift apart.
3. **Lazy loading.** The reference tool is loaded with `next/dynamic` (`ssr: false`) from `ToolView`, so no BOS JS/CSS ships on other routes.
4. **Hidden by default.** `bosdesign` is in `OPT_IN_TOOL_IDS` (`web/config/tools.config.ts`). It never appears on home, in the home-tool picker or in registration defaults. The server seeds its catalog row with `available = 0`; it shows on home only after an admin enables it.
5. **No writes.** The reference tool uses sample data only — no API calls, no SKU, subscription-exempt.

### Enabling the tool for an org

Admin → Tools → find **Justx BOS Design** → mark it available. It then appears under *Utilities* for that org (independent of saved home selections). The URL `/tools/bosdesign` always works for direct access.

## Adopting BOS in a screen or tool

```tsx
"use client";
import { BosRoot, Card, KpiCard, Button, useToast } from "@/components/bos";

export function MyToolScreen() {
  return (
    <BosRoot canvas>
      <Body />
    </BosRoot>
  );
}

function Body() {
  const toast = useToast(); // must be called under BosRoot
  return (
    <>
      <KpiCard label="Revenue" value="₹12.4L" delta="▲ 8%" deltaTone="up" />
      <Card>
        <Button onClick={() => toast.show({ title: "Saved", tone: "emerald" })}>Save</Button>
      </Card>
    </>
  );
}
```

Rules:

- Import only from `@/components/bos` (the public surface), never from `styles/` directly.
- Wrap the whole surface once in `BosRoot`. Use `canvas` for full pages; omit it when embedding inside an existing JBT layout.
- Theme: uncontrolled by default (persisted, seeded from the host `data-scheme`). Pass `theme` + `onThemeChange` to control it.
- Overlays (`Dialog`, `CommandPalette`, toasts) portal into the BOS root so they keep the tokens. Use `contained` to keep a demo inside its frame.
- Keep business math in `web/lib/...` as pure functions with tests (see `web/lib/bos/invoice.ts`).
- Wrap new kit classes in `.bos …` and add tokens to both `tokens.ts` and `bos.tokens.css`; the sync test enforces this.

## Mobile & touch

Every kit component is responsive out of the box. There are two breakpoints, **≤900px** (tablet) and **≤560px** (phone), plus capability queries for touch screens.

| Pattern | Small-screen behaviour |
|---------|------------------------|
| `AppShell` sidebar | Becomes a horizontally scrolling pill strip; the active module is kept in view |
| `Grid` | Reflows to auto-fit; pass `min={140}` on KPI rows so they stay two-up on phones |
| `DataTable` | Keeps its columns and scrolls sideways (no crushed cells) |
| `Kanban` | One swipeable column at a time; a native **Move to…** picker replaces drag & drop on touch |
| `Dialog` | Bottom sheet with safe-area padding |
| Toasts / `CommandPalette` | Full-width at the top edge |
| `Segmented` | Scrolls instead of overflowing; the active option is kept in view |
| Forms | Single column; inputs are 16px on touch so iOS never zooms on focus |

Touch screens (`pointer: coarse`) also get larger hit areas. Devices without hover drop lift-on-hover effects, which otherwise stick after a tap, and get press feedback instead.

When embedding under a host header that is already sticky on phones (like the JBT app bar), use `<Topbar sticky="desktop">`. To run edge-to-edge on phones inside a padded host container, add `className="bos-bleed"` to `BosRoot` and set `--bos-bleed` to the host padding.

## Building a module declaratively

Business modules (HR, Finance, …) are described as data and rendered by `ModuleWorkspace`:

```tsx
import { ModuleWorkspace } from "@/components/bos-design/modules/ModuleWorkspace";
import { cell, type ModuleSpec } from "@/components/bos-design/modules/schema";

const MODULES: ModuleSpec[] = [
  {
    key: "sales",
    label: "Sales",
    icon: "📈",
    title: "Sales",
    sub: "Pipeline and orders",
    blocks: [
      { type: "kpis", items: [{ label: "Open deals", value: "42" }] },
      {
        type: "table",
        columns: [
          { key: "customer", header: "Customer" },
          { key: "status", header: "Status" },
        ],
        rows: [{ customer: cell.text("Acme"), status: cell.badge("WON", "emerald") }],
      },
      { type: "custom", id: "sales-toolbar" },
    ],
  },
];

<ModuleWorkspace
  modules={MODULES}
  brandName="Justx BOS"
  renderCustom={(id, api) => (id === "sales-toolbar" ? <MyToolbar onOpen={() => api.navigate("sales")} /> : null)}
/>;
```

Available blocks: `kpis`, `widgets`, `charts`, `table`, `approvals`, `balances`, `calendar`, `kanban`, `label`, `note`, `alert`, `chips`, `progress`, `cards`, `grid`, `actions`, `celebrations`, `custom`. Modules may declare `subtabs` with per-subtab blocks. See `data/finance.ts` and `data/hrm.ts` for complete examples.

## Reference tool map

| Workspace | Shows |
|-----------|-------|
| Design System | Brand, colour tokens (live hex per theme), type scale, buttons, forms, status, cards, tables, navigation, empty/loading, charts, kanban, calendar, dialog, toasts, command palette, token reference |
| Launch & Login | Splash → login (password / OTP) → home shell with profile, dashboard and module placeholders |
| HR Management | Overview, employee list → detail (approval flow, masked bank details), org chart, policies, leave, payroll and more |
| Invoice Creator | Live GST invoice form + paper preview + print (`body.bos-printing`) |
| Finance & Accounts | 14 modules: dashboard, accounting, invoices, receivables, payables, banking, GST, payroll, budgeting, audit, … |

Global: `⌘K` / `Ctrl+K` command palette, light/dark toggle.

## Verification

```bash
cd web
npx tsc --noEmit -p .
npx eslint components/bos components/bos-design lib/bos
npx vitest run lib/bos lib/dynamic-tools.test.ts
```
