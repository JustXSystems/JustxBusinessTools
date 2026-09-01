"use client";

import type { TrackerConfig } from "@/config/tools.config";
import { useToast } from "@/components/common/ToastProvider";
import { useLocale } from "@/components/i18n/LocaleProvider";
import { useSubscription } from "@/hooks/useSubscription";
import { downloadCsv } from "@/lib/export/csv";
import { downloadXlsx } from "@/lib/export/xlsx";
import {
  buildDocumentExport,
  buildTrackerExport,
  type ExportDataset,
} from "@/lib/export/build-export-data";
import { trackExport } from "@/lib/analytics";
import type { TrackerRow } from "@/lib/types/tool-record";

type Props = {
  toolId: string;
  config?: TrackerConfig;
  rows?: TrackerRow[];
  documentRows?: Array<Record<string, unknown>>;
  documentHeaders?: string[];
};

export function ExportActions({ toolId, config, rows = [], documentRows, documentHeaders }: Props) {
  const { isToolLicensed, openUpgrade } = useSubscription();
  const { showToast } = useToast();
  const { t } = useLocale();

  const hasData = rows.length > 0 || (documentRows?.length ?? 0) > 0;
  if (!hasData) return null;

  function buildDataset(): ExportDataset | null {
    if (documentRows && documentHeaders) {
      return buildDocumentExport(toolId, documentHeaders, documentRows);
    }
    if (!config) return null;
    return buildTrackerExport(toolId, config, rows);
  }

  function handleExport(format: "csv" | "xlsx") {
    if (!isToolLicensed(toolId)) {
      showToast(t("common.exportProOnly"));
      openUpgrade(toolId);
      return;
    }

    const dataset = buildDataset();
    if (!dataset) return;

    if (format === "csv") {
      downloadCsv(`${dataset.filenameBase}.csv`, dataset.headers, dataset.rows);
      showToast("✔ CSV exported");
    } else {
      downloadXlsx(`${dataset.filenameBase}.xlsx`, dataset.headers, dataset.rows);
      showToast("✔ Excel exported");
    }
    trackExport(toolId);
  }

  return (
    <div className="export-btn-group">
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => handleExport("csv")}>
        {t("common.exportCsv")}
      </button>
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => handleExport("xlsx")}>
        {t("common.exportXlsx")}
      </button>
    </div>
  );
}

/** @deprecated Use ExportActions */
export const ExportCsvButton = ExportActions;
