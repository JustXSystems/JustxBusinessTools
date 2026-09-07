import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { ClientInit } from "@/components/ClientInit";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { BrandingProvider } from "@/components/branding/BrandingProvider";
import { DocumentIconSync } from "@/components/branding/DocumentIconSync";
import { InstallPrompt } from "@/components/pwa/InstallPrompt";
import { ShellRouter } from "@/components/ShellRouter";

// Self-hosted by Next.js (no runtime request to Google Fonts). Only consumed
// when the "JustX BOS" theme preset sets --font-sans/--font-mono to these
// variables — every other preset keeps using system-ui, so this costs
// nothing for tenants who don't switch themes.
const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
  variable: "--font-plex-sans",
  display: "swap",
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "JustXSystems",
  description: "Quotations, invoices, stock, projects, and calculators for Indian businesses.",
  appleWebApp: {
    capable: true,
    title: "JustXSystems",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [{ url: "/icons/justx-logo.png", type: "image/png", sizes: "512x512" }],
    apple: "/icons/justx-logo.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#00dfff",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`h-full ${plexSans.variable} ${plexMono.variable}`}>
      <body className="min-h-full">
        <ClientInit />
        <BrandingProvider>
          <DocumentIconSync />
          <InstallPrompt />
          <AuthProvider>
            <ShellRouter>{children}</ShellRouter>
          </AuthProvider>
        </BrandingProvider>
      </body>
    </html>
  );
}
