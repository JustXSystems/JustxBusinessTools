import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ClientInit } from "@/components/ClientInit";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { ShellRouter } from "@/components/ShellRouter";

export const metadata: Metadata = {
  title: "JustX Business Tools",
  description: "Quotations, invoices, stock, projects, and calculators for Indian businesses.",
  appleWebApp: {
    capable: true,
    title: "JBT",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: "/icons/jbt-icon.svg",
    apple: "/icons/jbt-icon.svg",
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
        <AuthProvider>
          <ShellRouter>{children}</ShellRouter>
        </AuthProvider>
      </body>
    </html>
  );
}
