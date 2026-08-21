"use client";

import { Suspense } from "react";
import ExperienceInner from "./ExperienceInner";

export default function AdminExperiencePage() {
  return (
    <Suspense
      fallback={
        <div className="admin-page">
          <p className="muted">Loading experience…</p>
        </div>
      }
    >
      <ExperienceInner />
    </Suspense>
  );
}
