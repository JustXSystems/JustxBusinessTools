import type { Metadata, Viewport } from "next";
import { buildForcePhoneInlineScript } from "@jbt/shared";
import { getBasePath } from "@/lib/base-path";

const base = getBasePath();
const iconPath = `${base}/icons/googlemaps2mappls-icon.png`;
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
    images: [{ url: iconPath, width: 512, height: 512, alt: "GoogleMaps2Mappls" }],
  },
  icons: {
    icon: [{ url: iconPath, type: "image/png", sizes: "512x512" }],
    apple: iconPath,
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
