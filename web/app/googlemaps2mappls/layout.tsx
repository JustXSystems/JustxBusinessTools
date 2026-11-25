import type { Metadata, Viewport } from "next";
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

/** Runs before paint: force phone class + explicit screen-width viewport (not device-width). */
const FORCE_PHONE_SCRIPT = `(function(){try{var s=Math.min(screen.width||0,screen.height||0);var c=window.matchMedia("(pointer: coarse)").matches;var n=window.matchMedia("(hover: none)").matches;var phone=(c&&n)||(s>0&&s<700);if(phone)document.documentElement.classList.add("g2m-force-phone");var m=document.querySelector('meta[name="viewport"]');if(!m){m=document.createElement("meta");m.setAttribute("name","viewport");document.head.appendChild(m);}var w=(s>0&&s<700)?Math.round(s):Math.round(Math.min(window.innerWidth||390,430));m.setAttribute("content",phone?("width="+w+", initial-scale=1, maximum-scale=1, minimum-scale=1, user-scalable=no, viewport-fit=cover, interactive-widget=resizes-content"):"width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover, interactive-widget=resizes-content");var vv=window.visualViewport;var h=vv?Math.round(vv.height):window.innerHeight;var o=vv?Math.round(vv.offsetTop):0;document.documentElement.style.setProperty("--g2m-vvh",h+"px");document.documentElement.style.setProperty("--g2m-vv-offset",o+"px");}catch(e){}})();`;

export default function GoogleMaps2MapplsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: FORCE_PHONE_SCRIPT }} />
      <div className="pinway-route-root">{children}</div>
    </>
  );
}
