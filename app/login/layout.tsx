import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign in - JustX Business Tools",
  description: "Sign in to JustX Business Tools",
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
