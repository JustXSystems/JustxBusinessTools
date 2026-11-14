"use client";

import "./bom.css";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  FilterChip,
  FormGrid,
  Grid,
  KpiCard,
  SearchInput,
  Segmented,
  Select,
} from "@/components/bos";
import { bom, type BomDiffEntry, type BomDiffLine, type BomPackage } from "@/lib/ims/bom";
import { downloadCsv, inrExact, qtyText } from "@/lib/ims/format";
import { ErrorBlock, LoadingBlock, PageHeader, RequirePerm, Stack, useIms, useImsAction, useImsData } from "../core";

type CompareMode = "package" | "doc";
type KindFilter = "all" | "added" | "removed" | "changed" | "same";
type DiffView = "cards" | "split" | "table";
type Option = { id: string; label: string; meta?: string };

const RECENT_KEY = "ims.bom.compare.recent";
const PREFS_KEY = "ims.bom.compare.prefs";

type RecentPair = { mode: CompareMode; leftId: string; rightId: string; leftLabel: string; rightLabel: string; at: number };
type ComparePrefs = { view?: DiffView; kind?: KindFilter; showSame?: boolean; groupSections?: boolean };

export default function BomCompareScreen() {
  return (
    <RequirePerm perm={["bom", "bomPackages"]} what="BOM compare">
      <CompareBody />
    </RequirePerm>
  );
}

function parseCompareIntent(raw: string | null): { mode: CompareMode; leftId: string; rightId: string } | null {
  if (!raw) return null;
  if (raw.startsWith("docs:")) {
    const [a, b] = raw
      .slice(5)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (a) return { mode: "doc", leftId: a, rightId: b || "" };
  }
  if (raw.startsWith("doc:")) {
    const id = raw.slice(4).trim();
    if (id) return { mode: "doc", leftId: id, rightId: "" };
  }
  if (raw.startsWith("packages:")) {
    const [a, b] = raw
      .slice(9)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (a) return { mode: "package", leftId: a, rightId: b || "" };
  }
  return null;
}

function readPrefs(): ComparePrefs {
  try {
    const raw = JSON.parse(window.localStorage.getItem(PREFS_KEY) || "{}") as ComparePrefs;
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

function writePrefs(prefs: ComparePrefs) {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* private mode */
  }
}

function readRecent(): RecentPair[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(RECENT_KEY) || "[]") as RecentPair[];
    return Array.isArray(raw) ? raw.slice(0, 8) : [];
  } catch {
    return [];
  }
}

function pushRecent(pair: RecentPair) {
  try {
    const next = [pair, ...readRecent().filter((r) => !(r.mode === pair.mode && r.leftId === pair.leftId && r.rightId === pair.rightId))].slice(0, 8);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* private mode */
  }
}

function lineAmount(line: BomDiffLine): number {
  return Math.round((line.qty * line.rate + Number.EPSILON) * 100) / 100;
}

function deltaTone(n: number): "up" | "down" | "muted" {
  if (n > 0) return "up";
  if (n < 0) return "down";
  return "muted";
}

function signed(n: number, money = false): string {
  const abs = money ? inrExact(Math.abs(n)) : qtyText(Math.abs(n));
  if (n > 0) return `+${abs}`;
  if (n < 0) return `−${abs}`;
  return money ? inrExact(0) : "0";
}

