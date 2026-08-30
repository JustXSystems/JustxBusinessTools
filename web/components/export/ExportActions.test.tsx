/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExportActions } from "@/components/export/ExportActions";

vi.mock("@/hooks/useSubscription", () => ({
  useSubscription: () => ({
    isPro: true,
    isUnlimited: true,
    isToolLicensed: () => true,
    openUpgrade: vi.fn(),
  }),
}));

vi.mock("@/components/common/ToastProvider", () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

vi.mock("@/components/i18n/LocaleProvider", () => ({
  useLocale: () => ({ t: (key: string) => key }),
}));

vi.mock("@/lib/export/csv", () => ({
  downloadCsv: vi.fn(),
}));

vi.mock("@/lib/export/xlsx", () => ({
  downloadXlsx: vi.fn(),
}));

vi.mock("@/lib/analytics", () => ({
  trackExport: vi.fn(),
}));

describe("ExportActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders export buttons when tracker rows exist", () => {
    render(
      <ExportActions
        toolId="vendors"
        config={{
          key: "vendors",
          title: "Vendors",
          icon: "🏭",
          subtitle: "",
          addLabel: "Add",
          fields: [{ key: "name", label: "Name", type: "text", required: true }],
          titleField: "name",
          subtitleFields: [],
          metaFields: [],
          statusField: null,
        }}
        rows={[{ id: "v1", name: "Acme" }]}
      />,
    );

    expect(screen.getByRole("button", { name: "common.exportCsv" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "common.exportXlsx" })).toBeInTheDocument();
  });

  it("returns null when no exportable data", () => {
    const { container } = render(<ExportActions toolId="vendors" rows={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
