import fs from "node:fs";
import path from "node:path";
import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";
import { IMS_JOURNEY_SCENARIOS, IMS_MODULE_SCENARIOS } from "../ims/modules.catalog";

type Row = {
  scenarioId: string;
  title: string;
  status: "passed" | "failed" | "timedOut" | "skipped" | "interrupted" | "unknown";
  durationMs: number;
  mutates: boolean;
  path?: string;
  moduleKey?: string;
  error?: string;
  manualChecks: string[];
  file?: string;
};

function ann(test: TestCase, type: string): string | undefined {
  return test.annotations.find((a) => a.type === type)?.description;
}

function outDir(): string {
  return process.env.IMS_E2E_RESULTS_DIR || path.join(process.cwd(), "e2e-results", "ims");
}

class ImsScenarioReporter implements Reporter {
  private rows: Row[] = [];
  private startedAt = new Date();

  onBegin(_config: FullConfig, _suite: Suite) {
    this.startedAt = new Date();
    this.rows = [];
  }

  onTestEnd(test: TestCase, result: TestResult) {
    const scenarioId = ann(test, "scenarioId") || test.title.split("—")[0]?.trim() || test.title;
    const title = ann(test, "scenarioTitle") || test.title;
    const manualRaw = ann(test, "manualChecks") || "";
    const known =
      IMS_MODULE_SCENARIOS.find((s) => s.id === scenarioId) ||
      IMS_JOURNEY_SCENARIOS.find((s) => s.id === scenarioId);
    const manualChecks =
      manualRaw.split("|").map((s) => s.trim()).filter(Boolean) ||
      ("manualChecks" in (known ?? {}) ? (known as { manualChecks: string[] }).manualChecks : []);

    this.rows.push({
      scenarioId,
      title,
      status: result.status,
      durationMs: result.duration,
      mutates: ann(test, "mutates") === "true" || Boolean((known as { mutates?: boolean } | undefined)?.mutates),
      path: ann(test, "path"),
      moduleKey: ann(test, "moduleKey"),
      error: result.error?.message,
      manualChecks:
        manualChecks.length > 0
          ? manualChecks
          : ((known as { manualChecks?: string[] } | undefined)?.manualChecks ?? []),
      file: test.location.file,
    });
  }

  onEnd(result: FullResult) {
    const dir = outDir();
    fs.mkdirSync(dir, { recursive: true });

    const catalogIds = new Set([
      ...IMS_MODULE_SCENARIOS.map((s) => s.id),
      ...IMS_JOURNEY_SCENARIOS.map((s) => s.id),
    ]);
    const ranIds = new Set(this.rows.map((r) => r.scenarioId));
    const notAutomated = [
      ...IMS_MODULE_SCENARIOS.filter((s) => !ranIds.has(s.id)).map((s) => ({
        id: s.id,
        title: `${s.section}: ${s.label}`,
        manualChecks: s.manualChecks,
      })),
      ...IMS_JOURNEY_SCENARIOS.filter((s) => !ranIds.has(s.id)).map((s) => ({
        id: s.id,
        title: s.title,
        manualChecks: s.manualChecks,
      })),
    ];

    // Also list catalog manual checks for scenarios that ran (for human spot-check).
    const payload = {
      generatedAt: new Date().toISOString(),
      startedAt: this.startedAt.toISOString(),
      suiteStatus: result.status,
      totals: {
        ran: this.rows.length,
        passed: this.rows.filter((r) => r.status === "passed").length,
        failed: this.rows.filter((r) => r.status === "failed" || r.status === "timedOut").length,
        skipped: this.rows.filter((r) => r.status === "skipped").length,
        catalogScenarios: catalogIds.size,
      },
      results: this.rows,
      notAutomatedInThisRun: notAutomated,
      catalog: {
        modules: IMS_MODULE_SCENARIOS,
        journeys: IMS_JOURNEY_SCENARIOS,
      },
    };

    const jsonPath = path.join(dir, "latest.json");
    fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), "utf8");

    const md = renderManualVerify(payload);
    const mdPath = path.join(dir, "MANUAL_VERIFY.md");
    fs.writeFileSync(mdPath, md, "utf8");

    // Stamp a copy for history.
    const stamp = this.startedAt.toISOString().replace(/[:.]/g, "-");
    fs.writeFileSync(path.join(dir, `run-${stamp}.json`), JSON.stringify(payload, null, 2), "utf8");
    fs.writeFileSync(path.join(dir, `MANUAL_VERIFY-${stamp}.md`), md, "utf8");

    console.log(`\n[IMS E2E] Detailed results: ${jsonPath}`);
    console.log(`[IMS E2E] Manual verification checklist: ${mdPath}`);
    console.log(`[IMS E2E] HTML report: npx playwright show-report e2e-results/ims-html\n`);
  }
}

