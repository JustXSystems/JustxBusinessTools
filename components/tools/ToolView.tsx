"use client";

import Link from "next/link";
import { Suspense } from "react";
import { DOCUMENT_CONFIGS } from "@/config/tools.config";
import { usePlatformConfig } from "@/components/config/ConfigProvider";
import { DocumentTool } from "@/components/documents/DocumentTool";
import { CalculatorTool } from "@/components/calculators/CalculatorTool";
import { QrTool } from "@/components/utilities/QrTool";
import { QuotationGeneratorV1 } from "@/components/quotation-v1/QuotationGeneratorV1";
import { TrackerTool } from "@/components/tools/TrackerTool";
import { resolveToolDefinition } from "@/lib/dynamic-tools";

export function ToolView({ toolId }: { toolId: string }) {
  const { config, loading } = usePlatformConfig();
  const platformTools = config?.tools ?? [];
  const tool = resolveToolDefinition(toolId, platformTools);

  if (loading && !tool) {
    return (
      <div className="empty-state">
        <div className="es-icon">⏳</div>
        <div className="es-title">Loading…</div>
      </div>
    );
  }

  if (!tool) {
    return (
      <div className="empty-state">
        <div className="es-icon">🚧</div>
        <div className="es-title">Tool not found</div>
        <Link href="/" className="btn btn-secondary btn-sm">Back to home</Link>
      </div>
    );
  }

  if (tool.type === "tracker") {
    return <TrackerTool tool={tool} />;
  }

  if (tool.type === "document" && DOCUMENT_CONFIGS[tool.id as keyof typeof DOCUMENT_CONFIGS]) {
    return (
      <Suspense
        fallback={
          <div className="empty-state">
            <div className="es-icon">⏳</div>
            <div className="es-title">Loading…</div>
          </div>
        }
      >
        <DocumentTool tool={tool} />
      </Suspense>
    );
  }

  if (tool.type === "calculator") {
    return <CalculatorTool tool={tool} />;
  }

  if (tool.id === "qrscanner") {
    return <QrTool />;
  }

  if (tool.id === "quotationv1") {
    return <QuotationGeneratorV1 />;
  }

  return (
    <div>
      <div className="tool-header">
        <Link href="/" className="back-btn" aria-label="Back">←</Link>
        <div className="tool-header-text">
          <div className="tool-header-title">{tool.icon} {tool.name}</div>
          <div className="tool-header-sub">{tool.desc}</div>
        </div>
      </div>
      <div className="panel">
        <p className="section-note mt-0">This tool is not available yet.</p>
      </div>
    </div>
  );
}
