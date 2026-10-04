"use client";

import { Fragment, useState, type CSSProperties, type ReactNode } from "react";
import {
  ApprovalRow,
  Avatar,
  AvatarStack,
  Badge,
  BalanceRow,
  BarChart,
  BlockLabel,
  Button,
  Card,
  Celebrations,
  ChartCard,
  DataTable,
  DonutChart,
  Grid,
  GroupedBarChart,
  Kanban,
  KpiCard,
  MonthCalendar,
  PersonCell,
  ProgressBar,
  Sparkline,
  WidgetCard,
  WidgetRow,
  Alert,
  FilterChip,
  cx,
  type BosApprovalDecision,
  type BosColumn,
  type BosKanbanColumn,
} from "@/components/bos";
import type { BadgeSpec, Block, CellSpec, ChartSpec, KanbanSpec, WidgetRowSpec } from "./schema";

export type ModuleRendererContext = {
  /** Navigate to another module (widget links). */
  onNavigate?: (moduleKey: string) => void;
  /** Named actions from cells / widget rows / action bars. */
  onAction?: (action: string, label: string) => void;
  /** Renders `{ type: "custom" }` blocks. */
  renderCustom?: (id: string) => ReactNode;
};

const valueColor = (tone?: string) =>
  !tone ? undefined : tone === "faint" ? "var(--bos-text-faint)" : `var(--bos-${tone}-600)`;

function BadgeFromSpec({ spec, auto }: { spec: BadgeSpec; auto?: boolean }) {
  return (
    <Badge tone={spec.tone} tag={spec.tag} auto={auto}>
      {spec.text}
    </Badge>
  );
}

function renderCell(value: CellSpec, ctx: ModuleRendererContext): ReactNode {
  if (typeof value === "string" || typeof value === "number") return value;
  switch (value.kind) {
    case "badge":
      return <BadgeFromSpec spec={value.badge} />;
    case "mono":
      return <span className="bos-cell-mono">{value.text}</span>;
    case "text":
      return (
        <span style={{ color: valueColor(value.color), fontWeight: value.strong ? 650 : undefined }}>
          {value.text}
          {value.badge ? (
            <>
              {" "}
              <BadgeFromSpec spec={value.badge} auto />
            </>
          ) : null}
        </span>
      );
    case "person":
      return (
        <PersonCell
          avatar={
            <Avatar size="sm" tone={value.tone}>
              {value.initials}
            </Avatar>
          }
          name={value.name}
          role={value.role}
        />
      );
    case "action":
      return (
        <Button
          size="sm"
          variant={value.variant ?? "primary"}
          onClick={(e) => {
            e.stopPropagation();
            ctx.onAction?.(value.action, value.label);
          }}
        >
          {value.label}
        </Button>
      );
  }
}

function widgetRow(row: WidgetRowSpec, i: number, ctx: ModuleRendererContext) {
  const onClick = row.link
    ? () => ctx.onNavigate?.(row.link!)
    : row.action
      ? () => ctx.onAction?.(row.action!, row.label)
      : undefined;
  return (
    <WidgetRow
      key={i}
      label={row.label}
      value={row.badge ? <BadgeFromSpec spec={row.badge} /> : row.value}
      valueTone={row.valueTone}
      soft={row.soft}
      chevron={row.chevron}
      onClick={onClick}
    />
  );
}

function Chart({ spec }: { spec: ChartSpec }) {
  switch (spec.kind) {
    case "bars":
      return (
        <ChartCard title={spec.title} delta={spec.delta} deltaTone={spec.deltaTone}>
          <BarChart data={spec.data} tone={spec.tone} height={spec.height} renderHeight={spec.renderHeight} ariaLabel={spec.title} />
        </ChartCard>
      );
    case "grouped":
      return (
        <ChartCard
          title={spec.title}
          legend={[
            { label: spec.series[0], tone: "emerald" },
            { label: spec.series[1], tone: "coral" },
          ]}
        >
          <GroupedBarChart data={spec.data} series={spec.series} renderHeight={spec.renderHeight} ariaLabel={spec.title} />
        </ChartCard>
      );
    case "donut":
      return (
        <ChartCard
          title={spec.title}
          center
          legend={spec.segments.map((s, i) => ({ label: spec.legend?.[i] ?? s.label, tone: s.tone }))}
        >
          <DonutChart
            segments={spec.segments}
            size={spec.size ?? 90}
            centerValue={spec.centerValue}
            centerLabel={spec.centerLabel}
            rounded={spec.rounded}
            ariaLabel={spec.title}
          />
        </ChartCard>
      );
    case "spark":
      return (
        <ChartCard title={spec.title} delta={spec.delta} deltaTone={spec.deltaTone}>
          <Sparkline values={spec.values} tone={spec.tone} ariaLabel={spec.title} />
        </ChartCard>
      );
  }
}

