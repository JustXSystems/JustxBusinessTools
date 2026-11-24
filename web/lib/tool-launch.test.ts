import { describe, expect, it } from "vitest";
import { resolveToolLaunch, supportsStandaloneApp, toStandaloneHref } from "./tool-launch";

describe("tool-launch", () => {
  it("knows which tools have a full-screen app", () => {
    expect(supportsStandaloneApp("bos")).toBe(true);
    expect(supportsStandaloneApp("imsdealer")).toBe(true);
    expect(supportsStandaloneApp("gmap2mappls")).toBe(true);
    expect(supportsStandaloneApp("quotation")).toBe(false);
  });

  it("defaults BOS / IMS / Pinway to standalone new-window", () => {
    expect(resolveToolLaunch("bos")).toEqual({
      mode: "standalone",
      href: "/bos",
      openInNewWindow: true,
    });
    expect(resolveToolLaunch("imsdealer")).toEqual({
      mode: "standalone",
      href: "/ims",
      openInNewWindow: true,
    });
    expect(resolveToolLaunch("gmap2mappls")).toEqual({
      mode: "standalone",
      href: "/googlemaps2mappls",
      openInNewWindow: true,
    });
  });

  it("honours admin openStandalone=false (embed in JBT)", () => {
    expect(resolveToolLaunch("bos", { openStandalone: false })).toEqual({
      mode: "embedded",
      href: "/tools/bos",
      openInNewWindow: false,
    });
  });

  it("forces GoogleMaps2Mappls as an independent standalone app", () => {
    expect(resolveToolLaunch("gmap2mappls", { openStandalone: false })).toEqual({
      mode: "standalone",
      href: "/googlemaps2mappls",
      openInNewWindow: true,
    });
  });

  it("keeps ordinary tools embedded", () => {
    expect(resolveToolLaunch("invoice")).toEqual({
      mode: "embedded",
      href: "/tools/invoice",
      openInNewWindow: false,
    });
  });

  it("maps tool URLs onto standalone paths with query", () => {
    expect(toStandaloneHref("bos", "?ws=finance&m=invoices")).toBe("/bos?ws=finance&m=invoices");
    expect(toStandaloneHref("imsdealer", "m=purchase")).toBe("/ims?m=purchase");
    expect(toStandaloneHref("gmap2mappls", "?brand=me4u")).toBe("/googlemaps2mappls?brand=me4u");
    expect(toStandaloneHref("invoice")).toBeNull();
  });
});