function CompareBody() {
  const { takeIntent, can } = useIms();
  const canBom = can("bom");
  const [intent] = useState(() => parseCompareIntent(takeIntent("bomCompare")));
  const { run, busy } = useImsAction();
  const packages = useImsData(() => bom.packages({ active: true, limit: 200 }), []);
  const docs = useImsData(
    () =>
      canBom
        ? bom.docs({ limit: 200, sort: "recent" })
        : Promise.resolve({
            docs: [] as Awaited<ReturnType<typeof bom.docs>>["docs"],
            total: 0,
            invoiceConvertModes: [] as Awaited<ReturnType<typeof bom.docs>>["invoiceConvertModes"],
          }),
    [canBom],
  );

  const intentUsable = Boolean(intent && (intent.mode === "package" || canBom));
  const [mode, setMode] = useState<CompareMode>(intentUsable && intent?.mode === "doc" ? "doc" : "package");
  const [leftId, setLeftId] = useState(intentUsable ? intent?.leftId ?? "" : "");
  const [rightId, setRightId] = useState(intentUsable ? intent?.rightId ?? "" : "");
  const [diff, setDiff] = useState<BomDiffEntry[] | null>(null);
  const [pickerQ, setPickerQ] = useState("");
  const [resultQ, setResultQ] = useState("");
  const [kind, setKind] = useState<KindFilter>("all");
  const [view, setView] = useState<DiffView>("cards");
  const [showSame, setShowSame] = useState(false);
  const [groupSections, setGroupSections] = useState(true);
  const [sectionFilter, setSectionFilter] = useState<string>("all");
  const [prefsReady, setPrefsReady] = useState(false);
  const [recent, setRecent] = useState<RecentPair[]>([]);
  const [pulse, setPulse] = useState(false);
  const autoTimer = useRef<number | null>(null);

  useEffect(() => {
    const p = readPrefs();
    if (p.view) setView(p.view);
    if (p.kind) setKind(p.kind);
    if (p.showSame != null) setShowSame(p.showSame);
    if (p.groupSections != null) setGroupSections(p.groupSections);
    setRecent(readRecent());
    setPrefsReady(true);
  }, []);

  useEffect(() => {
    if (!prefsReady) return;
    writePrefs({ view, kind, showSame, groupSections });
  }, [prefsReady, view, kind, showSame, groupSections]);

  useEffect(() => {
    if (!canBom && mode === "doc") {
      setMode("package");
      setLeftId("");
      setRightId("");
      setDiff(null);
    }
  }, [canBom, mode]);

  const extraDocs = useImsData(async () => {
    if (!canBom || mode !== "doc") return [] as Option[];
    const need = [leftId, rightId].filter(Boolean);
    const have = new Set((docs.data?.docs ?? []).map((d) => d.id));
    const missing = need.filter((id) => !have.has(id));
    if (!missing.length) return [];
    const out: Option[] = [];
    for (const id of missing) {
      try {
        const { doc } = await bom.doc(id);
        out.push({
          id: doc.id,
          label: `${doc.docNo} · ${doc.customerName || "No customer"}`,
          meta: [doc.packageName, doc.capacityLabel].filter(Boolean).join(" · ") || undefined,
        });
      } catch {
        /* ignore */
      }
    }
    return out;
  }, [canBom, mode, leftId, rightId, docs.data]);

  const options = useMemo((): Option[] => {
    if (mode === "package") {
      return (packages.data?.packages ?? []).map((p: BomPackage) => ({
        id: p.id,
        label: `${p.code ? `${p.code} · ` : ""}${p.name}`,
        meta: p.capacityLabel || undefined,
      }));
    }
    const base: Option[] = (docs.data?.docs ?? []).map((d) => ({
      id: d.id,
      label: `${d.docNo} · ${d.customerName || "No customer"}`,
      meta: [d.packageName, d.capacityLabel, d.status].filter(Boolean).join(" · ") || undefined,
    }));
    const extras = extraDocs.data ?? [];
    const seen = new Set(base.map((o) => o.id));
    return [...base, ...extras.filter((o) => !seen.has(o.id))];
  }, [mode, packages.data, docs.data, extraDocs.data]);

  const filteredOptions = useMemo(() => {
    const q = pickerQ.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => `${o.label} ${o.meta ?? ""}`.toLowerCase().includes(q));
  }, [options, pickerQ]);

  const leftOpt = options.find((o) => o.id === leftId) ?? null;
  const rightOpt = options.find((o) => o.id === rightId) ?? null;

  const runDiff = async (silent = false) => {
    if (!leftId || !rightId || leftId === rightId) return;
    if (mode === "doc" && !canBom) return;
    setPulse(true);
    const body =
      mode === "package"
        ? { leftPackageId: leftId, rightPackageId: rightId }
        : { leftDocId: leftId, rightDocId: rightId };
    const out = await run("diff", () => bom.diff(body), {
      success: silent ? undefined : "Comparison ready",
      refresh: false,
    });
    setPulse(false);
    if (!out) return;
    setDiff(out.diff);
    setSectionFilter("all");
    const pair: RecentPair = {
      mode,
      leftId,
      rightId,
      leftLabel: leftOpt?.label ?? leftId,
      rightLabel: rightOpt?.label ?? rightId,
      at: Date.now(),
    };
    pushRecent(pair);
    setRecent(readRecent());
  };

  /** Live re-compare when both sides are set (debounced), including deep-link intents. */
  useEffect(() => {
    if (!leftId || !rightId || leftId === rightId) return;
    if (mode === "doc" && !canBom) return;
    if (mode === "doc" && options.length && (!options.some((o) => o.id === leftId) || !options.some((o) => o.id === rightId))) return;
    if (autoTimer.current) window.clearTimeout(autoTimer.current);
    autoTimer.current = window.setTimeout(() => {
      void runDiff(true);
    }, 350);
    return () => {
      if (autoTimer.current) window.clearTimeout(autoTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leftId, rightId, mode, canBom, options]);

  const stats = useMemo(() => {
    const rows = diff ?? [];
    let added = 0;
    let removed = 0;
    let changed = 0;
    let same = 0;
    let leftTotal = 0;
    let rightTotal = 0;
    for (const d of rows) {
      if (d.kind === "added") {
        added += 1;
        rightTotal += lineAmount(d.right);
      } else if (d.kind === "removed") {
        removed += 1;
        leftTotal += lineAmount(d.left);
      } else if (d.kind === "changed") {
        changed += 1;
        leftTotal += lineAmount(d.left);
        rightTotal += lineAmount(d.right);
      } else {
        same += 1;
        leftTotal += lineAmount(d.left);
        rightTotal += lineAmount(d.right);
      }
    }
    const total = rows.length || 1;
    const matchPct = Math.round((same / total) * 100);
    return { added, removed, changed, same, leftTotal, rightTotal, delta: rightTotal - leftTotal, matchPct, total: rows.length };
  }, [diff]);

  const sections = useMemo(() => {
    const set = new Set<string>();
    for (const d of diff ?? []) {
      const left = "left" in d ? d.left : null;
      const right = "right" in d ? d.right : null;
      if (left?.section) set.add(left.section);
      if (right?.section) set.add(right.section);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [diff]);

  const visible = useMemo(() => {
    const q = resultQ.trim().toLowerCase();
    return (diff ?? []).filter((d) => {
      if (kind !== "all" && d.kind !== kind) return false;
      if (!showSame && d.kind === "same") return false;
      const left = "left" in d ? d.left : null;
      const right = "right" in d ? d.right : null;
      const section = left?.section || right?.section || "";
      if (sectionFilter !== "all" && section !== sectionFilter) return false;
      if (!q) return true;
      const hay = [left?.description, right?.description, left?.section, right?.section, left?.unit, right?.unit, d.kind]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [diff, kind, showSame, sectionFilter, resultQ]);

  const grouped = useMemo(() => {
    if (!groupSections) return [{ section: "", rows: visible }];
    const map = new Map<string, BomDiffEntry[]>();
    for (const d of visible) {
      const left = "left" in d ? d.left : null;
      const right = "right" in d ? d.right : null;
      const section = left?.section || right?.section || "Unsectioned";
      const list = map.get(section) ?? [];
      list.push(d);
      map.set(section, list);
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([section, rows]) => ({ section, rows }));
  }, [visible, groupSections]);

  const swapSides = () => {
    setLeftId(rightId);
    setRightId(leftId);
    setDiff(null);
  };

  const resetPair = () => {
    setLeftId("");
    setRightId("");
    setDiff(null);
    setResultQ("");
    setKind("all");
    setSectionFilter("all");
  };

  const exportDiff = () => {
    if (!diff?.length) return;
    downloadCsv(
      `bom-compare-${mode}`,
      diff,
      [
        { header: "Kind", value: (d) => d.kind },
        { header: "Section L", value: (d) => ("left" in d ? d.left.section : "") },
        { header: "Description L", value: (d) => ("left" in d ? d.left.description : "") },
        { header: "Qty L", value: (d) => ("left" in d ? d.left.qty : "") },
        { header: "Unit L", value: (d) => ("left" in d ? d.left.unit : "") },
        { header: "Rate L", value: (d) => ("left" in d ? d.left.rate : "") },
        { header: "Amount L", value: (d) => ("left" in d ? lineAmount(d.left) : "") },
        { header: "Section R", value: (d) => ("right" in d ? d.right.section : "") },
        { header: "Description R", value: (d) => ("right" in d ? d.right.description : "") },
        { header: "Qty R", value: (d) => ("right" in d ? d.right.qty : "") },
        { header: "Unit R", value: (d) => ("right" in d ? d.right.unit : "") },
        { header: "Rate R", value: (d) => ("right" in d ? d.right.rate : "") },
        { header: "Amount R", value: (d) => ("right" in d ? lineAmount(d.right) : "") },
        { header: "Fields", value: (d) => (d.kind === "changed" ? d.fields.join("|") : "") },
      ],
    );
  };

  if (!packages.data && !packages.error) return <LoadingBlock />;
  if (packages.error) return <ErrorBlock error={packages.error} onRetry={packages.reload} />;
  if (canBom && mode === "doc" && !docs.data && !docs.error) return <LoadingBlock />;
  if (canBom && mode === "doc" && docs.error) return <ErrorBlock error={docs.error} onRetry={docs.reload} />;

  const canRun = Boolean(leftId && rightId && leftId !== rightId && !(mode === "doc" && !canBom));

  return (
    <Stack gap={16}>
      <PageHeader
        title="Compare"
        sub="Line-level radar for packages or customer BOMs — qty, rate, unit, section and value impact."
        actions={
          <div className="ims-bom-compare-actions">
            <Button size="sm" variant="ghost" disabled={!leftId && !rightId} onClick={resetPair}>
              Clear
            </Button>
            <Button size="sm" variant="ghost" disabled={!diff?.length} icon="download" onClick={exportDiff}>
              Export
            </Button>
            <Button variant="primary" disabled={!canRun || Boolean(busy)} onClick={() => void runDiff()}>
              {busy === "diff" || pulse ? "Scanning…" : "Compare"}
            </Button>
          </div>
        }
      />

      <Card interactive={false} className={`ims-bom-compare-arena${pulse ? " is-scanning" : ""}`}>
        <div className="ims-bom-compare-arena-top">
          <Segmented
            size="sm"
            role="tabs"
            aria-label="Compare source"
            value={mode}
            onChange={(v) => {
              setMode(v);
              setLeftId("");
              setRightId("");
              setDiff(null);
              setPickerQ("");
            }}
            options={[
              { value: "package" as const, label: "Packages" },
              ...(canBom ? [{ value: "doc" as const, label: "Customer BOMs" }] : []),
            ]}
          />
          <SearchInput
            wrapperClassName="ims-bom-compare-picker-search"
            placeholder={mode === "package" ? "Filter packages…" : "Filter BOMs…"}
            value={pickerQ}
            onChange={(e) => setPickerQ(e.target.value)}
            aria-label="Filter compare options"
          />
        </div>

        <div className="ims-bom-compare-panes">
          <ComparePane
            side="left"
            label="Baseline"
            value={leftId}
            options={filteredOptions}
            excludeId={rightId}
            selected={leftOpt}
            onChange={(id) => {
              setLeftId(id);
              setDiff(null);
            }}
          />
          <div className="ims-bom-compare-swap">
            <button type="button" className="ims-bom-compare-swap-btn" onClick={swapSides} disabled={!leftId && !rightId} title="Swap sides" aria-label="Swap left and right">
              ⇄
            </button>
            <div className={`ims-bom-compare-match${diff ? " is-live" : ""}`} title={diff ? `${stats.matchPct}% lines unchanged` : "Pick two sides"}>
              <span className="ims-bom-compare-match-ring" style={{ "--pct": diff ? stats.matchPct : 0 } as CSSProperties}>
                <b>{diff ? stats.matchPct : "—"}</b>
                <small>{diff ? "match" : "ready"}</small>
              </span>
            </div>
          </div>
          <ComparePane
            side="right"
            label="Candidate"
            value={rightId}
            options={filteredOptions}
            excludeId={leftId}
            selected={rightOpt}
            onChange={(id) => {
              setRightId(id);
              setDiff(null);
            }}
          />
        </div>

        {intent?.leftId && !intent.rightId && mode === "doc" ? (
          <p className="ims-bom-compare-hint">Baseline prefilled from Create / Maintain — pick a candidate to scan.</p>
        ) : null}

        {recent.length ? (
          <div className="ims-bom-compare-recent" aria-label="Recent comparisons">
            <span className="ims-bom-compare-recent-label">Recent</span>
            {recent
              .filter((r) => r.mode === mode || (r.mode === "doc" && canBom))
              .slice(0, 5)
              .map((r) => (
                <button
                  key={`${r.mode}-${r.leftId}-${r.rightId}-${r.at}`}
                  type="button"
                  className="ims-bom-compare-recent-chip"
                  onClick={() => {
                    setMode(r.mode);
                    setLeftId(r.leftId);
                    setRightId(r.rightId);
                  }}
                  title={`${r.leftLabel} → ${r.rightLabel}`}
                >
                  {r.leftLabel.split(" · ")[0]} → {r.rightLabel.split(" · ")[0]}
                </button>
              ))}
          </div>
        ) : null}
      </Card>

      {!diff ? (
        <EmptyState glyph="⇄" title="Pick two sides to scan">
          Choose a baseline and candidate{canBom ? " — packages or customer BOMs" : ""}. Diff runs automatically when both are set.
        </EmptyState>
      ) : (
        <>
          <Grid cols={4} min={140}>
            <KpiCard
              interactive={false}
              label="Match"
              value={`${stats.matchPct}%`}
              chip={{ color: stats.matchPct >= 85 ? "sage" : stats.matchPct >= 60 ? "amber" : "rose", glyph: "◎" }}
              delta={`${stats.same} unchanged · ${stats.total} lines`}
              deltaTone="muted"
            />
            <button type="button" className="ims-bom-kpi-hit" onClick={() => setKind(kind === "added" ? "all" : "added")} aria-label="Filter added lines">
              <KpiCard
                interactive={false}
                label="Added"
                value={stats.added}
                valueTone={stats.added ? "emerald" : undefined}
                chip={{ color: "sage", glyph: "+" }}
                delta={kind === "added" ? "Filtered" : "Only on candidate"}
                deltaTone="muted"
              />
            </button>
            <button type="button" className="ims-bom-kpi-hit" onClick={() => setKind(kind === "removed" ? "all" : "removed")} aria-label="Filter removed lines">
              <KpiCard
                interactive={false}
                label="Removed"
                value={stats.removed}
                valueTone={stats.removed ? "coral" : undefined}
                chip={{ color: "rose", glyph: "−" }}
                delta={kind === "removed" ? "Filtered" : "Only on baseline"}
                deltaTone="muted"
              />
            </button>
            <button type="button" className="ims-bom-kpi-hit" onClick={() => setKind(kind === "changed" ? "all" : "changed")} aria-label="Filter changed lines">
              <KpiCard
                interactive={false}
                label="Value delta"
                value={signed(stats.delta, true)}
                valueTone={stats.delta > 0 ? "amber" : stats.delta < 0 ? "emerald" : undefined}
                chip={{ color: "lavender", glyph: "Δ" }}
                delta={`${stats.changed} changed · ${inrExact(stats.leftTotal)} → ${inrExact(stats.rightTotal)}`}
                deltaTone={deltaTone(stats.delta)}
              />
            </button>
          </Grid>

          <Card interactive={false} className="ims-bom-compare-results">
            <div className="ims-bom-compare-toolbar">
              <SearchInput
                wrapperClassName="ims-grow"
                placeholder="Search lines, sections, units…"
                value={resultQ}
                onChange={(e) => setResultQ(e.target.value)}
                aria-label="Search diff lines"
              />
              <Segmented
                size="sm"
                role="radio"
                aria-label="Diff view"
                value={view}
                onChange={setView}
                options={[
                  { value: "cards" as const, label: "Cards", ariaLabel: "Card view" },
                  { value: "split" as const, label: "Split", ariaLabel: "Split view" },
                  { value: "table" as const, label: "Table", ariaLabel: "Table view" },
                ]}
              />
            </div>

            <div className="ims-bom-list-chips">
              {(
                [
                  ["all", "All"],
                  ["added", `Added · ${stats.added}`],
                  ["removed", `Removed · ${stats.removed}`],
                  ["changed", `Changed · ${stats.changed}`],
                  ["same", `Same · ${stats.same}`],
                ] as const
              ).map(([k, label]) => (
                <FilterChip
                  key={k}
                  active={kind === k}
                  onClick={() => {
                    if (k === "same") {
                      setShowSame(true);
                      setKind("same");
                      return;
                    }
                    if (k === "all") setShowSame(false);
                    setKind(k);
                  }}
                >
                  {label}
                </FilterChip>
              ))}
              <FilterChip active={groupSections} onClick={() => setGroupSections((v) => !v)}>
                Group sections
              </FilterChip>
              <FilterChip
                active={showSame && kind === "all"}
                onClick={() => {
                  setShowSame((v) => !v);
                  if (kind === "same") setKind("all");
                }}
              >
                Include unchanged
              </FilterChip>
            </div>

            {sections.length > 1 ? (
              <FormGrid>
                <Field label="Section">
                  {({ id }) => (
                    <Select id={id} value={sectionFilter} onChange={(e) => setSectionFilter(e.target.value)}>
                      <option value="all">All sections</option>
                      {sections.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              </FormGrid>
            ) : null}

            {!visible.length ? (
              <EmptyState title="No lines in this view">Try another filter, include unchanged, or clear search.</EmptyState>
            ) : view === "table" ? (
              <DiffTable groups={grouped} leftLabel={leftOpt?.label ?? "Left"} rightLabel={rightOpt?.label ?? "Right"} />
            ) : (
              <div className={view === "split" ? "ims-bom-compare-split-list" : "ims-bom-compare-card-list"}>
                {grouped.map((g) => (
                  <div key={g.section || "all"} className="ims-bom-compare-group">
                    {groupSections && g.section ? <div className="ims-bom-compare-group-head">{g.section}</div> : null}
                    {g.rows.map((d, i) => (
                      <DiffRow key={`${d.kind}-${i}-${"left" in d ? d.left.key : d.right.key}`} entry={d} view={view} />
                    ))}
                  </div>
                ))}
              </div>
            )}

            <div className="ims-bom-compare-foot">
              Showing {visible.length} of {stats.total} lines
              {kind !== "all" ? ` · ${kind}` : ""}
              {sectionFilter !== "all" ? ` · ${sectionFilter}` : ""}
            </div>
          </Card>
        </>
      )}
    </Stack>
  );
}

function ComparePane({
  side,
  label,
  value,
  options,
  excludeId,
  selected,
  onChange,
}: {
  side: "left" | "right";
  label: string;
  value: string;
  options: Option[];
  excludeId: string;
  selected: Option | null;
  onChange: (id: string) => void;
}) {
  return (
    <div className={`ims-bom-compare-pane ims-bom-compare-pane--${side}`}>
      <div className="ims-bom-compare-pane-head">
        <span className="ims-bom-compare-pane-tag">{side === "left" ? "A" : "B"}</span>
        <div>
          <div className="ims-bom-compare-pane-label">{label}</div>
          <div className="ims-bom-compare-pane-sub">{selected?.meta || (side === "left" ? "Reference" : "Variant")}</div>
        </div>
      </div>
      <Select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
        <option value="">Select…</option>
        {options.map((o) => (
          <option key={o.id} value={o.id} disabled={o.id === excludeId}>
            {o.label}
            {o.meta ? ` · ${o.meta}` : ""}
          </option>
        ))}
      </Select>
      {selected ? <div className="ims-bom-compare-pane-chosen">{selected.label}</div> : <div className="ims-bom-compare-pane-chosen is-empty">Waiting for selection</div>}
    </div>
  );
}

function DiffRow({ entry, view }: { entry: BomDiffEntry; view: DiffView }) {
  const left = "left" in entry ? entry.left : null;
  const right = "right" in entry ? entry.right : null;
  const tone = entry.kind === "added" ? "emerald" : entry.kind === "removed" ? "coral" : entry.kind === "changed" ? "amber" : "neutral";
  const title = left?.description || right?.description || "Line";

  if (view === "split") {
    return (
      <div className={`ims-bom-compare-split-row is-${entry.kind}`}>
        <div className="ims-bom-compare-split-side">
          {left ? <LineBlock line={left} highlight={entry.kind === "changed" ? entry.fields : []} ghost={entry.kind === "added"} /> : <div className="ims-bom-compare-ghost">—</div>}
        </div>
        <div className="ims-bom-compare-split-mid">
          <Badge tone={tone}>{entry.kind}</Badge>
        </div>
        <div className="ims-bom-compare-split-side">
          {right ? <LineBlock line={right} highlight={entry.kind === "changed" ? entry.fields : []} ghost={entry.kind === "removed"} /> : <div className="ims-bom-compare-ghost">—</div>}
        </div>
      </div>
    );
  }

  return (
    <article className={`ims-bom-compare-card is-${entry.kind}`}>
      <header className="ims-bom-compare-card-head">
        <Badge tone={tone}>{entry.kind}</Badge>
        <strong>{title}</strong>
        {entry.kind === "changed" ? <span className="ims-faint">{entry.fields.join(" · ")}</span> : null}
      </header>
      <div className="ims-bom-compare-card-grid">
        <div>
          <div className="ims-bom-compare-col-label">Baseline</div>
          {left ? <LineBlock line={left} highlight={entry.kind === "changed" ? entry.fields : []} /> : <div className="ims-bom-compare-ghost">Not on baseline</div>}
        </div>
        <div>
          <div className="ims-bom-compare-col-label">Candidate</div>
          {right ? <LineBlock line={right} highlight={entry.kind === "changed" ? entry.fields : []} /> : <div className="ims-bom-compare-ghost">Not on candidate</div>}
        </div>
      </div>
      {entry.kind === "changed" ? <FieldDeltas left={entry.left} right={entry.right} fields={entry.fields} /> : null}
      {entry.kind === "added" ? (
        <div className="ims-bom-compare-impact is-up">Adds {inrExact(lineAmount(entry.right))}</div>
      ) : null}
      {entry.kind === "removed" ? (
        <div className="ims-bom-compare-impact is-down">Removes {inrExact(lineAmount(entry.left))}</div>
      ) : null}
    </article>
  );
}

function LineBlock({ line, highlight = [], ghost = false }: { line: BomDiffLine; highlight?: string[]; ghost?: boolean }) {
  return (
    <div className={`ims-bom-compare-line${ghost ? " is-ghost" : ""}`}>
      <div className="ims-bom-compare-line-desc">
        <span className={highlight.includes("description") ? "is-hot" : undefined}>{line.description}</span>
        <small className={highlight.includes("section") ? "is-hot" : undefined}>{line.section}</small>
      </div>
      <div className="ims-bom-compare-line-metrics">
        <span className={highlight.includes("qty") || highlight.includes("unit") ? "is-hot" : undefined}>
          {qtyText(line.qty)} {line.unit}
        </span>
        <span className={highlight.includes("rate") ? "is-hot" : undefined}>@ {inrExact(line.rate)}</span>
        <span className="ims-bom-compare-amt">{inrExact(lineAmount(line))}</span>
      </div>
    </div>
  );
}

function FieldDeltas({ left, right, fields }: { left: BomDiffLine; right: BomDiffLine; fields: string[] }) {
  const rows: Array<{ label: string; from: string; to: string; delta?: string; tone?: "up" | "down" }> = [];
  if (fields.includes("qty")) {
    const d = right.qty - left.qty;
    rows.push({ label: "Qty", from: qtyText(left.qty), to: qtyText(right.qty), delta: signed(d), tone: d > 0 ? "up" : d < 0 ? "down" : undefined });
  }
  if (fields.includes("unit")) rows.push({ label: "Unit", from: left.unit, to: right.unit });
  if (fields.includes("rate")) {
    const d = right.rate - left.rate;
    rows.push({ label: "Rate", from: inrExact(left.rate), to: inrExact(right.rate), delta: signed(d, true), tone: d > 0 ? "up" : d < 0 ? "down" : undefined });
  }
  if (fields.includes("section")) rows.push({ label: "Section", from: left.section, to: right.section });
  if (fields.includes("description")) rows.push({ label: "Description", from: left.description, to: right.description });
  const amt = lineAmount(right) - lineAmount(left);
  rows.push({ label: "Amount", from: inrExact(lineAmount(left)), to: inrExact(lineAmount(right)), delta: signed(amt, true), tone: amt > 0 ? "up" : amt < 0 ? "down" : undefined });

  return (
    <div className="ims-bom-compare-deltas">
      {rows.map((r) => (
        <div key={r.label} className="ims-bom-compare-delta-row">
          <span className="ims-bom-compare-delta-label">{r.label}</span>
          <span className="ims-bom-compare-delta-from">{r.from}</span>
          <span className="ims-bom-compare-delta-arrow" aria-hidden="true">
            →
          </span>
          <span className="ims-bom-compare-delta-to">{r.to}</span>
          {r.delta ? <span className={`ims-bom-compare-delta-num is-${r.tone ?? "muted"}`}>{r.delta}</span> : null}
        </div>
      ))}
    </div>
  );
}

function DiffTable({
  groups,
  leftLabel,
  rightLabel,
}: {
  groups: Array<{ section: string; rows: BomDiffEntry[] }>;
  leftLabel: string;
  rightLabel: string;
}) {
  return (
    <div className="ims-bom-compare-table-wrap">
      <table className="ims-bom-compare-table">
        <thead>
          <tr>
            <th>Kind</th>
            <th>Line</th>
            <th className="is-num">{leftLabel.split(" · ")[0]} qty</th>
            <th className="is-num">Rate</th>
            <th className="is-num">{rightLabel.split(" · ")[0]} qty</th>
            <th className="is-num">Rate</th>
            <th className="is-num">Δ amount</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <FragmentSection key={g.section || "all"} section={g.section} rows={g.rows} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FragmentSection({ section, rows }: { section: string; rows: BomDiffEntry[] }) {
  return (
    <>
      {section ? (
        <tr className="ims-bom-compare-table-section">
          <td colSpan={7}>{section}</td>
        </tr>
      ) : null}
      {rows.map((d, i) => {
        const left = "left" in d ? d.left : null;
        const right = "right" in d ? d.right : null;
        const delta = (right ? lineAmount(right) : 0) - (left ? lineAmount(left) : 0);
        return (
          <tr key={`${d.kind}-${i}`} className={`is-${d.kind}`}>
            <td>
              <Badge tone={d.kind === "added" ? "emerald" : d.kind === "removed" ? "coral" : d.kind === "changed" ? "amber" : "neutral"}>{d.kind}</Badge>
            </td>
            <td>{left?.description || right?.description}</td>
            <td className="is-num">{left ? `${qtyText(left.qty)} ${left.unit}` : "—"}</td>
            <td className="is-num">{left ? inrExact(left.rate) : "—"}</td>
            <td className="is-num">{right ? `${qtyText(right.qty)} ${right.unit}` : "—"}</td>
            <td className="is-num">{right ? inrExact(right.rate) : "—"}</td>
            <td className={`is-num is-${deltaTone(delta)}`}>{signed(delta, true)}</td>
          </tr>
        );
      })}
    </>
  );
}
