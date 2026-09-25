/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CollapsibleSection } from "@/components/common/CollapsibleSection";

describe("CollapsibleSection", () => {
  it("is collapsed by default and keeps the body mounted", () => {
    render(
      <CollapsibleSection title="Bank details" hint="Account & IFSC" badge="Off">
        <input aria-label="IFSC" defaultValue="HDFC0001" />
      </CollapsibleSection>,
    );
    const toggle = screen.getByRole("button", { name: /Bank details/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    const input = screen.getByLabelText("IFSC", { selector: "input" }) as HTMLInputElement;
    expect(input.closest("[hidden]")).not.toBeNull();

    fireEvent.change(input, { target: { value: "ICIC0002" } });
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(input.closest("[hidden]")).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(input.value).toBe("ICIC0002");
  });

  it("supports controlled open state", () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <CollapsibleSection title="Terms" open={false} onOpenChange={onOpenChange}>
        <p>Body</p>
      </CollapsibleSection>,
    );
    const toggle = screen.getByRole("button", { name: /Terms/ });
    fireEvent.click(toggle);
    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    rerender(
      <CollapsibleSection title="Terms" open onOpenChange={onOpenChange}>
        <p>Body</p>
      </CollapsibleSection>,
    );
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });
});
