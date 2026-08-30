import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign in - JustXSystems",
  description: "Sign in to JustXSystems",
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
