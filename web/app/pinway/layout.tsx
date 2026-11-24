import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Google Maps to Mappls",
  robots: { index: false, follow: true },
};

export default function PinwayLegacyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
