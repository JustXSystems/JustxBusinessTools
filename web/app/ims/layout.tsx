import type { Metadata, Viewport } from "next";
import { getBasePath } from "@/lib/base-path";

const base = getBasePath();
const svgIconPath = `${base}/IMS/icons/justx-invoice-icon.svg`;
const faviconPath = `${base}/IMS/icons/favicon.ico`;
const icon512Path = `${base}/IMS/icons/justx-invoice-icon-512.png`;
const icon1024Path = `${base}/IMS/icons/justx-invoice-icon-1024.png`;
const manifestPath = `${base}/ims/manifest`;

export const metadata: Metadata = {
  title: "Justxsystems IMS — Dealer",
  description:
    "Inventory, purchasing, GST sales, receivables and field ops for dealers — connected to your Justxsystems Business Tools.",
  applicationName: "Justxsystems IMS",
  appleWebApp: {
    capable: true,
    title: "Justxsystems IMS",
    statusBarStyle: "default",
  },
  openGraph: {
    title: "Justxsystems IMS — Dealer",
    description:
      "Inventory, purchasing, GST sales, receivables and field ops for dealers — connected to your Justxsystems Business Tools.",
    siteName: "Justxsystems IMS",
    images: [{ url: icon1024Path, width: 1024, height: 1024, alt: "Justxsystems IMS" }],
  },
  icons: {
    icon: [
      { url: svgIconPath, type: "image/svg+xml" },
      { url: faviconPath, sizes: "any" },
      { url: icon512Path, type: "image/png", sizes: "512x512" },
    ],
    shortcut: faviconPath,
    apple: [{ url: icon512Path, sizes: "512x512", type: "image/png" }],
  },
  manifest: manifestPath,
};

export const viewport: Viewport = {
  themeColor: "#0A33FF",
};

export default function ImsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
