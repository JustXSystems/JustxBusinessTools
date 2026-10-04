import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Justx BOS — Business Operating System",
  description: "Finance, GST invoicing, HR and projects — connected to your Justx Business Tools.",
};

export default function BosLayout({ children }: { children: React.ReactNode }) {
  return children;
}
