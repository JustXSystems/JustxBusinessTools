"use client";

import { useMemo, useState } from "react";
import { Badge, Button, Card, EmptyState, Field, FormGrid, Select } from "@/components/bos";
import { bom, type BomDiffEntry, type BomPackage } from "@/lib/ims/bom";
import { ErrorBlock, LoadingBlock, PageHeader, RequirePerm, Stack, useImsAction, useImsData } from "../core";

export default function BomCompareScreen() {
  return (
    <RequirePerm perm="bom" what="BOM compare">
      <CompareBody />
    </RequirePerm>
  );
}

function CompareBody() {
  const { run, busy } = useImsAction();
  const packages = useImsData(() => bom.packages({ active: true, limit: 200 }), []);
  const docs = useImsData(() => bom.docs({ limit: 100 }), []);
  const [mode, setMode] = useState<"package" | "doc">("package");
  const [leftId, setLeftId] = useState("");
  const [rightId, setRightId] = useState("");
  const [diff, setDiff] = useState<BomDiffEntry[] | null>(null);

  const options = useMemo(() => {
    if (mode === "package") {
      return (packages.data?.packages ?? []).map((p: BomPackage) => ({ id: p.id, label: `${p.code ? `${p.code} · ` : ""}${p.name}` }));
    }
    return (docs.data?.docs ?? []).map((d) => ({ id: d.id, label: `${d.docNo} · ${d.customerName || "No customer"}` }));
  }, [mode, packages.data, docs.data]);

  if ((!packages.data && !packages.error) || (!docs.data && !docs.error)) return <LoadingBlock />;
  if (packages.error) return <ErrorBlock error={packages.error} onRetry={packages.reload} />;
  if (docs.error) return <ErrorBlock error={docs.error} onRetry={docs.reload} />;

  const runDiff = async () => {
    if (!leftId || !rightId) return;
    const body =
      mode === "package"
        ? { leftPackageId: leftId, rightPackageId: rightId }
        : { leftDocId: leftId, rightDocId: rightId };
    const out = await run("diff", () => bom.diff(body), { success: "Comparison ready", refresh: false });
    if (out) setDiff(out.diff);
  };

  const changed = (diff ?? []).filter((d) => d.kind !== "same");

  return (
    <Stack>
      <PageHeader
        title="Compare"
        sub="Side-by-side line diff for packages or customer BOMs (qty, rate, unit, section, description)."
        actions={
          <Button onClick={() => void runDiff()} disabled={Boolean(busy) || !leftId || !rightId || leftId === rightId}>
            Compare
          </Button>
        }
      />
      <Card>
        <FormGrid>
          <Field label="Compare">
            {({ id }) => (
              <Select
                id={id}
                value={mode}
                onChange={(e) => {
                  setMode(e.target.value as "package" | "doc");
                  setLeftId("");
                  setRightId("");
                  setDiff(null);
                }}
              >
                <option value="package">Packages</option>
                <option value="doc">Customer BOMs</option>
              </Select>
            )}
          </Field>
          <Field label="Left">
            {({ id }) => (
              <Select id={id} value={leftId} onChange={(e) => setLeftId(e.target.value)}>
                <option value="">Select…</option>
                {options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Right">
            {({ id }) => (
              <Select id={id} value={rightId} onChange={(e) => setRightId(e.target.value)}>
                <option value="">Select…</option>
                {options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </FormGrid>
      </Card>

      {!diff ? (
        <EmptyState title="Pick left and right, then Compare" />
      ) : !changed.length ? (
        <EmptyState title="No differences" />
      ) : (
        <Card>
          <div style={{ display: "grid", gap: 10 }}>
            {changed.map((entry, i) => {
              if (entry.kind === "added") {
                return (
                  <DiffRow key={`a-${i}`} tone="emerald" label="Added" left="—" right={fmt(entry.right)} />
                );
              }
              if (entry.kind === "removed") {
                return (
                  <DiffRow key={`r-${i}`} tone="coral" label="Removed" left={fmt(entry.left)} right="—" />
                );
              }
              return (
                <DiffRow
                  key={`c-${i}`}
                  tone="amber"
                  label={`Changed (${entry.fields.join(", ")})`}
                  left={fmt(entry.left)}
                  right={fmt(entry.right)}
                />
              );
            })}
          </div>
        </Card>
      )}
    </Stack>
  );
}

function fmt(line: { section: string; description: string; qty: number; unit: string; rate: number }) {
  return `${line.section} · ${line.description} · ${line.qty} ${line.unit} @ ${line.rate}`;
}

function DiffRow({
  tone,
  label,
  left,
  right,
}: {
  tone: "emerald" | "coral" | "amber";
  label: string;
  left: string;
  right: string;
}) {
  return (
    <div style={{ border: "1px solid var(--bos-border, #e2e8f0)", borderRadius: 8, padding: 12 }}>
      <Badge tone={tone}>{label}</Badge>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 8, fontSize: 13 }}>
        <div>
          <div style={{ opacity: 0.6, marginBottom: 4 }}>Left</div>
          <div>{left}</div>
        </div>
        <div>
          <div style={{ opacity: 0.6, marginBottom: 4 }}>Right</div>
          <div>{right}</div>
        </div>
      </div>
    </div>
  );
}
