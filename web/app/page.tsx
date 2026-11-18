"use client";

import { useSearchParams } from "next/navigation";
import { HomeDashboard } from "@/components/home/HomeDashboard";
import { PublicHomePage } from "@/components/public-home/PublicHomePage";
import { useAuth } from "@/components/auth/AuthProvider";
import { SplashMark, EmptySplash } from "@/components/auth/SplashScreen";
import { usePlatformBranding } from "@/components/branding/BrandingProvider";
import { isPublicHomePreview } from "@/lib/auth-access";

export default function HomePage() {
  const { user, loading } = useAuth();
  const searchParams = useSearchParams();
  const { branding, loading: brandingLoading } = usePlatformBranding();
  const previewPublic = isPublicHomePreview("/", searchParams);

  if (loading) {
    return brandingLoading ? <EmptySplash /> : <SplashMark branding={branding} />;
  }

  if (user && !previewPublic) {
    return <HomeDashboard />;
  }

  return <PublicHomePage />;
}
