import { describe, expect, it } from "vitest";
import {
  DEFAULT_PUBLIC_HOME,
  parsePublicHome,
  signPublicHomeMedia,
} from "../public-home.js";

describe("parsePublicHome", () => {
  it("defaults to enabled so guests see the marketing home at /", () => {
    expect(DEFAULT_PUBLIC_HOME.enabled).toBe(true);
    expect(parsePublicHome(null).enabled).toBe(true);
    expect(parsePublicHome({}).enabled).toBe(true);
  });

  it("preserves enabled false when explicitly set", () => {
    expect(parsePublicHome({ enabled: false }).enabled).toBe(false);
  });

  it("recovers from garbage / double-encoded JSON", () => {
    const cfg = parsePublicHome(JSON.stringify(JSON.stringify({ enabled: true, sections: [] })));
    expect(cfg.version).toBe(1);
    expect(cfg.sections.length).toBeGreaterThan(0);
    expect(cfg.sections.some((s) => s.type === "hero")).toBe(true);
  });

  it("keeps known section types and drops unknown ones", () => {
    const cfg = parsePublicHome({
      enabled: true,
      sections: [
        { type: "hero", id: "h1", headline: "Hello", enabled: true },
        { type: "nope", id: "x" },
        { type: "footer", id: "f1", enabled: false, logoText: "X" },
      ],
    });
    expect(cfg.sections.map((s) => s.type)).toEqual(["hero", "footer"]);
    expect(cfg.sections[0]).toMatchObject({ type: "hero", headline: "Hello" });
    expect(cfg.sections[1]).toMatchObject({ type: "footer", enabled: false, logoText: "X" });
  });

  it("parses cinematic hero slides, stats, and pillars", () => {
    const cfg = parsePublicHome({
      enabled: true,
      sections: [
        {
          type: "hero",
          id: "hero",
          brandLabel: "JustX",
          slides: [
            {
              id: "s1",
              headline: "Slide",
              words: ["A", "B"],
              background: { kind: "image", url: "/x.png" },
            },
          ],
          chips: ["GST"],
          autoplaySec: 5,
        },
        {
          type: "stats",
          id: "stats",
          items: [{ id: "st1", value: "20+", label: "Tools", icon: "◆" }],
        },
        {
          type: "pillars",
          id: "pillars",
          title: "Caps",
          items: [
            {
              id: "p1",
              title: "Sell",
              bullets: ["Quote", "Invoice"],
              media: { kind: "image", url: "/p.png" },
            },
          ],
        },
      ],
    });
    const hero = cfg.sections.find((s) => s.type === "hero");
    expect(hero && hero.type === "hero" ? hero.brandLabel : "").toBe("JustX");
    expect(hero && hero.type === "hero" ? hero.slides.length : 0).toBe(1);
    expect(hero && hero.type === "hero" ? hero.slides[0].words : []).toEqual(["A", "B"]);
    expect(hero && hero.type === "hero" ? hero.chips : []).toEqual(["GST"]);
    expect(cfg.sections.map((s) => s.type)).toEqual(["hero", "stats", "pillars"]);
    const pillars = cfg.sections.find((s) => s.type === "pillars");
    expect(pillars && pillars.type === "pillars" ? pillars.items[0].bullets : []).toEqual([
      "Quote",
      "Invoice",
    ]);
  });

  it("includes stats and pillars in default marketing home", () => {
    expect(DEFAULT_PUBLIC_HOME.sections.some((s) => s.type === "stats")).toBe(true);
    expect(DEFAULT_PUBLIC_HOME.sections.some((s) => s.type === "pillars")).toBe(true);
    const hero = DEFAULT_PUBLIC_HOME.sections.find((s) => s.type === "hero");
    expect(hero && hero.type === "hero" ? hero.slides.length : 0).toBeGreaterThan(0);
    expect(hero && hero.type === "hero" ? hero.brandLabel : "").toContain("JustX");
  });

  it("clamps marquee speed", () => {
    const cfg = parsePublicHome({
      sections: [{ type: "marquee", id: "m", speedSec: 999, sourceIds: ["a"] }],
    });
    const m = cfg.sections.find((s) => s.type === "marquee");
    expect(m && m.type === "marquee" ? m.speedSec : 0).toBe(120);
  });
});

describe("signPublicHomeMedia", () => {
  it("leaves non-file URLs unchanged", () => {
    const base = parsePublicHome({
      enabled: true,
      sections: [
        {
          type: "hero",
          id: "hero",
          media: { kind: "image", url: "/icons/justx-logo.png", alt: "", objectFit: "cover" },
        },
      ],
    });
    const signed = signPublicHomeMedia(base);
    const hero = signed.sections.find((s) => s.type === "hero");
    expect(hero && hero.type === "hero" ? hero.media.url : "").toBe("/icons/justx-logo.png");
  });
});
