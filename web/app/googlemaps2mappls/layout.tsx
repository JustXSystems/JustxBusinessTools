import type { Metadata, Viewport } from "next";
import { buildForcePhoneInlineScript } from "@jbt/shared";
import { getBasePath } from "@/lib/base-path";

const base = getBasePath();
const svgIconPath = `${base}/icons/Google2MapplsMap/justx-mappls-india-icon.svg`;
const faviconPath = `${base}/icons/Google2MapplsMap/favicon.ico`;
const icon32Path = `${base}/icons/Google2MapplsMap/justx-mappls-india-icon-32.png`;
const icon64Path = `${base}/icons/Google2MapplsMap/justx-mappls-india-icon-64.png`;
const icon128Path = `${base}/icons/Google2MapplsMap/justx-mappls-india-icon-128.png`;
const icon256Path = `${base}/icons/Google2MapplsMap/justx-mappls-india-icon-256.png`;
const icon512Path = `${base}/icons/Google2MapplsMap/justx-mappls-india-icon-512.png`;
const icon1024Path = `${base}/icons/Google2MapplsMap/justx-mappls-india-icon-1024.png`;
const manifestPath = `${base}/googlemaps2mappls/manifest`;

export const metadata: Metadata = {
  title: "Google Maps to Mappls | GoogleMaps2Mappls",
  description:
    "Convert a Google Maps share link, address, or lat/lng to a Mappls Pin and open your car companion app (Adrenox, Me4U, Bluelink, and more).",
  applicationName: "GoogleMaps2Mappls",
  keywords: [
    "Google Maps to Mappls",
    "GoogleMaps2Mappls",
    "convert Google Maps to Mappls",
    "Google Maps link to Mappls Pin",
    "Mappls Pin converter",
    "send Google Maps to car India",
  ],
  appleWebApp: {
    capable: true,
    title: "GoogleMaps2Mappls",
    statusBarStyle: "black-translucent",
  },
  openGraph: {
    title: "Google Maps to Mappls",
    description: "Convert a Google Maps link to a Mappls Pin and open your car app.",
    siteName: "GoogleMaps2Mappls",
    images: [{ url: icon1024Path, width: 1024, height: 1024, alt: "GoogleMaps2Mappls" }],
  },
  icons: {
    icon: [
      { url: svgIconPath, type: "image/svg+xml" },
      { url: faviconPath, sizes: "any" },
      { url: icon32Path, type: "image/png", sizes: "32x32" },
      { url: icon64Path, type: "image/png", sizes: "64x64" },
      { url: icon128Path, type: "image/png", sizes: "128x128" },
      { url: icon256Path, type: "image/png", sizes: "256x256" },
      { url: icon512Path, type: "image/png", sizes: "512x512" },
    ],
    shortcut: faviconPath,
    apple: [{ url: icon512Path, sizes: "512x512", type: "image/png" }],
  },
  manifest: manifestPath,
};

export const viewport: Viewport = {
  themeColor: "#4854EB",
  width: "device-width",
  initialScale: 1,
  minimumScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

/** Pinway reinforces the root phone lock before paint (native full-bleed shell). */
const FORCE_PHONE_SCRIPT = buildForcePhoneInlineScript();

export default function GoogleMaps2MapplsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: FORCE_PHONE_SCRIPT }} />
      <div className="pinway-route-root">{children}</div>
    </>
  );
}
