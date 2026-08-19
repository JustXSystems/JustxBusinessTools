"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function AdminBranchesRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/admin/profiles");
  }, [router]);
  return <p className="muted">Redirecting to Business Profiles…</p>;
}
