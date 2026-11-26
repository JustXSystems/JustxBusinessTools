/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addToToolCart,
  clearToolCart,
  readActivePack,
  readBillingCycle,
  readToolCart,
  removeFromToolCart,
  setPackCart,
  writeBillingCycle,
  writeToolCart,
} from "../tool-cart";

describe("tool-cart storage & cycle state", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("adds, deduplicates, removes, and clears tools while dispatching jbt-cart-change", () => {
    const onChange = vi.fn();
    window.addEventListener("jbt-cart-change", onChange);

    expect(readToolCart()).toEqual([]);
    addToToolCart("invoice");
    addToToolCart("invoice");
    addToToolCart("ims");
    expect(readToolCart()).toEqual(["invoice", "ims"]);
    expect(onChange).toHaveBeenCalled();

    removeFromToolCart("invoice");
    expect(readToolCart()).toEqual(["ims"]);

    clearToolCart();
    expect(readToolCart()).toEqual([]);
    window.removeEventListener("jbt-cart-change", onChange);
  });

  it("manages pack cart and clears active pack when cart is overwritten", () => {
    setPackCart("finance_suite", ["invoice", "quotation"]);
    expect(readActivePack()).toBe("finance_suite");
    expect(readToolCart()).toEqual(["invoice", "quotation"]);

    writeToolCart(["todo"]);
    expect(readToolCart()).toEqual(["todo"]);
  });

  it("persists monthly and yearly billing cycles and defaults invalid values to month", () => {
    expect(readBillingCycle()).toBe("month");
    expect(writeBillingCycle("year")).toBe("year");
    expect(readBillingCycle()).toBe("year");
    expect(writeBillingCycle("month")).toBe("month");
    expect(readBillingCycle()).toBe("month");
  });
});
