"use client";

import "./bom.css";
import { Fragment, useMemo, useRef, useState } from "react";
import { Alert, Badge, Button, Card, EmptyState, Field, FormGrid, Input, Select, Textarea, useToast } from "@/components/bos";
import {
  BOM_LINE_KIND_LABEL,
  BOM_LINE_KINDS,
  bom,
  type BomLineKind,
  type BomPackage,
  type BomPackageLineInput,
} from "@/lib/ims/bom";
import { type ImsItem } from "@/lib/ims/api";
import { formatCatalogEnsureSummary, parseBomPackageWorkbook } from "@/lib/ims/bom-excel";
import { ensureBomPackageCatalog, ensureStockLinesForSave } from "@/lib/ims/ensure-catalog";
import { bomIndustryPackMeta, missingBomPackSections, normalizeBomIndustryPack } from "@/lib/ims/bom-paper";
import { useFeatureSwitch } from "@/components/config/ConfigProvider";
import { ErrorBlock, LoadingBlock, PageHeader, RequirePerm, Stack, useIms, useImsAction, useImsData, useOpenIntent } from "../core";
import { ItemPickerDialog } from "../shared/pickers";

const SAMPLE_TEMPLATES_SWITCH = "ims.bom.sample_templates";

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
  qtyFormula: "",
  childPackageId: null,
  optionalFlag: false,
  optionKey: "",
  alternateItemIds: [],
  serviceSpare: false,
  scrapPct: 0,
});

