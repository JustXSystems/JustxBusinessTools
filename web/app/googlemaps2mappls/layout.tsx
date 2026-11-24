import type { Metadata, Viewport } from "next";

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
    images: [{ url: "/icons/googlemaps2mappls-icon.png", width: 512, height: 512, alt: "GoogleMaps2Mappls" }],
  },
  icons: {
    icon: [{ url: "/icons/googlemaps2mappls-icon.png", type: "image/png", sizes: "512x512" }],
    apple: "/icons/googlemaps2mappls-icon.png",
  },
  manifest: "/googlemaps2mappls/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: "#4854EB",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function GoogleMaps2MapplsLayout({ children }: { children: React.ReactNode }) {
  return <div className="pinway-route-root">{children}</div>;
}
