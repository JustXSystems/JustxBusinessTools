"use client";

import { Suspense } from "react";
import { AdminPageSkeleton } from "@/components/admin/ui";
import ExperienceInner from "./ExperienceInner";

export default function AdminExperiencePage() {
  return (
    <Suspense fallback={<AdminPageSkeleton cards={3} />}>
      <ExperienceInner />
    </Suspense>
  );
}
