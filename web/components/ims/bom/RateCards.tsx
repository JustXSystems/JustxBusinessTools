"use client";

import { useState } from "react";
import { Badge, Button, Card, EmptyState, Field, FormGrid, Input, Select, Textarea } from "@/components/bos";
import { bom, type BomRateCard, type BomRateCardLine } from "@/lib/ims/bom";
import type { ImsItem } from "@/lib/ims/api";
import { ErrorBlock, LoadingBlock, PageHeader, RequirePerm, Stack, useImsAction, useImsData } from "../core";
import { ItemPickerDialog } from "../shared/pickers";

type View = { mode: "list" } | { mode: "edit"; id: string | null };

type EditorLine = BomRateCardLine & { key: string };

const blankLine = (): EditorLine => ({
  key: Math.random().toString(36).slice(2),
  description: "",
  sku: "",
  unit: "nos",
  rate: 0,
  costRate: 0,
  active: true,
});

export default function BomRateCardsScreen() {
  const [view, setView] = useState<View>({ mode: "list" });
  return (
    <RequirePerm perm="bom" what="BOM rate cards">
      {view.mode === "edit" ? (
        <RateCardEditor id={view.id} onBack={() => setView({ mode: "list" })} />
      ) : (
        <RateCardList onNew={() => setView({ mode: "edit", id: null })} onOpen={(id) => setView({ mode: "edit", id })} />
      )}
    </RequirePerm>
  );
}

function RateCardList({ onNew, onOpen }: { onNew: () => void; onOpen: (id: string) => void }) {
  const state = useImsData(() => bom.rateCards(), []);
  const cards = state.data?.rateCards ?? [];
  if (!state.data && !state.error) return <LoadingBlock />;
  if (state.error) return <ErrorBlock error={state.error} onRetry={state.reload} />;
  return (
    <Stack>
      <PageHeader
        title="Rate Cards"
        sub="Price books for kit lines. Apply a card to a draft customer BOM to set sell rates."
        actions={<Button onClick={onNew}>New rate card</Button>}
      />
      {!cards.length ? (
        <EmptyState title="No rate cards yet" actions={<Button onClick={onNew}>Create first card</Button>} />
      ) : (
        <Card>
          <div style={{ display: "grid", gap: 8 }}>
            {cards.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => onOpen(c.id)}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  alignItems: "center",
                  textAlign: "left",
                  padding: "12px 14px",
                  border: "1px solid var(--bos-border, #e2e8f0)",
                  background: "var(--bos-surface, #fff)",
                  borderRadius: 8,
                  cursor: "pointer",
                }}
              >
                <span>
                  <strong>{c.name}</strong>
                  <span style={{ opacity: 0.65, marginLeft: 8 }}>{c.code || "—"}</span>
                  <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
                    {c.lineCount ?? 0} lines
                    {c.validFrom || c.validTo ? ` · ${c.validFrom || "…"} → ${c.validTo || "…"}` : ""}
                  </div>
                </span>
                <Badge tone={c.active ? "emerald" : "amber"}>{c.active ? "Active" : "Inactive"}</Badge>
              </button>
            ))}
          </div>
        </Card>
      )}
    </Stack>
  );
}

function RateCardEditor({ id, onBack }: { id: string | null; onBack: () => void }) {
  const state = useImsData(() => (id ? bom.rateCard(id) : Promise.resolve({ rateCard: null as BomRateCard | null })), [id]);
  if (id && !state.data && !state.error) return <LoadingBlock />;
  if (id && state.error) return <ErrorBlock error={state.error} onRetry={state.reload} />;
  return <RateCardForm key={id ?? "new"} initial={state.data?.rateCard ?? null} onBack={onBack} />;
}

