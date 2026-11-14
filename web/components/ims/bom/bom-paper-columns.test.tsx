/**
 * @vitest-environment jsdom
 *
 * Matrix-check BOM preview schedule tables for every configurable column
 * toggled off, across commercial purposes.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  BOM_CONFIGURABLE_COLUMNS,
  BOM_REQUIRED_COLUMNS,
  normalizeBomScheduleColumns,
  sampleBomPaperModel,
  scheduleColumnsFor,
  withCommercialSample,
  type BomPaperPurpose,
  type BomScheduleColumn,
} from "@/lib/ims/bom-paper";
import { BomPaper, type BomPaperModel } from "./BomPaper";

const PURPOSES: BomPaperPurpose[] = ["proposal", "executive", "technical", "field", "share"];

function modelWith(
  purpose: BomPaperPurpose,
  columns: BomScheduleColumn[] | null,
): BomPaperModel {
  const sample = withCommercialSample(sampleBomPaperModel("Column Test Co", "epc"));
  return {
    ...sample,
    template: purpose,
    industryPack: "epc",
    tone: "neutral",
    density: "comfort",
    hideMargin: false,
    customerState: sample.customerState,
    scheduleColumns: columns,
  } as BomPaperModel;
}

function assertScheduleIntegrity(container: HTMLElement, expectedCols: readonly BomScheduleColumn[]) {
  const table = container.querySelector("table.ims-bom-schedule") as HTMLTableElement | null;
  if (!table) {
    // Share / executive may not use the schedule table for every layout path.
    return null;
  }
  const heads = Array.from(table.querySelectorAll("thead th")).map((th) => th.className);
  expect(heads.length).toBe(expectedCols.length);
  for (const col of expectedCols) {
    expect(heads.some((c) => c.includes(`ims-bom-col--${col}`))).toBe(true);
  }

  const bodyRows = Array.from(table.querySelectorAll("tbody tr")).filter(
    (tr) => !tr.classList.contains("ims-bom-section") && !tr.classList.contains("ims-bom-epc-sec-total"),
  );
  expect(bodyRows.length).toBeGreaterThan(0);
  for (const row of bodyRows) {
    const cells = row.querySelectorAll(":scope > td");
    expect(cells.length).toBe(expectedCols.length);
  }

  const totalRows = table.querySelectorAll("tr.ims-bom-epc-sec-total");
  if (expectedCols.includes("amount") && totalRows.length) {
    for (const tr of Array.from(totalRows)) {
      const cells = Array.from(tr.querySelectorAll(":scope > td"));
      const span = cells.reduce((n, td) => n + Number(td.getAttribute("colspan") || 1), 0);
      expect(span).toBe(expectedCols.length);
      const amountCell = tr.querySelector("td.ims-bom-col--amount");
      expect(amountCell).toBeTruthy();
    }
  } else {
    expect(totalRows.length).toBe(0);
  }
  return table;
}

afterEach(cleanup);

describe("BomPaper column toggles", () => {
  it("keeps schedule grid intact when each optional column is turned off", () => {
    const optional = BOM_CONFIGURABLE_COLUMNS.filter((c) => !(BOM_REQUIRED_COLUMNS as readonly string[]).includes(c));
    for (const purpose of ["proposal", "technical"] as BomPaperPurpose[]) {
      for (const off of optional) {
        const selected = BOM_CONFIGURABLE_COLUMNS.filter((c) => c !== off);
        const expected = scheduleColumnsFor(purpose, "epc", selected);
        const { container } = render(<BomPaper model={modelWith(purpose, selected)} />);
        assertScheduleIntegrity(container, expected);
        cleanup();
      }
    }
  });

  it("handles sparse schedules (item+qty only) and full schedules", () => {
    for (const purpose of ["proposal", "technical"] as BomPaperPurpose[]) {
      for (const selected of [
        ["item", "qty"] as BomScheduleColumn[],
        [...BOM_CONFIGURABLE_COLUMNS] as BomScheduleColumn[],
        ["item", "sku", "make", "qty", "unit", "amount"] as BomScheduleColumn[],
        ["index", "item", "qty", "rate", "amount", "remarks"] as BomScheduleColumn[],
      ]) {
        const expected = scheduleColumnsFor(purpose, "epc", selected);
        const { container } = render(<BomPaper model={modelWith(purpose, selected)} />);
        assertScheduleIntegrity(container, expected);
        cleanup();
      }
    }
  });

  it("field purpose never shows rate/amount cells even if selected", () => {
    const selected = normalizeBomScheduleColumns(
      ["item", "qty", "rate", "amount", "remarks", "make"],
      ["item", "qty"],
    );
    const expected = scheduleColumnsFor("field", "epc", selected);
    expect(expected).not.toContain("rate");
    expect(expected).not.toContain("amount");
    expect(expected[0]).toBe("check");
    const { container } = render(<BomPaper model={modelWith("field", selected)} />);
    assertScheduleIntegrity(container, expected);
    expect(container.querySelector(".ims-bom-col--rate")).toBeNull();
    expect(container.querySelector(".ims-bom-col--amount")).toBeNull();
  });

  it("share and executive still render with column preferences", () => {
    for (const purpose of ["share", "executive"] as BomPaperPurpose[]) {
      const selected: BomScheduleColumn[] = ["item", "sku", "kind", "qty", "amount"];
      const { container } = render(<BomPaper model={modelWith(purpose, selected)} />);
      expect(container.querySelector("[data-bom-tpl]")).toBeTruthy();
      // Share uses cards; executive uses lists — both must not throw / empty out.
      expect(container.textContent).toMatch(/panel|cable|Section|Supply|Installation|Buy|Item|Qty|Total/i);
      cleanup();
    }
  });

  it("share cards do not duplicate qty when amount and rate are off", () => {
    const selected: BomScheduleColumn[] = ["item", "make", "qty"];
    const { container } = render(<BomPaper model={modelWith("share", selected)} />);
    const metas = container.querySelectorAll(".ims-bom-folio-meta");
    expect(metas.length).toBeGreaterThan(0);
    for (const meta of Array.from(metas)) {
      expect(meta.classList.contains("ims-bom-folio-meta--pair")).toBe(true);
      expect(meta.querySelector("b")).toBeNull();
      const spans = meta.querySelectorAll(":scope > span");
      expect(spans.length).toBe(2);
      expect(spans[0]!.textContent).not.toBe(spans[1]!.textContent);
    }
  });

  it("does not duplicate SKU/HSN under item when those columns are on", () => {
    const selected: BomScheduleColumn[] = ["item", "sku", "hsn", "qty", "amount"];
    const { container } = render(<BomPaper model={modelWith("proposal", selected)} />);
    const itemCells = container.querySelectorAll("td.ims-bom-col--item");
    expect(itemCells.length).toBeGreaterThan(0);
    for (const cell of Array.from(itemCells)) {
      const ids = cell.querySelector(".ims-bom-line-ids");
      expect(ids).toBeNull();
    }
    expect(container.querySelector("td.ims-bom-col--sku")?.textContent).toMatch(/PNL|CBL|—/);
  });

  it("folds SKU into item when SKU column is off", () => {
    const selected: BomScheduleColumn[] = ["item", "qty"];
    const { container } = render(<BomPaper model={modelWith("proposal", selected)} />);
    const itemText = Array.from(container.querySelectorAll("td.ims-bom-col--item"))
      .map((c) => c.textContent || "")
      .join(" ");
    expect(itemText).toMatch(/PNL-LT-415/);
    expect(itemText).toMatch(/HSN 8537/);
  });

  it("executive hides line and section money when amount and rate are off", () => {
    const selected: BomScheduleColumn[] = ["item", "make", "qty"];
    const { container } = render(<BomPaper model={modelWith("executive", selected)} />);
    const heads = container.querySelectorAll(".ims-bom-exec-sec-head");
    expect(heads.length).toBeGreaterThan(0);
    for (const head of Array.from(heads)) {
      // Left cluster only — no trailing section ₹ when amount is off.
      expect(head.querySelectorAll(":scope > b").length).toBe(0);
    }
    for (const li of Array.from(container.querySelectorAll(".ims-bom-exec-lines li"))) {
      const right = li.querySelector(":scope > span:last-child")?.textContent || "";
      expect(right).not.toMatch(/₹/);
    }
  });

  it("covers every purpose × every single optional column off without throw", () => {
    const optional = BOM_CONFIGURABLE_COLUMNS.filter((c) => !(BOM_REQUIRED_COLUMNS as readonly string[]).includes(c));
    for (const purpose of PURPOSES) {
      for (const off of optional) {
        const selected = BOM_CONFIGURABLE_COLUMNS.filter((c) => c !== off);
        expect(() => {
          const { unmount } = render(<BomPaper model={modelWith(purpose, selected)} />);
          unmount();
        }).not.toThrow();
      }
    }
  });
});
