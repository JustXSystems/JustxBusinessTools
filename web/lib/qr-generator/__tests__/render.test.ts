import jsQR from "jsqr";
import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  createQrMatrix,
  DEFAULT_QR_DESIGN,
  designWarnings,
  layoutQr,
  QrCapacityError,
  renderQrSvg,
  type QrDesign,
} from "@/lib/qr-generator/render";

const PAYLOAD = "upi://pay?pa=shop@okhdfcbank&pn=Shiv%20Solar&am=1500.00&cu=INR";
const FAKE_LOGO = "data:image/png;base64,iVBORw0KGgo=";

function hexRgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

/** Minimal rasteriser for the layout, so we can prove styled codes still decode. */
function rasterise(design: QrDesign, scale = 8) {
  const matrix = createQrMatrix(PAYLOAD, design.logoDataUrl ? "H" : design.ecl);
  const layout = layoutQr(matrix, design);
  const w = Math.ceil(layout.width * scale);
  const h = Math.ceil(layout.height * scale);
  const data = new Uint8ClampedArray(w * h * 4);
  const put = (x: number, y: number, rgb: [number, number, number]) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = (y * w + x) * 4;
    data[i] = rgb[0];
    data[i + 1] = rgb[1];
    data[i + 2] = rgb[2];
    data[i + 3] = 255;
  };
  const color = (fill: string) =>
    hexRgb(fill === "bg" ? design.bg : fill === "eye" ? design.eyeColor || design.fg : design.fg);

  for (const s of layout.shapes) {
    const rgb = color(s.fill);
    if (s.kind === "circle") {
      for (let y = Math.floor((s.cy - s.r) * scale); y <= (s.cy + s.r) * scale; y++) {
        for (let x = Math.floor((s.cx - s.r) * scale); x <= (s.cx + s.r) * scale; x++) {
          if ((x + 0.5 - s.cx * scale) ** 2 + (y + 0.5 - s.cy * scale) ** 2 <= (s.r * scale) ** 2) put(x, y, rgb);
        }
      }
    } else {
      for (let y = Math.round(s.y * scale); y < Math.round((s.y + s.h) * scale); y++) {
        for (let x = Math.round(s.x * scale); x < Math.round((s.x + s.w) * scale); x++) put(x, y, rgb);
      }
    }
  }
  if (layout.logo) {
    // Stand-in for a busy logo: a coarse dark/light checkerboard.
    const { x, y, size } = layout.logo;
    for (let py = Math.round(y * scale); py < (y + size) * scale; py++) {
      for (let px = Math.round(x * scale); px < (x + size) * scale; px++) {
        put(px, py, ((px >> 3) + (py >> 3)) % 2 ? [0, 0, 0] : [255, 255, 255]);
      }
    }
  }
  return { data, w, h };
}

function decode(design: QrDesign): string | null {
  const { data, w, h } = rasterise(design);
  return jsQR(data, w, h)?.data ?? null;
}

describe("QR rendering", () => {
  it("decodes the default design", () => {
    expect(decode(DEFAULT_QR_DESIGN)).toBe(PAYLOAD);
  });

  it.each([
    ["dots + circle eyes", { moduleStyle: "dots", eyeStyle: "circle" }],
    ["rounded + rounded eyes, coloured", { moduleStyle: "rounded", eyeStyle: "rounded", fg: "#0f3d3e", eyeColor: "#7a1f1f" }],
    ["square with centre logo", { logoDataUrl: FAKE_LOGO, logoScale: 0.26 }],
    ["dots with logo and caption", { moduleStyle: "dots", logoDataUrl: FAKE_LOGO, caption: "Scan to pay" }],
  ] as const)("still decodes: %s", (_label, patch) => {
    expect(decode({ ...DEFAULT_QR_DESIGN, ...patch })).toBe(PAYLOAD);
  });

  it("extends the canvas below the code for a caption", () => {
    const m = createQrMatrix(PAYLOAD, "H");
    const plain = layoutQr(m, DEFAULT_QR_DESIGN);
    const withCaption = layoutQr(m, { ...DEFAULT_QR_DESIGN, caption: "Scan to pay" });
    expect(plain.height).toBe(plain.width);
    expect(withCaption.height).toBeGreaterThan(withCaption.width);
  });

  it("emits a self-contained SVG with logo and escaped caption", () => {
    const m = createQrMatrix(PAYLOAD, "H");
    const svg = renderQrSvg(m, { ...DEFAULT_QR_DESIGN, logoDataUrl: FAKE_LOGO, caption: "Tom & Jerry <3" }, 512);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('width="512"');
    expect(svg).toContain("<image");
    expect(svg).toContain("Tom &amp; Jerry &lt;3");
    expect(svg.endsWith("</svg>")).toBe(true);
  });

  it("throws QrCapacityError when content exceeds capacity", () => {
    expect(() => createQrMatrix("x".repeat(3000), "H")).toThrow(QrCapacityError);
  });

  it("flags inverted and low-contrast colour choices", () => {
    expect(designWarnings(DEFAULT_QR_DESIGN)).toEqual([]);
    expect(designWarnings({ ...DEFAULT_QR_DESIGN, fg: "#ffffff", bg: "#000000" }).length).toBeGreaterThan(0);
    expect(designWarnings({ ...DEFAULT_QR_DESIGN, fg: "#bbbbbb" }).some((w) => /contrast/i.test(w))).toBe(true);
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
  });
});
