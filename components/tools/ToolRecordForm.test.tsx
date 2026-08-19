/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToolRecordForm } from "@/components/tools/ToolRecordForm";

const vendorConfig = {
  key: "vendors",
  title: "Vendor Directory",
  icon: "🏭",
  subtitle: "",
  addLabel: "+ Add Vendor",
  fields: [
    { key: "name", label: "Vendor Name", type: "text" as const, required: true },
    { key: "category", label: "Category", type: "text" as const },
  ],
  titleField: "name",
  subtitleFields: ["category"],
  metaFields: [],
  statusField: null,
};

describe("ToolRecordForm", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("submits validated vendor data", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();

    render(
      <ToolRecordForm
        config={vendorConfig}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText("Vendor Name"), "Test Vendor Co");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ name: "Test Vendor Co" });
  });

  it("does not submit when required name is empty", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();

    render(
      <ToolRecordForm config={vendorConfig} onSubmit={onSubmit} onCancel={vi.fn()} />,
    );

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onSubmit).not.toHaveBeenCalled();
  });
});
