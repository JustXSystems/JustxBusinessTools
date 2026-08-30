import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ClientInit } from "@/components/ClientInit";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { BrandingProvider } from "@/components/branding/BrandingProvider";
import { DocumentIconSync } from "@/components/branding/DocumentIconSync";
import { InstallPrompt } from "@/components/pwa/InstallPrompt";
import { ShellRouter } from "@/components/ShellRouter";

export const metadata: Metadata = {
  title: "JustXSystems",
  description: "Quotations, invoices, stock, projects, and calculators for Indian businesses.",
  appleWebApp: {
    capable: true,
    title: "JustXSystems",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [{ url: "/icons/presets/justx-mark.png", type: "image/png", sizes: "512x512" }],
    apple: "/icons/presets/justx-mark.png",
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
    <html lang="en" className="h-full">
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