function RateCardForm({ initial, onBack }: { initial: BomRateCard | null; onBack: () => void }) {
  const { run, busy } = useImsAction();
  const [name, setName] = useState(initial?.name ?? "");
  const [code, setCode] = useState(initial?.code ?? "");
  const [validFrom, setValidFrom] = useState(initial?.validFrom ?? "");
  const [validTo, setValidTo] = useState(initial?.validTo ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [active, setActive] = useState(initial?.active ?? true);
  const [pickFor, setPickFor] = useState<string | null>(null);
  const [lines, setLines] = useState<EditorLine[]>(
    () =>
      initial?.lines?.map((l) => ({
        key: l.id ?? Math.random().toString(36).slice(2),
        id: l.id,
        itemId: l.itemId,
        sku: l.sku ?? "",
        description: l.description ?? "",
        unit: l.unit || "nos",
        rate: l.rate,
        costRate: l.costRate ?? 0,
        active: l.active !== false,
      })) ?? [blankLine()],
  );

  const updateLine = (key: string, patch: Partial<EditorLine>) => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };

  const save = async () => {
    if (!name.trim()) return;
    const body = {
      code: code.trim() || null,
      name: name.trim(),
      currency: "INR",
      validFrom: validFrom || null,
      validTo: validTo || null,
      active,
      notes: notes.trim() || null,
      lines: lines
        .filter((l) => l.description?.trim() || l.sku?.trim() || l.itemId)
        .map((l, i) => ({
          itemId: l.itemId ?? null,
          sku: l.sku?.trim() || null,
          description: l.description?.trim() || null,
          unit: l.unit || "nos",
          rate: Number(l.rate) || 0,
          costRate: l.costRate == null ? null : Number(l.costRate) || 0,
          sortNo: i,
          active: l.active !== false,
        })),
    };
    const out = initial
      ? await run("save-rate", () => bom.saveRateCard(initial.id, body), { success: "Rate card saved" })
      : await run("create-rate", () => bom.createRateCard(body), { success: "Rate card created" });
    if (out) onBack();
  };

  return (
    <Stack>
      <PageHeader
        title={initial ? "Edit rate card" : "New rate card"}
        sub="Match by catalogue item or SKU when applying to a draft BOM."
        actions={
          <>
            <Button variant="ghost" onClick={onBack}>
              Back
            </Button>
            {initial ? (
              <Button
                variant="ghost"
                disabled={Boolean(busy)}
                onClick={async () => {
                  if (!window.confirm("Deactivate this rate card?")) return;
                  const out = await run("deactivate", () => bom.deleteRateCard(initial.id), { success: "Rate card deactivated" });
                  if (out) onBack();
                }}
              >
                Deactivate
              </Button>
            ) : null}
            <Button onClick={() => void save()} disabled={Boolean(busy) || !name.trim()}>
              Save
            </Button>
          </>
        }
      />
      <Card>
        <FormGrid>
          <Field label="Name">{({ id }) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
          <Field label="Code">{({ id }) => <Input id={id} value={code} onChange={(e) => setCode(e.target.value)} />}</Field>
          <Field label="Valid from">{({ id }) => <Input id={id} type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />}</Field>
          <Field label="Valid to">{({ id }) => <Input id={id} type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} />}</Field>
          <Field label="Active">
            {({ id }) => (
              <Select id={id} value={active ? "1" : "0"} onChange={(e) => setActive(e.target.value === "1")}>
                <option value="1">Active</option>
                <option value="0">Inactive</option>
              </Select>
            )}
          </Field>
        </FormGrid>
        <div style={{ marginTop: 12 }}>
          <Field label="Notes" full>
            {({ id }) => <Textarea id={id} value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />}
          </Field>
        </div>
      </Card>
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
          <strong>Lines</strong>
          <Button size="sm" variant="ghost" onClick={() => setLines((prev) => [...prev, blankLine()])}>
            Add line
          </Button>
        </div>
        <div style={{ display: "grid", gap: 10 }}>
          {lines.map((l) => (
            <div key={l.key} style={{ display: "grid", gap: 6, borderTop: "1px solid var(--bos-border, #e2e8f0)", paddingTop: 10 }}>
              <div className="ims-bom-line-row">
                <Input value={l.description ?? ""} onChange={(e) => updateLine(l.key, { description: e.target.value })} placeholder="Description" />
                <Input value={l.sku ?? ""} onChange={(e) => updateLine(l.key, { sku: e.target.value })} placeholder="SKU" />
                <Input value={l.unit ?? "nos"} onChange={(e) => updateLine(l.key, { unit: e.target.value })} placeholder="Unit" />
                <Input value={String(l.rate ?? 0)} onChange={(e) => updateLine(l.key, { rate: Number(e.target.value) || 0 })} placeholder="Sell rate" />
                <Input
                  value={String(l.costRate ?? 0)}
                  onChange={(e) => updateLine(l.key, { costRate: Number(e.target.value) || 0 })}
                  placeholder="Cost"
                />
                <Button size="sm" variant="ghost" onClick={() => setLines((prev) => prev.filter((x) => x.key !== l.key))}>
                  ×
                </Button>
              </div>
              <div className="ims-bom-line-meta">
                <Button size="sm" variant="ghost" onClick={() => setPickFor(l.key)}>
                  {l.itemId ? "Change item" : "Pick inventory item"}
                </Button>
                {l.itemId ? <Badge tone="emerald">Linked</Badge> : null}
              </div>
            </div>
          ))}
        </div>
      </Card>
      <ItemPickerDialog
        open={Boolean(pickFor)}
        onClose={() => setPickFor(null)}
        title="Link inventory item"
        onPick={(item: ImsItem) => {
          if (!pickFor) return;
          updateLine(pickFor, {
            itemId: item.id,
            description: item.name,
            sku: item.sku || "",
            unit: item.unit || "nos",
            rate: item.sellingPrice,
            costRate: item.purchasePrice ?? 0,
          });
          setPickFor(null);
        }}
      />
    </Stack>
  );
}
