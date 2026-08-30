import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import {
  isTransparentInstallBg,
  parseInstallIconBg,
} from "@/lib/install-branding";
import {
  absoluteIconFetchUrl,
  brandingIconVersion,
  iconMimeFromUrl,
  loadPlatformBrandingFresh,
  resolveInstallIconUrl,
  resolveInstallName,
} from "@/lib/pwa-branding";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Ctx = { params: Promise<{ size: string }> };

function parseSize(raw: string): 192 | 512 {
  return raw === "192" ? 192 : 512;
}

function withHeaders(res: Response, headers: Record<string, string>) {
  for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
  return res;
}

async function loadIconBytes(icon: string): Promise<{ bytes: Buffer; mime: string } | null> {
  const rel = icon.split("?")[0];
  // Prefer reading public/ assets from disk (no self-HTTP).
  if (rel.startsWith("/icons/")) {
    try {
      const file = path.join(process.cwd(), "public", rel.replace(/^\//, ""));
      const bytes = await readFile(file);
      return { bytes, mime: iconMimeFromUrl(rel) };
    } catch {
      /* fall through to HTTP */
    }
  }

  try {
    const abs = absoluteIconFetchUrl(icon);
    const upstream = await fetch(abs, { cache: "no-store" });
    if (!upstream.ok) return null;
    const mime = iconMimeFromUrl(icon, upstream.headers.get("content-type") || "image/png");
    const bytes = Buffer.from(await upstream.arrayBuffer());
    if (!bytes.length) return null;
    return { bytes, mime };
  } catch {
    return null;
  }
}

async function brandFallbackPng(size: 192 | 512, label: string, bg: string) {
  const transparent = isTransparentInstallBg(bg);
  const canvasBg = transparent ? "#0B2E2F" : bg;
  const mark =
    canvasBg.toUpperCase() === "#FFFFFF" || canvasBg.toUpperCase() === "#FBF9F4"
      ? "#0B2E2F"
      : "#FBF9F4";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: canvasBg,
          color: mark,
          fontWeight: 700,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
          <div style={{ color: "#F2A93B", fontSize: Math.round(size * 0.34) }}>JX</div>
          <div
            style={{
              width: Math.round(size * 0.28),
              height: Math.max(4, Math.round(size * 0.02)),
              background: "#F2A93B",
              borderRadius: 999,
            }}
          />
          {size >= 512 ? (
            <div style={{ fontSize: Math.round(size * 0.06), color: mark, opacity: 0.7 }}>
              {label.slice(0, 18)}
            </div>
          ) : null}
        </div>
      </div>
    ),
    { width: size, height: size },
  );
}

/**
 * Always emit exact 192/512 PNGs for Chrome's install dialog.
 * Embeds image bytes as data URLs so rendering does not depend on ImageResponse
 * being able to fetch /api/files over HTTP.
 */
export async function GET(_req: Request, ctx: Ctx) {
  const { size: sizeRaw } = await ctx.params;
  const size = parseSize(sizeRaw);
  const branding = await loadPlatformBrandingFresh();
  const name = resolveInstallName(branding.appName, branding.installName);
  const icon = resolveInstallIconUrl(branding.logoUrl, branding.installIconUrl);
  const bg = parseInstallIconBg(branding.installIconBg);
  const transparent = isTransparentInstallBg(bg);
  const version = brandingIconVersion(branding);
  const headers = {
    "Cache-Control": "no-store, max-age=0, must-revalidate",
    "X-Install-Icon-Version": version,
    "X-Install-Icon-Source": icon,
  };

  const loaded = await loadIconBytes(icon);
  if (!loaded || loaded.mime.includes("svg")) {
    return withHeaders(await brandFallbackPng(size, name, bg), headers);
  }

  const dataUrl = `data:${loaded.mime};base64,${loaded.bytes.toString("base64")}`;
  const canvasBg = transparent ? "rgba(0,0,0,0)" : bg;
  const pad = Math.round(size * 0.06);
  const inner = size - pad * 2;

  try {
    const rendered = new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: canvasBg,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={dataUrl}
            alt=""
            width={inner}
            height={inner}
            style={{ objectFit: "contain", width: inner, height: inner }}
          />
        </div>
      ),
      { width: size, height: size },
    );
    return withHeaders(rendered, headers);
  } catch {
    return withHeaders(await brandFallbackPng(size, name, bg), headers);
  }
}
