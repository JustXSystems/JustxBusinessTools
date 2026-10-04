/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import BosDesignTool from "@/components/bos-design/BosDesignTool";

function tabs(name: string) {
  return within(screen.getByRole("tablist", { name })).getAllByRole("tab");
}

function clickEveryModuleAndSubtab(container: HTMLElement) {
  const navCount = container.querySelectorAll(".bos-nav-item").length;
  expect(navCount).toBeGreaterThan(0);
  for (let i = 0; i < navCount; i++) {
    const item = container.querySelectorAll<HTMLButtonElement>(".bos-nav-item")[i];
    fireEvent.click(item);
    expect(item.getAttribute("aria-current")).toBe("page");
    const subtabs = container.querySelectorAll<HTMLButtonElement>(".bos-shell-main .bos-subtabs [role=tab]");
    for (let s = 0; s < subtabs.length; s++) {
      fireEvent.click(container.querySelectorAll<HTMLButtonElement>(".bos-shell-main .bos-subtabs [role=tab]")[s]);
    }
  }
}

describe("BosDesignTool", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
    Element.prototype.scrollIntoView = vi.fn();
    consoleError = vi.spyOn(console, "error");
  });

  afterEach(() => {
    cleanup();
    consoleError.mockRestore();
    document.body.className = "";
  });

  it("renders inside a scoped .bos root without touching the host page", () => {
    const { container } = render(<BosDesignTool />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.classList.contains("bos")).toBe(true);
    expect(root.dataset.bosTheme).toMatch(/^(light|dark)$/);
    expect(document.body.className).toBe("");
  });

  it("walks every workspace, module and subtab without runtime errors", () => {
    const { container } = render(<BosDesignTool />);
    const names = tabs("Workspaces").map((t) => t.textContent ?? "");
    expect(names).toHaveLength(5);

    for (let i = 0; i < names.length; i++) {
      fireEvent.click(tabs("Workspaces")[i]);
      expect(tabs("Workspaces")[i].getAttribute("aria-selected")).toBe("true");
      if (/HR|Finance/.test(names[i])) clickEveryModuleAndSubtab(container);
    }

    expect(consoleError).not.toHaveBeenCalled();
  });

  it("switches theme on the BOS root only", () => {
    const { container } = render(<BosDesignTool />);
    const root = container.firstElementChild as HTMLElement;
    const toggle = screen.getByRole("radiogroup", { name: "Color theme" });
    const next = root.dataset.bosTheme === "dark" ? "light" : "dark";
    act(() => {
      fireEvent.click(within(toggle).getAllByRole("radio").find((r) => r.textContent?.toLowerCase().includes(next))!);
    });
    expect(root.dataset.bosTheme).toBe(next);
    expect(document.documentElement.dataset.bosTheme).toBeUndefined();
  });
});