function toKanban(spec: KanbanSpec): BosKanbanColumn[] {
  return spec.map((col) => ({
    id: col.id,
    title: col.title,
    dot: col.dot,
    highlightCount: col.highlight,
    cards: col.cards.map((c) => ({
      id: c.id,
      title: c.title,
      tag: c.tag ? <BadgeFromSpec spec={c.tag} auto /> : undefined,
      people: c.people?.length ? (
        <AvatarStack>
          {c.people.map((p) => (
            <Avatar key={p.initials} size="xs" pastel={{ fill: p.color, ink: "#fff" }}>
              {p.initials}
            </Avatar>
          ))}
        </AvatarStack>
      ) : undefined,
      due: c.due,
    })),
  }));
}

function KanbanBlock({ spec, draggable }: { spec: KanbanSpec; draggable?: boolean }) {
  const [columns, setColumns] = useState(() => toKanban(spec));
  const onMove = (cardId: string, from: string, to: string) => {
    setColumns((cols) => {
      const card = cols.find((c) => c.id === from)?.cards.find((c) => c.id === cardId);
      if (!card) return cols;
      return cols.map((c) =>
        c.id === from ? { ...c, cards: c.cards.filter((x) => x.id !== cardId) } : c.id === to ? { ...c, cards: [...c.cards, card] } : c,
      );
    });
  };
  return <Kanban columns={columns} onMove={draggable ? onMove : undefined} />;
}

function ApprovalsBlock({ block, ctx }: { block: Extract<Block, { type: "approvals" }>; ctx: ModuleRendererContext }) {
  const [decisions, setDecisions] = useState<Record<string, BosApprovalDecision>>({});
  const [outcomes, setOutcomes] = useState<Record<string, BadgeSpec>>({});
  return (
    <div>
      {block.label ? <BlockLabel>{block.label}</BlockLabel> : null}
      {block.items.map((item) => {
        if (item.buttons) {
          const outcome = outcomes[item.id];
          return (
            <ApprovalRow
              key={item.id}
              avatar={
                <Avatar size="sm" tone={item.tone}>
                  {item.initials}
                </Avatar>
              }
              name={item.name}
              meta={item.meta}
              extra={
                outcome ? (
                  <BadgeFromSpec spec={outcome} />
                ) : (
                  item.buttons.map((btn) => (
                    <Button
                      key={btn.label}
                      size="sm"
                      variant={btn.variant}
                      onClick={() => {
                        setOutcomes((cur) => ({ ...cur, [item.id]: btn.outcome }));
                        ctx.onAction?.(`row:${btn.label}`, `${item.name} — ${btn.label}`);
                      }}
                    >
                      {btn.label}
                    </Button>
                  ))
                )
              }
            />
          );
        }
        const decision = item.decided ?? decisions[item.id] ?? null;
        return (
          <ApprovalRow
            key={item.id}
            avatar={
              <Avatar size="sm" tone={item.tone}>
                {item.initials}
              </Avatar>
            }
            name={item.name}
            meta={item.meta}
            decision={decision}
            extra={
              item.badge ? (
                <BadgeFromSpec spec={item.badge} />
              ) : !decision ? (
                <Badge tone="amber">PENDING</Badge>
              ) : undefined
            }
            onDecide={
              item.badge
                ? undefined
                : (d) => {
                    setDecisions((cur) => ({ ...cur, [item.id]: d }));
                    ctx.onAction?.(`approval:${d}`, `${item.name} — ${d}`);
                  }
            }
          />
        );
      })}
    </div>
  );
}

