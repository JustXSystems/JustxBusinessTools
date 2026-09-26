"use client";

import { useMemo, useRef, useState } from "react";
import { useToast } from "@/components/common/ToastProvider";
import { BATCH_EXTRA_COLUMNS, batchTemplateCsv, parseBatch } from "@/lib/qr-generator/batch";
import type { QrGeneratorConfig } from "@/lib/qr-generator/config";
import {
  buildLabelSheetPdf,
  downloadBlob,
  renderPngBlob,
  renderPngDataUrl,
  zipFiles,
  type PdfQrItem,
} from "@/lib/qr-generator/export";
import { getQrTypeDef, QR_TYPES, type QrType } from "@/lib/qr-generator/payloads";
import { createQrMatrix, renderQrSvg, type QrDesign } from "@/lib/qr-generator/render";

type BatchFormat = "png" | "svg" | "pdf";

const FORMAT_LABELS: Record<BatchFormat, string> = {
  png: "ZIP of PNG images",
  svg: "ZIP of SVG vectors",
  pdf: "PDF label sheet (A4, 12 per page)",
};

const PREVIEW_ROWS = 8;

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function QrBatchPanel({
  cfg,
  initialType,
  design,
  logo,
  onExported,
}: {
  cfg: QrGeneratorConfig;
  initialType: QrType;
  /** Fully resolved design (brand lock and error-correction floor already applied). */
  design: QrDesign;
  logo: HTMLImageElement | null;
  onExported: (info: { type: QrType; format: BatchFormat; count: number }) => void;
}) {
  const { showToast } = useToast();
  const [type, setType] = useState<QrType>(initialType);
  const [text, setText] = useState("");
  const formats = (["png", "svg", "pdf"] as const).filter((f) => cfg.exports.formats.includes(f));
  const [format, setFormat] = useState<BatchFormat>(formats[0] ?? "png");
  const [size, setSize] = useState(cfg.exports.defaultSize);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const prefix = cfg.exports.filenamePrefix;
  const typeDef = getQrTypeDef(type);

  const parsed = useMemo(
    () =>
      parseBatch(type, text, {
        maxRows: cfg.features.batchMaxRows,
        defaults: cfg.fieldDefaults[type],
        filenamePrefix: prefix,
      }),
    [type, text, cfg.features.batchMaxRows, cfg.fieldDefaults, prefix],
  );
  const ready = parsed.items.filter((i) => i.result.ok);
  const failed = parsed.items.length - ready.length;
  const activeFormat = formats.includes(format) ? format : formats[0];

  function downloadTemplate() {
    downloadBlob(new Blob([batchTemplateCsv(type)], { type: "text/csv" }), `${prefix}-${type}-template.csv`);
  }

  async function loadFile(file: File) {
    if (file.size > 2 * 1024 * 1024) {
      showToast("File is larger than 2 MB — split it into smaller batches.");
      return;
    }
    setText(await file.text());
  }

  async function generate() {
    if (!activeFormat || ready.length === 0 || progress) return;
    const total = ready.length;
    setProgress({ done: 0, total });
    const files: Array<{ name: string; data: Uint8Array }> = [];
    const pdfItems: PdfQrItem[] = [];
    const manifest: string[] = ["file,content"];
    const skipped: number[] = [];
    const encoder = new TextEncoder();
    try {
      for (let i = 0; i < total; i++) {
        const item = ready[i];
        if (!item.result.ok) continue;
        const payload = item.result.payload;
        let matrix;
        try {
          matrix = createQrMatrix(payload, design.ecl);
        } catch {
          skipped.push(item.row);
          continue;
        }
        const itemDesign = { ...design, caption: item.caption || design.caption };
        if (activeFormat === "png") {
          const blob = await renderPngBlob(matrix, itemDesign, size, logo);
          files.push({ name: `${item.name}.png`, data: new Uint8Array(await blob.arrayBuffer()) });
        } else if (activeFormat === "svg") {
          files.push({ name: `${item.name}.svg`, data: encoder.encode(renderQrSvg(matrix, itemDesign, size)) });
        } else {
          const { dataUrl, aspect } = renderPngDataUrl(matrix, { ...itemDesign, caption: "" }, 600, logo);
          pdfItems.push({ dataUrl, aspect, label: item.caption || item.name });
        }
        manifest.push(`${csvCell(`${item.name}.${activeFormat}`)},${csvCell(payload)}`);
        if (i % 8 === 7 || i === total - 1) {
          setProgress({ done: i + 1, total });
          await new Promise((r) => setTimeout(r, 0));
        }
      }

      const produced = activeFormat === "pdf" ? pdfItems.length : files.length;
      if (produced === 0) {
        showToast("Nothing to export — every row was too long for a QR code.");
        return;
      }
      if (activeFormat === "pdf") {
        downloadBlob(await buildLabelSheetPdf(pdfItems), `${prefix}-${type}-labels.pdf`);
      } else {
        files.push({ name: "manifest.csv", data: encoder.encode(`${manifest.join("\r\n")}\r\n`) });
        downloadBlob(await zipFiles(files), `${prefix}-${type}-batch.zip`);
      }
      onExported({ type, format: activeFormat, count: produced });
      showToast(
        skipped.length
          ? `Exported ${produced} QR codes. Skipped row ${skipped.join(", ")} (too much content).`
          : `Exported ${produced} QR codes.`,
      );
    } catch (err) {
      showToast(err instanceof Error && err.message ? err.message : "Batch export failed.");
    } finally {
      setProgress(null);
    }
  }

  const columns = [...typeDef.fields.map((f) => f.key), ...BATCH_EXTRA_COLUMNS].join(", ");

  return (
    <section className="panel qrg-batch" aria-label="Batch generation">
      <div className="qrg-panel-head">
        <h2 className="panel-title">Batch generation</h2>
        <span className="pill pill-neutral">Up to {cfg.features.batchMaxRows} rows</span>
      </div>
      <p className="section-note">
        Paste rows from Excel / Google Sheets or upload a CSV — one QR code per row, using the current design. Great for
        asset tags, table stands, staff contact cards and payment counters.
      </p>

      <div className="qrg-grid">
        <label className="field" htmlFor="qrg-batch-type">
          <span className="label">QR type</span>
          <select id="qrg-batch-type" value={type} onChange={(e) => setType(e.target.value as QrType)}>
            {QR_TYPES.filter((t) => cfg.enabledTypes.includes(t.id)).map((t) => (
              <option key={t.id} value={t.id}>
                {t.icon} {t.label}
              </option>
            ))}
          </select>
        </label>
        <div className="field">
          <span className="label">Data</span>
          <div className="btn-row">
            <button type="button" className="btn btn-secondary btn-sm" onClick={downloadTemplate}>
              ⬇ Template
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => fileRef.current?.click()}>
              Upload CSV
            </button>
            {text ? (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setText("")}>
                Clear
              </button>
            ) : null}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.tsv,.txt,text/csv,text/plain"
            className="hidden-input"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void loadFile(file);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      <label className="field" htmlFor="qrg-batch-text">
        <span className="label">Rows (first row = column headers)</span>
        <textarea
          id="qrg-batch-text"
          rows={7}
          value={text}
          spellCheck={false}
          className="qrg-batch-input"
          placeholder={`${columns}\n…`}
          onChange={(e) => setText(e.target.value)}
        />
        <span className="qrg-hint">
          Columns: <code>{columns}</code>. Headers can also be the field labels shown in the single-QR form.
        </span>
      </label>

      {parsed.items.length || parsed.missingRequired.length ? (
        <div className="qrg-batch-summary">
          <span className="pill pill-success">{ready.length} ready</span>
          {failed ? <span className="pill pill-danger">{failed} with errors</span> : null}
          {parsed.truncated ? <span className="pill pill-warning">Only the first {cfg.features.batchMaxRows} rows are used</span> : null}
        </div>
      ) : null}
      {parsed.missingRequired.length ? (
        <div className="qrg-alert qrg-alert-danger">Missing required column: {parsed.missingRequired.join(", ")}.</div>
      ) : null}
      {parsed.unknownColumns.length ? (
        <div className="qrg-alert">Ignored columns: {parsed.unknownColumns.join(", ")}.</div>
      ) : null}

      {parsed.items.length ? (
        <div className="qrg-batch-table-wrap">
          <table className="qrg-batch-table">
            <thead>
              <tr>
                <th>#</th>
                <th>File</th>
                <th>Content</th>
              </tr>
            </thead>
            <tbody>
              {parsed.items.slice(0, PREVIEW_ROWS).map((item) => (
                <tr key={item.row} className={item.result.ok ? "" : "is-error"}>
                  <td>{item.row}</td>
                  <td>{item.name}</td>
                  <td>{item.result.ok ? item.result.payload.replace(/\r\n/g, " ⏎ ") : `⚠ ${item.result.error}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {parsed.items.length > PREVIEW_ROWS ? (
            <p className="qrg-meta">+ {parsed.items.length - PREVIEW_ROWS} more rows</p>
          ) : null}
        </div>
      ) : null}

      {formats.length ? (
        <div className="qrg-grid qrg-batch-output">
          <label className="field" htmlFor="qrg-batch-format">
            <span className="label">Output</span>
            <select id="qrg-batch-format" value={activeFormat} onChange={(e) => setFormat(e.target.value as BatchFormat)}>
              {formats.map((f) => (
                <option key={f} value={f}>
                  {FORMAT_LABELS[f]}
                </option>
              ))}
            </select>
          </label>
          {activeFormat !== "pdf" ? (
            <label className="field" htmlFor="qrg-batch-size">
              <span className="label">Image size</span>
              <select id="qrg-batch-size" value={size} onChange={(e) => setSize(Number(e.target.value))}>
                {cfg.exports.sizes.map((s) => (
                  <option key={s} value={s}>
                    {s} px
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      ) : (
        <div className="qrg-alert">Your administrator hasn&apos;t enabled any batch export formats.</div>
      )}

      <button
        type="button"
        className="btn btn-primary btn-block"
        disabled={!activeFormat || ready.length === 0 || progress != null}
        onClick={() => void generate()}
      >
        {progress
          ? `Generating ${progress.done} / ${progress.total}…`
          : `Generate ${ready.length || ""} QR code${ready.length === 1 ? "" : "s"}`}
      </button>
      {progress ? (
        <div className="qrg-progress" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
          <i style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }} />
        </div>
      ) : null}
    </section>
  );
}
