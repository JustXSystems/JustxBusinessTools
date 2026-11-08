"use client";

import "./bom.css";
import { useMemo, useRef, useState } from "react";
import { Alert, Badge, Button, Card, EmptyState, Field, FormGrid, Input, Select, Textarea } from "@/components/bos";
import {
  BOM_LINE_KIND_LABEL,
  BOM_LINE_KINDS,
  bom,
  type BomLineKind,
  type BomPackage,
  type BomPackageLineInput,
} from "@/lib/ims/bom";
import { ims, type ImsItem } from "@/lib/ims/api";
import { applyCatalogMatches, parseBomPackageWorkbook } from "@/lib/ims/bom-excel";
import { ErrorBlock, LoadingBlock, PageHeader, RequirePerm, Stack, useImsAction, useImsData, useOpenIntent } from "../core";
import { ItemPickerDialog } from "../shared/pickers";

type View = { mode: "list" } | { mode: "edit"; id: string | null };

const blankLine = (section = "Main Items"): BomPackageLineInput & { key: string } => ({
  key: Math.random().toString(36).slice(2),
  section,
  lineKind: "stock",
  description: "",
  makeText: "",
  qty: 1,
  unit: "nos",
  defaultRate: 0,
  scaleByCapacity: false,
  remarks: "",
});

export default function BomPackagesScreen() {
  const openId = useOpenIntent("bomPackages");
  const [view, setView] = useState<View>(() => (openId ? { mode: "edit", id: openId } : { mode: "list" }));
  return (
    <RequirePerm perm="bom" what="BOM packages">
      {view.mode === "edit" ? (
        <PackageEditor id={view.id} onBack={() => setView({ mode: "list" })} />
      ) : (
        <PackageList onNew={() => setView({ mode: "edit", id: null })} onOpen={(id) => setView({ mode: "edit", id })} />
      )}
    </RequirePerm>
  );
}