function renderManualVerify(payload: {
  generatedAt: string;
  suiteStatus: string;
  totals: { ran: number; passed: number; failed: number; skipped: number; catalogScenarios: number };
  results: Row[];
}): string {
  const lines: string[] = [];
  lines.push(`# IMS JustTestX — Manual verification checklist`);
  lines.push("");
  lines.push(`Generated: ${payload.generatedAt}`);
  lines.push(`Suite status: **${payload.suiteStatus}**`);
  lines.push(
    `Automated: ${payload.totals.passed} passed / ${payload.totals.failed} failed / ${payload.totals.skipped} skipped (of ${payload.totals.ran} ran; catalog ${payload.totals.catalogScenarios} scenarios).`,
  );
  lines.push("");
  lines.push(`Open the Playwright HTML report for traces, screenshots, and steps:`);
  lines.push("");
  lines.push("```bash");
  lines.push("npx playwright show-report e2e-results/ims-html");
  lines.push("```");
  lines.push("");
  lines.push("## Automated results (spot-check these next)");
  lines.push("");
  lines.push("| Status | ID | Scenario | Mutates | Manual checks |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const r of payload.results) {
    const status =
      r.status === "passed" ? "PASS" : r.status === "skipped" ? "SKIP" : "FAIL";
    const checks = r.manualChecks.map((c) => `- [ ] ${c}`).join("<br>");
    const err = r.error ? `<br><em>${escapeMd(r.error.split("\n")[0] ?? "")}</em>` : "";
    lines.push(
      `| ${status} | \`${r.scenarioId}\` | ${escapeMd(r.title)}${err} | ${r.mutates ? "yes" : "no"} | ${checks || "—"} |`,
    );
  }
  lines.push("");
  lines.push("## Full module catalog (always verify after major IMS releases)");
  lines.push("");
  for (const s of IMS_MODULE_SCENARIOS) {
    const auto = payload.results.find((r) => r.scenarioId === s.id);
    const badge = auto ? `_(auto: ${auto.status})_` : "_(catalog)_";
    lines.push(`### ${s.id} — ${s.label} ${badge}`);
    lines.push(`- Path: \`${s.path}\``);
    lines.push(`- Section: ${s.section}`);
    for (const c of s.manualChecks) lines.push(`- [ ] ${c}`);
    lines.push("");
  }
  lines.push("## Journey catalog");
  lines.push("");
  for (const j of IMS_JOURNEY_SCENARIOS) {
    const auto = payload.results.find((r) => r.scenarioId === j.id);
    const badge = auto ? `_(auto: ${auto.status})_` : "_(catalog)_";
    lines.push(`### ${j.id} — ${j.title} ${badge}`);
    lines.push(`- Mutates data: ${j.mutates ? "yes" : "no"}`);
    for (const c of j.manualChecks) lines.push(`- [ ] ${c}`);
    lines.push("");
  }
  lines.push("## How to re-run (on demand only)");
  lines.push("");
  lines.push("```bash");
  lines.push("npm run test:e2e:ims");
  lines.push("```");
  lines.push("");
  lines.push("This suite is **not** part of `npm run test:e2e` / PR smoke.");
  lines.push("");
  return lines.join("\n");
}

function escapeMd(s: string) {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export default ImsScenarioReporter;
