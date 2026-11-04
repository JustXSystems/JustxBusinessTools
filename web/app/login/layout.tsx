import type { Metadata } from "next";
import { BRAND_DEFAULTS } from "@jbt/shared";

export const metadata: Metadata = {
  title: `Sign in - ${BRAND_DEFAULTS.appName}`,
  description: `Sign in to ${BRAND_DEFAULTS.appName}`,
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