function PackageList({ onNew, onOpen }: { onNew: () => void; onOpen: (id: string) => void }) {
  const { run, busy } = useImsAction();
  const state = useImsData(() => bom.packages({ active: false, limit: 200 }), []);
  const packages = state.data?.packages ?? [];
  const fileRef = useRef<HTMLInputElement>(null);

  const importExcel = async (file: File) => {
    const parsed = await parseBomPackageWorkbook(file);
    if (!parsed.length) throw new Error("No package sheets found in that workbook");
    const catalog = await ims.items({ includeInactive: false }).then((r) => r.items);
    const { packages: matched, summary } = applyCatalogMatches(parsed, catalog);
    let created = 0;
    for (const pkg of matched) {
      await bom.createPackage(pkg);
      created += 1;
    }
    return { created, summary };
  };

  return (
    <Stack>
      <PageHeader
        title="BOM packages"
        sub="Reusable bill-of-materials templates for any industry — kits, project packages, assemblies."
        actions={
          <>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls"
              hidden
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                const out = await run("import", () => importExcel(file), {
                  success: "Packages imported from Excel",
                  description: "Exact/strong catalogue matches were linked. Open a package and use Match catalogue for the rest.",
                });
                if (out) state.reload();
              }}
            />
            <Button variant="ghost" disabled={Boolean(busy)} onClick={() => fileRef.current?.click()}>
              Import Excel
            </Button>
            <Button
              variant="ghost"
              disabled={Boolean(busy)}
              onClick={async () => {
                const out = await run("seed", () => bom.seedSamples(), { success: "Sample packages added" });
                if (out) state.reload();
              }}
            >
              Add sample templates
            </Button>
            <Button onClick={onNew}>New package</Button>
          </>
        }
      />
      {state.error ? <ErrorBlock error={state.error} onRetry={state.reload} /> : null}
      {!state.data && !state.error ? <LoadingBlock /> : null}
      {state.data && packages.length === 0 ? (
        <EmptyState
          title="No packages yet"
          actions={
            <Button
              onClick={async () => {
                const out = await run("seed", () => bom.seedSamples(), { success: "Sample packages added" });
                if (out) state.reload();
              }}
            >
              Add sample templates
            </Button>
          }
        >
          Create a template once, then generate customer BOMs from it in BOM Builder.
        </EmptyState>
      ) : null}
      {packages.length ? (
        <div className="bos-stack" style={{ gap: 10 }}>
          {packages.map((p) => (
            <Card key={p.id} interactive onClick={() => onOpen(p.id)}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
                <div>
                  <div style={{ fontWeight: 700 }}>{p.name}</div>
                  <div style={{ opacity: 0.7, fontSize: 13, marginTop: 4 }}>
                    {[p.code, p.capacityLabel, `${p.lineCount} line${p.lineCount === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <Badge tone={p.active ? "emerald" : "amber"}>{p.active ? "Active" : "Inactive"}</Badge>
              </div>
            </Card>
          ))}
        </div>
      ) : null}
    </Stack>
  );
}

function PackageEditor({ id, onBack }: { id: string | null; onBack: () => void }) {
  const state = useImsData(() => (id ? bom.package(id).then((r) => r.package) : Promise.resolve(null)), [id]);
  if (id && state.data === null && !state.error) return <LoadingBlock />;
  if (id && state.error) return <ErrorBlock error={state.error} onRetry={state.reload} />;
  return <PackageForm key={id ?? "new"} initial={state.data} onBack={onBack} />;
}

function PackageForm({ initial, onBack }: { initial: BomPackage | null; onBack: () => void }) {
  const { run, busy } = useImsAction();
  const [code, setCode] = useState(initial?.code ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [capacityLabel, setCapacityLabel] = useState(initial?.capacityLabel ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [marginPct, setMarginPct] = useState(String(initial?.defaultMarginPct ?? 0));
  const [taxPct, setTaxPct] = useState(String(initial?.defaultTaxPct ?? 0));
  const [active, setActive] = useState(initial?.active ?? true);
  const [pickFor, setPickFor] = useState<string | null>(null);
  const [lines, setLines] = useState<Array<BomPackageLineInput & { key: string }>>(
    () =>
      initial?.lines?.map((l) => ({
        key: l.id,
        id: l.id,
        section: l.section,
        lineKind: l.lineKind,
        itemId: l.itemId,
        description: l.description,
        makeText: l.makeText ?? "",
        qty: l.qty,
        unit: l.unit,
        scaleByCapacity: l.scaleByCapacity,
        defaultRate: l.defaultRate,
        remarks: l.remarks ?? "",
        active: l.active,
      })) ?? [blankLine("Main Items"), blankLine("Accessories & Services")],
  );

  const sections = useMemo(() => {
    const names: string[] = [];
    for (const l of lines) if (!names.includes(l.section)) names.push(l.section);
    return names.length ? names : ["Main Items"];
  }, [lines]);

  const save = async () => {
    const body = {
      code: code.trim() || null,
      name: name.trim(),
      capacityLabel: capacityLabel.trim() || null,
      description: description.trim() || null,
      defaultMarginPct: Number(marginPct) || 0,
      defaultTaxPct: Number(taxPct) || 0,
      active,
      lines: lines
        .filter((l) => l.description.trim())
        .map((l, i) => ({
          id: l.id,
          section: l.section.trim() || "Main Items",
          sortNo: i,
          lineKind: l.lineKind,
          itemId: l.itemId ?? null,
          description: l.description.trim(),
          makeText: l.makeText?.trim() || null,
          qty: Number(l.qty) || 0,
          unit: l.unit.trim() || "nos",
          scaleByCapacity: Boolean(l.scaleByCapacity),
          defaultRate: Number(l.defaultRate) || 0,
          remarks: l.remarks?.trim() || null,
          active: l.active !== false,
        })),
    };
    if (!body.name) return;
    const out = initial
      ? await run("save", () => bom.savePackage(initial.id, body), { success: "Package saved" })
      : await run("create", () => bom.createPackage(body), { success: "Package created" });
    if (out) onBack();
  };

  const updateLine = (key: string, patch: Partial<BomPackageLineInput>) => {
    setLines((prev) =>
      prev.map((l) => {
        if (l.key !== key) return l;
        const next = { ...l, ...patch };
        if (patch.lineKind === "scaled" && patch.scaleByCapacity === undefined) next.scaleByCapacity = true;
        if (patch.lineKind && patch.lineKind !== "scaled" && patch.scaleByCapacity === undefined && l.lineKind === "scaled") {
          next.scaleByCapacity = false;
        }
        return next;
      }),
    );
  };

  const linkItem = (key: string, item: ImsItem) => {
    updateLine(key, {
      itemId: item.id,
      description: item.name,
      unit: item.unit || "nos",
      defaultRate: item.sellingPrice,
      lineKind: "stock",
      makeText: item.brand || undefined,
    });
    setPickFor(null);
  };

  return (
    <Stack>
      <PageHeader
        title={initial ? "Edit package" : "New package"}
        sub="Templates are industry-neutral. Link stock lines to catalogue items when you have them."
        actions={
          <>
            <Button variant="ghost" onClick={onBack}>
              Back
            </Button>
            {initial ? (
              <>
                <Button
                  variant="ghost"
                  disabled={Boolean(busy)}
                  onClick={async () => {
                    const out = await run("dup", () => bom.duplicatePackage(initial.id), { success: "Package duplicated" });
                    if (out?.package?.id) onBack();
                  }}
                >
                  Duplicate
                </Button>
                <Button
                  variant="ghost"
                  disabled={Boolean(busy)}
                  onClick={async () => {
                    const out = await run(
                      "delete",
                      async () => (await bom.deletePackage(initial.id)) ?? { deactivated: false },
                      {
                        success: "Package removed",
                        description: "If customer BOMs still reference it, the package is deactivated instead of deleted.",
                      },
                    );
                    if (out) onBack();
                  }}
                >
                  Delete
                </Button>
              </>
            ) : null}
            <Button
              variant="ghost"
              disabled={Boolean(busy)}
              onClick={async () => {
                const out = await run(
                  "match",
                  async () => {
                    const catalog = await ims.items({ includeInactive: false }).then((r) => r.items);
                    const { packages: next, summary } = applyCatalogMatches(
                      [{ name, lines: lines.map(({ key: _k, ...rest }) => rest) }],
                      catalog,
                    );
                    const linked = next[0]?.lines ?? [];
                    setLines((prev) =>
                      prev.map((l, i) => {
                        const m = linked[i];
                        if (!m?.itemId || l.itemId) return l;
                        return {
                          ...l,
                          itemId: m.itemId,
                          unit: m.unit || l.unit,
                          defaultRate: l.defaultRate || m.defaultRate || 0,
                          makeText: l.makeText || m.makeText || "",
                        };
                      }),
                    );
                    return summary;
                  },
                  {
                    success: "Catalogue match finished",
                    description: "Exact and strong matches were linked. Ambiguous rows stay for manual pick.",
                  },
                );
                if (out) {
                  /* toast already shown */
                }
              }}
            >
              Match catalogue
            </Button>
            <Button onClick={() => void save()} disabled={Boolean(busy) || !name.trim()}>
              Save package
            </Button>
          </>
        }
      />

      <Card>
        <FormGrid>
          <Field label="Name">
            {({ id }) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Starter kit · Size S" />}
          </Field>
          <Field label="Code">{({ id }) => <Input id={id} value={code} onChange={(e) => setCode(e.target.value)} placeholder="PKG-S" />}</Field>
          <Field label="Capacity / size label">
            {({ id }) => (
              <Input id={id} value={capacityLabel} onChange={(e) => setCapacityLabel(e.target.value)} placeholder="Size S · 3 units · Tier A" />
            )}
          </Field>
          <Field label="Active">
            {({ id }) => (
              <Select id={id} value={active ? "1" : "0"} onChange={(e) => setActive(e.target.value === "1")}>
                <option value="1">Active</option>
                <option value="0">Inactive</option>
              </Select>
            )}
          </Field>
          <Field label="Default margin %">
            {({ id }) => <Input id={id} value={marginPct} onChange={(e) => setMarginPct(e.target.value)} inputMode="decimal" />}
          </Field>
          <Field label="Default tax %">
            {({ id }) => <Input id={id} value={taxPct} onChange={(e) => setTaxPct(e.target.value)} inputMode="decimal" />}
          </Field>
        </FormGrid>
        <div style={{ marginTop: 12 }}>
          <Field label="Description" full>
            {({ id }) => <Textarea id={id} value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />}
          </Field>
        </div>
      </Card>

      <Alert tone="blue" title="Line kinds">
        Stock lines can later post inventory. Service / overhead / capacity-scaled lines stay commercial (no stock movement).
      </Alert>

      {sections.map((section) => (
        <Card key={section}>
          <div className="ims-bom-section-bar">
            <span>{section}</span>
            <Button size="sm" variant="ghost" onClick={() => setLines((prev) => [...prev, blankLine(section)])}>
              Add line
            </Button>
          </div>
          <div className="ims-bom-line-editor" style={{ marginTop: 10 }}>
            {lines
              .filter((l) => l.section === section)
              .map((l) => (
                <div key={l.key}>
                  <div className="ims-bom-line-row">
                    <span style={{ opacity: 0.5, paddingTop: 8 }}>•</span>
                    <Input value={l.description} onChange={(e) => updateLine(l.key, { description: e.target.value })} placeholder="Description" />
                    <Input value={l.makeText ?? ""} onChange={(e) => updateLine(l.key, { makeText: e.target.value })} placeholder="Make / brand" />
                    <Input value={String(l.qty)} onChange={(e) => updateLine(l.key, { qty: Number(e.target.value) || 0 })} placeholder="Qty" />
                    <Input value={l.unit} onChange={(e) => updateLine(l.key, { unit: e.target.value })} placeholder="Unit" />
                    <Select value={l.lineKind} onChange={(e) => updateLine(l.key, { lineKind: e.target.value as BomLineKind })}>
                      {BOM_LINE_KINDS.map((k) => (
                        <option key={k} value={k}>
                          {BOM_LINE_KIND_LABEL[k]}
                        </option>
                      ))}
                    </Select>
                    <Input
                      value={String(l.defaultRate ?? 0)}
                      onChange={(e) => updateLine(l.key, { defaultRate: Number(e.target.value) || 0 })}
                      placeholder="Rate"
                    />
                    <Button size="sm" variant="ghost" onClick={() => setLines((prev) => prev.filter((x) => x.key !== l.key))} aria-label="Remove line">
                      ×
                    </Button>
                  </div>
                  <div style={{ display: "flex", gap: 8, margin: "4px 0 8px 34px", fontSize: 12, flexWrap: "wrap", alignItems: "center" }}>
                    <Button size="sm" variant="ghost" onClick={() => setPickFor(l.key)}>
                      {l.itemId ? "Change item" : "Link catalogue item"}
                    </Button>
                    {l.itemId ? (
                      <Button size="sm" variant="ghost" onClick={() => updateLine(l.key, { itemId: null })}>
                        Unlink
                      </Button>
                    ) : null}
                    <label style={{ display: "inline-flex", alignItems: "center", gap: 6, opacity: 0.85, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={Boolean(l.scaleByCapacity)}
                        onChange={(e) => updateLine(l.key, { scaleByCapacity: e.target.checked })}
                      />
                      Scale with capacity
                    </label>
                  </div>
                </div>
              ))}
          </div>
          <div style={{ marginTop: 10 }}>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                const next = window.prompt("New section name", "Extras");
                if (next?.trim()) setLines((prev) => [...prev, blankLine(next.trim())]);
              }}
            >
              Add section
            </Button>
          </div>
        </Card>
      ))}

      <ItemPickerDialog
        open={Boolean(pickFor)}
        onClose={() => setPickFor(null)}
        title="Link catalogue item"
        onPick={(item) => {
          if (pickFor) linkItem(pickFor, item);
        }}
      />
    </Stack>
  );
}
