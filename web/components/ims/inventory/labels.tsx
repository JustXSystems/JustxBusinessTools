"use client";

import "./inventory-a.css";

import QRCode from "qrcode";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Alert, Button, Card, Field, FormGrid, Input, Segmented, Switch } from "@/components/bos";
import type { ImsItem } from "@/lib/ims/api";
import { inr } from "@/lib/ims/format";
import { ean13Modules, isEan13, scanCodeOf } from "@/lib/ims/inventory-a";
import { PageHeader, Stack, useIms, usePrint } from "../core";

/** EAN-13 as SVG: 95 modules plus quiet zones, guard bars taller, digits underneath. */
export function Ean13Svg({ code, label = true }: { code: string; label?: boolean }) {
  const bits = ean13Modules(code);
  const quiet = 9;
  const width = 95 + quiet * 2;
  const barH = 44;
  const guard = new Set<number>([0, 1, 2, 45, 46, 47, 48, 49, 92, 93, 94]);
  const bars: Array<{ x: number; w: number; tall: boolean }> = [];
  for (let i = 0; i < bits.length; i++) {
    if (bits[i] !== "1") continue;
    const last = bars[bars.length - 1];
    if (last && last.x + last.w === quiet + i && last.tall === guard.has(i)) last.w += 1;
    else bars.push({ x: quiet + i, w: 1, tall: guard.has(i) });
  }
  return (
    <svg className="ims-label-ean" viewBox={`0 0 ${width} ${barH + (label ? 12 : 6)}`} role="img" aria-label={`Barcode ${code}`} shapeRendering="crispEdges">
      <rect x={0} y={0} width={width} height={barH + 12} fill="#fff" />
      {bars.map((b) => (
        <rect key={b.x} x={b.x} y={0} width={b.w} height={b.tall && label ? barH + 6 : barH} fill="#111" />
      ))}
      {label ? (
        <>
          <text x={quiet - 2} y={barH + 10} textAnchor="end">
            {code[0]}
          </text>
          <text x={quiet + 3 + 21} y={barH + 10} textAnchor="middle" letterSpacing="1.5">
            {code.slice(1, 7)}
          </text>
          <text x={quiet + 50 + 21} y={barH + 10} textAnchor="middle" letterSpacing="1.5">
            {code.slice(7)}
          </text>
        </>
      ) : null}
    </svg>
  );
}

export type LabelOptions = {
  code: "qr" | "barcode" | "both";
  price: "selling" | "mrp" | "none";
  cols: "2" | "3" | "4";
  copies: number;
  showSku: boolean;
  showBusiness: boolean;
};

const DEFAULT_OPTIONS: LabelOptions = { code: "both", price: "selling", cols: "3", copies: 1, showSku: true, showBusiness: false };

function useQrUrls(codes: ReadonlyArray<string>, enabled: boolean): Map<string, string> {
  const [urls, setUrls] = useState<Map<string, string>>(() => new Map());
  const key = codes.join("\u0001");
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const unique = [...new Set(key.split("\u0001"))].filter(Boolean);
    Promise.all(unique.map(async (c) => [c, await QRCode.toDataURL(c, { margin: 1, width: 192, errorCorrectionLevel: "M" })] as const)).then(
      (pairs) => alive && setUrls(new Map(pairs)),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [key, enabled]);
  return urls;
}

/** Printable sheet of item labels inside `.bos-inv-paper` (what `usePrint` prints). */
export function LabelSheet({ items, options, businessName }: { items: ReadonlyArray<ImsItem>; options: LabelOptions; businessName: string }) {
  const codes = useMemo(() => items.map(scanCodeOf), [items]);
  const urls = useQrUrls(codes, options.code !== "barcode" || items.some((i) => !isEan13(i.barcode)));
  const copies = Math.max(1, Math.min(50, Math.round(options.copies) || 1));
  const labels = items.flatMap((item) => Array.from({ length: copies }, (_, n) => ({ item, n })));
  const qrSize = options.cols === "4" ? 64 : options.cols === "3" ? 76 : 92;

  return (
    <article className="bos-inv-paper ims-label-paper" aria-label="Label sheet preview">
      <div className="ims-labels" style={{ "--ims-label-cols": options.cols } as CSSProperties}>
        {labels.map(({ item, n }) => {
          const code = scanCodeOf(item);
          const ean = isEan13(item.barcode) ? item.barcode : null;
          const showEan = Boolean(ean) && options.code !== "qr";
          const showQr = options.code !== "barcode" || !ean;
          const price = options.price === "mrp" ? item.mrp : options.price === "selling" ? item.sellingPrice : null;
          const stacked = showEan && !showQr;
          return (
            <div key={`${item.id}:${n}`} className={`ims-label${stacked ? " is-stacked" : ""}`}>
              {showQr ? (
                urls.get(code) ? (
                  // eslint-disable-next-line @next/next/no-img-element -- generated data URL, printed as-is
                  <img src={urls.get(code)} width={qrSize} height={qrSize} alt={`QR code ${code}`} />
                ) : (
                  <span style={{ width: qrSize, height: qrSize, background: "#f1f3f6", borderRadius: 4, flex: "none" }} aria-hidden="true" />
                )
              ) : null}
              <div className="ims-label-text" style={stacked ? { alignItems: "center", width: "100%" } : undefined}>
                {options.showBusiness ? <span className="ims-label-meta">{businessName}</span> : null}
                <span className="ims-label-name">{item.name}</span>
                {options.showSku ? <span className="ims-label-meta">{[item.sku, item.unit].filter(Boolean).join(" · ")}</span> : null}
                {price != null && price > 0 ? (
                  <span className="ims-label-price">
                    {options.price === "mrp" ? "MRP " : ""}
                    {inr(price)}
                  </span>
                ) : null}
                {showEan && ean ? <Ean13Svg code={ean} /> : null}
                {!showEan && !item.barcode ? <span className="ims-label-meta">{code.length > 20 ? `${code.slice(0, 8)}…` : code}</span> : null}
              </div>
            </div>
          );
        })}
      </div>
    </article>
  );
}

