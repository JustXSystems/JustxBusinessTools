import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Justx IMS — Dealer",
  description: "Inventory, purchasing, GST sales, receivables and field ops for dealers — connected to your Justx Business Tools.",
};

export default function ImsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
