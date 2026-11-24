import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Pinway",
  description: "Drop any Google place into your car app.",
  applicationName: "Pinway",
  appleWebApp: {
    capable: true,
    title: "Pinway",
    statusBarStyle: "black-translucent",
  },
  manifest: "/pinway/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: "#0a1f2e",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  maximumScale: 1,
};

export default function PinwayLayout({ children }: { children: React.ReactNode }) {
  return children;
}