/** Label designer: options on the left, live printable preview below. */
export function LabelsPanel({ items, onBack }: { items: ReadonlyArray<ImsItem>; onBack: () => void }) {
  const { session } = useIms();
  const print = usePrint();
  const [opts, setOpts] = useState<LabelOptions>(DEFAULT_OPTIONS);
  const set = <K extends keyof LabelOptions>(k: K, v: LabelOptions[K]) => setOpts((o) => ({ ...o, [k]: v }));
  const businessName = session.settings.businessName || session.brand?.name || "";
  const withoutEan = items.filter((i) => !isEan13(i.barcode)).length;
  const total = items.length * Math.max(1, Math.min(50, Math.round(opts.copies) || 1));

  return (
    <Stack gap={16}>
      <PageHeader
        title="Print labels"
        sub={`${items.length} item${items.length === 1 ? "" : "s"} · ${total} label${total === 1 ? "" : "s"}. QR codes scan in QR Stock Scan; EAN-13 works with any barcode gun.`}
        actions={
          <>
            <Button variant="ghost" icon="chevronLeft" onClick={onBack}>
              Back to items
            </Button>
            <Button variant="primary" icon="printer" onClick={print} disabled={!items.length}>
              Print
            </Button>
          </>
        }
      />
      <Card interactive={false}>
        <FormGrid columns="repeat(auto-fit, minmax(190px, 1fr))">
          <Field label="Code">
            {() => (
              <Segmented
                size="sm"
                role="radio"
                aria-label="Code type"
                value={opts.code}
                onChange={(v) => set("code", v)}
                options={[
                  { value: "both", label: "QR + barcode" },
                  { value: "qr", label: "QR" },
                  { value: "barcode", label: "Barcode" },
                ]}
              />
            )}
          </Field>
          <Field label="Price">
            {() => (
              <Segmented
                size="sm"
                role="radio"
                aria-label="Price on label"
                value={opts.price}
                onChange={(v) => set("price", v)}
                options={[
                  { value: "selling", label: "Selling" },
                  { value: "mrp", label: "MRP" },
                  { value: "none", label: "None" },
                ]}
              />
            )}
          </Field>
          <Field label="Labels per row">
            {() => (
              <Segmented
                size="sm"
                role="radio"
                aria-label="Labels per row"
                value={opts.cols}
                onChange={(v) => set("cols", v)}
                options={[
                  { value: "2", label: "2" },
                  { value: "3", label: "3" },
                  { value: "4", label: "4" },
                ]}
              />
            )}
          </Field>
          <Field label="Copies of each" hint="1–50">
            {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="number" min={1} max={50} value={opts.copies} onChange={(e) => set("copies", Number(e.target.value))} />}
          </Field>
          <Field label="Show">
            {() => (
              <div className="ims-row" style={{ gap: 14 }}>
                <span className="ims-row" style={{ gap: 6 }}>
                  <Switch checked={opts.showSku} onChange={(v) => set("showSku", v)} aria-label="Show SKU and unit" /> SKU
                </span>
                <span className="ims-row" style={{ gap: 6 }}>
                  <Switch checked={opts.showBusiness} onChange={(v) => set("showBusiness", v)} aria-label="Show business name" /> Business
                </span>
              </div>
            )}
          </Field>
        </FormGrid>
        {opts.code !== "qr" && withoutEan ? (
          <p className="ims-faint" style={{ marginTop: 10 }}>
            {withoutEan} item{withoutEan === 1 ? " has" : "s have"} no EAN-13 barcode, so {withoutEan === 1 ? "it gets" : "they get"} a QR code instead. Use “Generate” on the item to create one.
          </p>
        ) : null}
      </Card>
      {items.length ? (
        <LabelSheet items={items} options={opts} businessName={businessName} />
      ) : (
        <Alert tone="blue" title="No items selected">
          Go back and tick the items you want labels for.
        </Alert>
      )}
    </Stack>
  );
}
