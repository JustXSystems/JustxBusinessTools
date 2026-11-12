import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Justxsystems BOS — Business Operating System",
  description: "Finance, GST invoicing, HR and projects — connected to your Justxsystems Business Tools.",
};

export default function BosLayout({ children }: { children: React.ReactNode }) {
  return children;
}