function BlockView({ block, ctx }: { block: Block; ctx: ModuleRendererContext }) {
  switch (block.type) {
    case "kpis":
      return (
        <Grid cols={block.cols ?? block.items.length} min={140}>
          {block.items.map((k) => (
            <KpiCard
              key={k.label}
              label={k.label}
              value={k.value}
              chip={k.chip ? { color: k.chip[0], glyph: k.chip[1] } : undefined}
              delta={k.delta}
              deltaTone={k.deltaTone}
              valueTone={k.valueTone}
            />
          ))}
        </Grid>
      );
    case "widgets":
      return (
        <Grid cols={block.cols ?? block.items.length} template={block.template}>
          {block.items.map((w) => (
            <WidgetCard key={w.title} title={w.title} dot={w.dot} note={w.note}>
              {w.rows.map((r, i) => widgetRow(r, i, ctx))}
            </WidgetCard>
          ))}
        </Grid>
      );
    case "charts":
      return (
        <Grid template={block.template ?? (block.items.length === 2 ? "1.3fr 1fr" : undefined)} cols={block.items.length}>
          {block.items.map((c) => (
            <Chart key={c.title} spec={c} />
          ))}
        </Grid>
      );
    case "table": {
      const columns: BosColumn<Record<string, CellSpec>>[] = block.columns.map((c) => ({
        key: c.key,
        header: c.header,
        align: c.align,
        mono: c.mono,
        cell: (row) => (row[c.key] === undefined ? "" : renderCell(row[c.key], ctx)),
      }));
      return (
        <div>
          {block.label ? <BlockLabel>{block.label}</BlockLabel> : null}
          <DataTable
            columns={columns}
            rows={block.rows}
            rowKey={(row) => String(block.rows.indexOf(row))}
            compact={block.compact}
            empty={block.empty}
          />
        </div>
      );
    }
    case "approvals":
      return <ApprovalsBlock block={block} ctx={ctx} />;
    case "balances":
      return <BalanceRow items={block.items.map((b) => ({ ...b, tone: b.tone ? `var(--bos-${b.tone}-600)` : undefined }))} />;
    case "calendar":
      return (
        <MonthCalendar
          year={block.year}
          month={block.month}
          title={block.title}
          today={block.today ? new Date(block.year, block.month, block.today) : undefined}
          events={block.events.map((e) => ({
            date: `${block.year}-${String(block.month + 1).padStart(2, "0")}-${String(e.day).padStart(2, "0")}`,
            label: e.label,
            tint: e.tint,
          }))}
        />
      );
    case "kanban":
      return (
        <div>
          {block.label ? <BlockLabel>{block.label}</BlockLabel> : null}
          <KanbanBlock spec={block.columns} draggable={block.draggable} />
        </div>
      );
    case "label":
      return <BlockLabel>{block.text}</BlockLabel>;
    case "note":
      return (
        <p className="bos-section-desc" style={{ maxWidth: "none", textAlign: block.center ? "center" : undefined }}>
          {block.text}
        </p>
      );
    case "alert":
      return (
        <Alert tone={block.tone} title={block.title}>
          {block.desc}
        </Alert>
      );
    case "chips":
      return (
        <div>
          {block.label ? <BlockLabel>{block.label}</BlockLabel> : null}
          <div className="bos-row" style={{ flexWrap: "wrap", gap: 8 }}>
            {block.items.map((c) => (
              <FilterChip key={c} onClick={() => ctx.onAction?.("chip", c)}>
                {c}
              </FilterChip>
            ))}
          </div>
        </div>
      );
    case "progress":
      return (
        <div>
          {block.label ? <BlockLabel>{block.label}</BlockLabel> : null}
          <Card>
            <div className="bos-stack" style={{ "--bos-gap": "14px" } as CSSProperties}>
              {block.items.map((p) => (
                <div key={p.label}>
                  <div className="bos-row-between" style={{ fontSize: 12.5 }}>
                    <span style={{ fontWeight: 600 }}>{p.label}</span>
                    <span className="bos-mono" style={{ fontSize: 11.5, color: `var(--bos-${p.tone}-600)` }}>
                      {p.value}
                    </span>
                  </div>
                  <ProgressBar value={p.pct} tone={p.tone} label={p.label} />
                </div>
              ))}
            </div>
          </Card>
        </div>
      );
    case "cards":
      return (
        <Grid cols={block.cols ?? block.items.length} template={block.template}>
          {block.items.map((c) => (
            <Card key={c.heading} flat>
              <div className={cx("bos-card-heading", c.tone && c.tone !== "blue" && `bos-card-heading-${c.tone}`)}>{c.heading}</div>
              {c.rows.map((r, i) => (
                <div key={i} className="bos-list-row">
                  <span style={{ color: "var(--bos-text-muted)" }}>{r.label}</span>
                  {r.badge ? (
                    <BadgeFromSpec spec={r.badge} />
                  ) : (
                    <span className="bos-mono" style={{ fontWeight: 650, color: valueColor(r.tone) }}>
                      {r.value}
                    </span>
                  )}
                </div>
              ))}
            </Card>
          ))}
        </Grid>
      );
    case "grid":
      return (
        <Grid template={block.template} style={{ alignItems: "start" }}>
          {block.children.map((child, i) => (
            <div key={i} style={{ minWidth: 0 }}>
              <BlockView block={child} ctx={ctx} />
            </div>
          ))}
        </Grid>
      );
    case "actions":
      return (
        <div className="bos-row" style={{ flexWrap: "wrap", gap: 8 }}>
          {block.items.map((a) => (
            <Button key={a.label} size="sm" variant={a.variant ?? "secondary"} onClick={() => ctx.onAction?.(a.action, a.label)}>
              {a.label}
            </Button>
          ))}
        </div>
      );
    case "celebrations":
      return (
        <div>
          {block.title ? <BlockLabel>{block.title}</BlockLabel> : null}
          <Celebrations
            label={block.label}
            items={block.items.map((c) => ({
              initials: c.initials,
              name: c.name,
              tag: c.tag,
              tint: c.tint,
              avatar: { fill: `var(--bos-pastel-${c.pastel})`, ink: `var(--bos-pastel-${c.pastel}-ink)` },
            }))}
          />
        </div>
      );
    case "custom":
      return <>{ctx.renderCustom?.(block.id) ?? null}</>;
  }
}

/** Renders a block stack with the standard 20px rhythm between blocks. */
export function ModuleRenderer({ blocks, ctx = {} }: { blocks: Block[]; ctx?: ModuleRendererContext }) {
  return (
    <div className="bos-stack" style={{ "--bos-gap": "20px" } as CSSProperties}>
      {blocks.map((block, i) => (
        <Fragment key={i}>
          <BlockView block={block} ctx={ctx} />
        </Fragment>
      ))}
    </div>
  );
}
