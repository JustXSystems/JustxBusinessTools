"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BrandingPanel } from "@/components/admin/BrandingPanel";
import { ThemeStudioPanel } from "@/components/admin/ThemeStudioPanel";

type Tab = "theme" | "branding";

export default function ExperienceInner() {
  const search = useSearchParams();
  const router = useRouter();
  const initial = useMemo((): Tab => {
    const t = search.get("tab");
    return t === "branding" ? "branding" : "theme";
  }, [search]);
  const [tab, setTab] = useState<Tab>(initial);

  useEffect(() => {
    setTab(initial);
  }, [initial]);

  function select(next: Tab) {
    setTab(next);
    router.replace(`/admin/experience?tab=${next}`);
  }

  return (
    <div className="admin-page">
      <section className="panel admin-card admin-page-head">
        <h2>Experience</h2>
        <p className="muted">
          Theme tokens and platform branding (logo, splash, footer) for the operator and admin apps.
        </p>
      </section>

      <div className="admin-tabs" role="tablist">
        {(
          [
            ["theme", "Theme"],
            ["branding", "Branding"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            className={tab === id ? "active" : ""}
            onClick={() => select(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "theme" ? (
        <div className="admin-page-body">
          <ThemeStudioPanel />
        </div>
      ) : null}
      {tab === "branding" ? (
        <div className="admin-page-body">
          <BrandingPanel />
        </div>
      ) : null}
    </div>
  );
}