export default function BomPackagesScreen() {
  const openId = useOpenIntent("bomPackages");
  const [view, setView] = useState<View>(() => (openId ? { mode: "edit", id: openId } : { mode: "list" }));
  return (
    <RequirePerm perm="bomPackages" what="BOM packages">
      {view.mode === "edit" ? (
        <PackageEditor
          id={view.id}
          onBack={() => setView({ mode: "list" })}
          onOpen={(id) => setView({ mode: "edit", id })}
        />
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
  const sampleTemplatesOn = useFeatureSwitch(SAMPLE_TEMPLATES_SWITCH);

  const importExcel = async (file: File) => {
    const parsed = await parseBomPackageWorkbook(file);
    if (!parsed.length) throw new Error("No package sheets found in that workbook");
    const { packages: ensured, summary } = await ensureBomPackageCatalog(parsed, {
      source: "BOM Excel import",
    });
    let created = 0;
    for (const pkg of ensured) {
      await bom.createPackage(pkg);
      created += 1;
    }
    return { created, summary };
  };

  return (
    <Stack>
      <PageHeader
        title="Packages"
        sub="Reusable materials templates. Excel import syncs every stock line into Inventory Items (link or create)."
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
                const out = await run("import", async () => {
                  const result = await importExcel(file);
                  return result;
                });
                if (out) {
                  const { created, summary } = out;
                  await run(
                    "import-summary",
                    async () => true,
                    {
                      success: `Imported ${created} package${created === 1 ? "" : "s"}`,
                      description: formatCatalogEnsureSummary(summary),
                      tone: summary.ambiguous || summary.unmatched ? "amber" : "emerald",
                      refresh: false,
                    },
                  );
                  state.reload();
                }
              }}
            />
            <Button variant="ghost" disabled={Boolean(busy)} onClick={() => fileRef.current?.click()}>
              Import Excel
            </Button>
            {sampleTemplatesOn ? (
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
            ) : null}
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
            <>
              <Button onClick={onNew}>New package</Button>
              {sampleTemplatesOn ? (
                <Button
                  variant="ghost"
                  onClick={async () => {
                    const out = await run("seed", () => bom.seedSamples(), { success: "Sample packages added" });
                    if (out) state.reload();
                  }}
                >
                  Add sample templates
                </Button>
              ) : null}
            </>
          }
        >
          Create a template once, or import Excel — then generate customer BOMs from Create / Maintain. Sample seed adds general, solar, EPC, manufacturing, services and procurement packs.
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

function PackageEditor({ id, onBack, onOpen }: { id: string | null; onBack: () => void; onOpen: (id: string) => void }) {
  const state = useImsData(() => (id ? bom.package(id).then((r) => r.package) : Promise.resolve(null)), [id]);
  if (id && state.data === null && !state.error) return <LoadingBlock />;
  if (id && state.error) return <ErrorBlock error={state.error} onRetry={state.reload} />;
  return <PackageForm key={id ?? "new"} initial={state.data} onBack={onBack} onOpen={onOpen} />;
}

function PackageForm({ initial, onBack, onOpen }: { initial: BomPackage | null; onBack: () => void; onOpen: (id: string) => void }) {
  const { session } = useIms();
  const { run, busy } = useImsAction();
  const toast = useToast();
  const packId = normalizeBomIndustryPack(session.settings.bomIndustryPack);
  const packMeta = bomIndustryPackMeta(packId);
  const [code, setCode] = useState(initial?.code ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [capacityLabel, setCapacityLabel] = useState(initial?.capacityLabel ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [marginPct, setMarginPct] = useState(String(initial?.defaultMarginPct ?? 0));
  const [taxPct, setTaxPct] = useState(String(initial?.defaultTaxPct ?? 0));
  const [active, setActive] = useState(initial?.active ?? true);
  const [pickFor, setPickFor] = useState<string | null>(null);
  const [altPickFor, setAltPickFor] = useState<string | null>(null);
  const packageChoices = useImsData(() => bom.packages({ active: true, limit: 200 }), []);
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
        qtyFormula: l.qtyFormula ?? "",
        childPackageId: l.childPackageId ?? null,
        optionalFlag: Boolean(l.optionalFlag),
        optionKey: l.optionKey ?? "",
        alternateItemIds: l.alternateItemIds ?? [],
        serviceSpare: Boolean(l.serviceSpare),
        scrapPct: l.scrapPct ?? 0,
        costRate: l.costRate ?? null,
      })) ?? packMeta.defaultSections.map((section) => blankLine(section)),
  );

  const sections = useMemo(() => {
    const names: string[] = [];
    for (const l of lines) {
      const s = l.section.trim() || "Main Items";
      if (!names.some((n) => n.toLowerCase() === s.toLowerCase())) names.push(s);
    }
    return names;
  }, [lines]);

  const packSectionGaps = useMemo(() => missingBomPackSections(sections, packId), [sections, packId]);

  const save = async () => {
    if (!name.trim()) return;
    const ensured = await run(
      "ensure-catalog",
      () => ensureStockLinesForSave(lines.filter((l) => l.description.trim()), { source: "BOM package save" }),
      { refresh: false },
    );
    const synced = ensured?.lines ?? lines.filter((l) => l.description.trim());
    if (ensured?.lines) setLines((prev) => prev.map((l) => synced.find((s) => s.key === l.key) ?? l));
    const body = {
      code: code.trim() || null,
      name: name.trim(),
      capacityLabel: capacityLabel.trim() || null,
      description: description.trim() || null,
      defaultMarginPct: Number(marginPct) || 0,
      defaultTaxPct: Number(taxPct) || 0,
      active,
      lines: synced.map((l, i) => ({
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
        qtyFormula: l.qtyFormula?.trim() || null,
        childPackageId: l.childPackageId || null,
        optionalFlag: Boolean(l.optionalFlag),
        optionKey: l.optionKey?.trim() || null,
        alternateItemIds: (l.alternateItemIds ?? []).filter(Boolean),
        serviceSpare: Boolean(l.serviceSpare),
        scrapPct: Number(l.scrapPct) || 0,
        costRate: l.costRate == null ? null : Number(l.costRate) || 0,
      })),
    };
    const out = initial
      ? await run("save", () => bom.savePackage(initial.id, body), {
          success: "Package saved",
          description:
            ensured?.summary && (ensured.summary.created || ensured.summary.matched)
              ? formatCatalogEnsureSummary(ensured.summary)
              : undefined,
        })
      : await run("create", () => bom.createPackage(body), {
          success: "Package created",
          description:
            ensured?.summary && (ensured.summary.created || ensured.summary.matched)
              ? formatCatalogEnsureSummary(ensured.summary)
              : undefined,
        });
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
        sub="Stock lines sync to Inventory Items — existing catalogue rows are linked; missing ones are created on sync or save."
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
                    if (out?.package?.id) onOpen(out.package.id);
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
                const out = await run("sync-inventory", async () => {
                  const { packages: next, summary } = await ensureBomPackageCatalog(
                    [{ name, lines: lines.map(({ key: _k, ...rest }) => rest) }],
                    { source: "BOM package sync" },
                  );
                  const linked = next[0]?.lines ?? [];
                  setLines((prev) =>
                    prev.map((l, i) => {
                      const m = linked[i];
                      if (!m?.itemId) return l;
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
                });
                if (out) {
                  await run(
                    "sync-summary",
                    async () => true,
                    {
                      success: "Inventory sync finished",
                      description: formatCatalogEnsureSummary(out),
                      tone: out.ambiguous || out.unmatched ? "amber" : "emerald",
                      refresh: false,
                    },
                  );
                }
              }}
            >
              Sync inventory
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

      <Alert tone="blue" title="Inventory-backed stock lines">
        Excel / line map → Inventory: Description → name · Vendor/Make → brand · Unit → unit · Price/unit → selling price. Other catalogue fields (SKU, barcode, category, HSN, GST, estimated cost) are invented when an item is created. Service, overhead and capacity-scaled lines stay commercial only.
      </Alert>

      {!sections.length ? (
        <Card>
          <EmptyState icon="list" title="No sections yet">
            {`Add the default sections for ${packMeta.label}, or create a custom section.`}
          </EmptyState>
        </Card>
      ) : null}

      {sections.map((section) => (
        <Card key={section}>
          <div className="ims-bom-section-bar">
            <span>{section}</span>
            <Button size="sm" variant="ghost" onClick={() => setLines((prev) => [...prev, blankLine(section)])}>
              Add line
            </Button>
          </div>
          <div className="ims-bom-line-editor" style={{ marginTop: 10 }}>
            {(() => {
              const sectionLines = lines.filter((l) => (l.section.trim() || "Main Items") === section);
              if (!sectionLines.length) {
                return <p className="ims-line-editor-empty">No lines in this section yet.</p>;
              }
              return (
                <div className="ims-bom-line-frame">
                  <table className="ims-bom-line-table" aria-label={`${section} lines`}>
                    <thead>
                      <tr>
                        <th className="is-idx" scope="col">
                          #
                        </th>
                        <th className="is-desc" scope="col">
                          Description
                        </th>
                        <th className="is-make" scope="col">
                          Make
                        </th>
                        <th className="is-qty" scope="col">
                          Qty
                        </th>
                        <th className="is-unit" scope="col">
                          Unit
                        </th>
                        <th className="is-kind" scope="col">
                          Kind
                        </th>
                        <th className="is-rate" scope="col">
                          Rate
                        </th>
                        <th className="is-act" scope="col">
                          <span className="bos-sr-only">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {sectionLines.map((l, i) => (
                        <Fragment key={l.key}>
                          <tr className="is-main">
                            <td className="is-idx">{i + 1}</td>
                            <td className="is-desc" data-label="Description">
                              <Input
                                value={l.description}
                                onChange={(e) => updateLine(l.key, { description: e.target.value })}
                                aria-label={`Line ${i + 1} description`}
                              />
                            </td>
                            <td className="is-make" data-label="Make">
                              <Input
                                value={l.makeText ?? ""}
                                onChange={(e) => updateLine(l.key, { makeText: e.target.value })}
                                aria-label={`Line ${i + 1} make`}
                              />
                            </td>
                            <td className="is-qty" data-label="Qty">
                              <Input
                                value={String(l.qty)}
                                onChange={(e) => updateLine(l.key, { qty: Number(e.target.value) || 0 })}
                                inputMode="decimal"
                                aria-label={`Line ${i + 1} quantity`}
                              />
                            </td>
                            <td className="is-unit" data-label="Unit">
                              <Input value={l.unit} onChange={(e) => updateLine(l.key, { unit: e.target.value })} aria-label={`Line ${i + 1} unit`} />
                            </td>
                            <td className="is-kind" data-label="Kind">
                              <Select value={l.lineKind} onChange={(e) => updateLine(l.key, { lineKind: e.target.value as BomLineKind })} aria-label={`Line ${i + 1} kind`}>
                                {BOM_LINE_KINDS.map((k) => (
                                  <option key={k} value={k}>
                                    {BOM_LINE_KIND_LABEL[k]}
                                  </option>
                                ))}
                              </Select>
                            </td>
                            <td className="is-rate" data-label="Rate">
                              <Input
                                value={String(l.defaultRate ?? 0)}
                                onChange={(e) => updateLine(l.key, { defaultRate: Number(e.target.value) || 0 })}
                                inputMode="decimal"
                                aria-label={`Line ${i + 1} rate`}
                              />
                            </td>
                            <td className="is-act">
                              <Button size="sm" variant="ghost" onClick={() => setLines((prev) => prev.filter((x) => x.key !== l.key))} aria-label={`Remove line ${i + 1}`}>
                                ×
                              </Button>
                            </td>
                          </tr>
                          <tr className="is-meta">
                            <td colSpan={8}>
                              <div className="ims-bom-line-meta">
                                <Button size="sm" variant="ghost" onClick={() => setPickFor(l.key)}>
                                  {l.itemId ? "Change item" : "Pick inventory item"}
                                </Button>
                                {l.itemId ? (
                                  <Button size="sm" variant="ghost" onClick={() => updateLine(l.key, { itemId: null })}>
                                    Unlink
                                  </Button>
                                ) : null}
                                {l.itemId ? (
                                  <Badge tone="emerald">In inventory</Badge>
                                ) : l.lineKind === "stock" && l.description.trim() ? (
                                  <Badge tone="amber">Will sync on save</Badge>
                                ) : null}
                                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, opacity: 0.85, cursor: "pointer" }}>
                                  <input
                                    type="checkbox"
                                    checked={Boolean(l.scaleByCapacity)}
                                    onChange={(e) => updateLine(l.key, { scaleByCapacity: e.target.checked })}
                                  />
                                  Scale with capacity
                                </label>
                                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, opacity: 0.85, cursor: "pointer" }}>
                                  <input
                                    type="checkbox"
                                    checked={Boolean(l.serviceSpare)}
                                    onChange={(e) => updateLine(l.key, { serviceSpare: e.target.checked })}
                                  />
                                  Service / spare
                                </label>
                                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, opacity: 0.85, cursor: "pointer" }}>
                                  <input
                                    type="checkbox"
                                    checked={Boolean(l.optionalFlag)}
                                    onChange={(e) => updateLine(l.key, { optionalFlag: e.target.checked })}
                                  />
                                  Optional
                                </label>
                              </div>
                              <div className="ims-bom-line-meta" style={{ marginTop: 6 }}>
                                <Input
                                  value={l.qtyFormula ?? ""}
                                  onChange={(e) => updateLine(l.key, { qtyFormula: e.target.value })}
                                  placeholder="Qty formula e.g. ceil(capacityKw*1000/panelWp)"
                                  style={{ minWidth: 220, flex: 1 }}
                                  aria-label={`Line ${i + 1} qty formula`}
                                />
                                <Input
                                  value={l.optionKey ?? ""}
                                  onChange={(e) => updateLine(l.key, { optionKey: e.target.value })}
                                  placeholder="Option key"
                                  style={{ width: 120 }}
                                  aria-label={`Line ${i + 1} option key`}
                                />
                                <div style={{ minWidth: 160 }}>
                                  <Select
                                    value={l.childPackageId ?? ""}
                                    onChange={(e) => updateLine(l.key, { childPackageId: e.target.value || null })}
                                    aria-label={`Line ${i + 1} nested package`}
                                  >
                                    <option value="">No nested package</option>
                                    {(packageChoices.data?.packages ?? [])
                                      .filter((p) => p.id !== initial?.id)
                                      .map((p) => (
                                        <option key={p.id} value={p.id}>
                                          {p.code ? `${p.code} · ` : ""}
                                          {p.name}
                                        </option>
                                      ))}
                                  </Select>
                                </div>
                                <Button size="sm" variant="ghost" onClick={() => setAltPickFor(l.key)}>
                                  Add alternate
                                </Button>
                                {(l.alternateItemIds ?? []).length ? (
                                  <Badge tone="blue">{(l.alternateItemIds ?? []).length} alternate(s)</Badge>
                                ) : null}
                                {(l.alternateItemIds ?? []).length ? (
                                  <Button size="sm" variant="ghost" onClick={() => updateLine(l.key, { alternateItemIds: [] })}>
                                    Clear alts
                                  </Button>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })()}
          </div>
        </Card>
      ))}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            const next = window.prompt("New section name", "Extras");
            const name = next?.trim();
            if (!name) return;
            if (sections.some((s) => s.toLowerCase() === name.toLowerCase())) {
              toast.show({ tone: "amber", title: "Section already exists", description: `“${name}” is already on this package.` });
              return;
            }
            setLines((prev) => [...prev, blankLine(name)]);
          }}
        >
          Add section
        </Button>
        <Button
          size="sm"
          variant={packSectionGaps.length ? "primary" : "ghost"}
          disabled={!packSectionGaps.length}
          title={
            packSectionGaps.length
              ? `Add missing sections for ${packMeta.label}: ${packSectionGaps.join(", ")}`
              : `All default sections for ${packMeta.label} are already on this package`
          }
          onClick={() => {
            const missing = missingBomPackSections(sections, packId);
            if (!missing.length) {
              toast.show({
                tone: "amber",
                title: "Nothing to add",
                description: `All default sections for ${packMeta.label} are already here.`,
              });
              return;
            }
            setLines((prev) => [...prev, ...missing.map((section) => blankLine(section))]);
            toast.show({
              tone: "emerald",
              title: missing.length === 1 ? "Section added" : "Sections added",
              description: missing.join(" · "),
            });
          }}
        >
          {packSectionGaps.length ? `Add pack sections (${packSectionGaps.length})` : "Add pack sections"}
        </Button>
      </div>

      <ItemPickerDialog
        open={Boolean(pickFor)}
        onClose={() => setPickFor(null)}
        title="Link inventory item"
        allowCreate
        createHint={pickFor ? lines.find((l) => l.key === pickFor)?.description : undefined}
        onPick={(item) => {
          if (pickFor) linkItem(pickFor, item);
        }}
      />
      <ItemPickerDialog
        open={Boolean(altPickFor)}
        onClose={() => setAltPickFor(null)}
        title="Add alternate item"
        onPick={(item) => {
          if (!altPickFor) return;
          const line = lines.find((l) => l.key === altPickFor);
          const next = [...new Set([...(line?.alternateItemIds ?? []), item.id])];
          updateLine(altPickFor, { alternateItemIds: next });
          setAltPickFor(null);
        }}
      />
    </Stack>
  );
}
