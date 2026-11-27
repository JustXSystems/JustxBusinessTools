import type { Metadata, Viewport } from "next";

const base = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/$/, "");
const svgFaviconPath = `${base}/icons/BOS/web/bos-favicon.svg`;
const icoFaviconPath = `${base}/icons/BOS/web/favicon.ico`;
const favicon16Path = `${base}/icons/BOS/web/favicon-16x16.png`;
const favicon32Path = `${base}/icons/BOS/web/favicon-32x32.png`;
const favicon48Path = `${base}/icons/BOS/web/favicon-48x48.png`;
const favicon96Path = `${base}/icons/BOS/web/favicon-96x96.png`;
const appleTouchPath = `${base}/icons/BOS/web/apple-touch-icon.png`;
const pinnedTabPath = `${base}/icons/BOS/web/safari-pinned-tab.svg`;
const og1024Path = `${base}/icons/BOS/png/app-light/bos-app-light-1024.png`;

export const metadata: Metadata = {
  title: "Justxsystems BOS — Business Operating System",
  description: "Finance, GST invoicing, HR and projects — connected to your Justxsystems Business Tools.",
  manifest: `${base}/bos/manifest`,
  icons: {
    icon: [
      { url: svgFaviconPath, type: "image/svg+xml" },
      { url: icoFaviconPath, sizes: "any" },
      { url: favicon16Path, sizes: "16x16", type: "image/png" },
      { url: favicon32Path, sizes: "32x32", type: "image/png" },
      { url: favicon48Path, sizes: "48x48", type: "image/png" },
      { url: favicon96Path, sizes: "96x96", type: "image/png" },
    ],
    shortcut: [{ url: icoFaviconPath }],
    apple: [{ url: appleTouchPath, sizes: "180x180", type: "image/png" }],
    other: [{ rel: "mask-icon", url: pinnedTabPath, color: "#0A1348" }],
  },
  appleWebApp: {
    capable: true,
    title: "Justxsystems BOS",
    statusBarStyle: "default",
  },
  openGraph: {
    title: "Justxsystems BOS — Business Operating System",
    description: "Finance, GST invoicing, HR and projects — connected to your Justxsystems Business Tools.",
    images: [{ url: og1024Path, width: 1024, height: 1024, alt: "Justxsystems BOS" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#0A1348",
};

export default function BosLayout({ children }: { children: React.ReactNode }) {
  return children;
}
