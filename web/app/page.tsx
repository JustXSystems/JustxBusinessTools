"use client";

import { HomeDashboard } from "@/components/home/HomeDashboard";
import { PublicHomePage } from "@/components/public-home/PublicHomePage";
import { useAuth } from "@/components/auth/AuthProvider";
import { SplashMark, EmptySplash } from "@/components/auth/SplashScreen";
import { usePlatformBranding } from "@/components/branding/BrandingProvider";

export default function HomePage() {
  const { user, loading } = useAuth();
  const { branding, loading: brandingLoading } = usePlatformBranding();

  if (loading) {
    return brandingLoading ? <EmptySplash /> : <SplashMark branding={branding} />;
  }

  if (user) {
    return <HomeDashboard />;
  }

  return <PublicHomePage />;
}
