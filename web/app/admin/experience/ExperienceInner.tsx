"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BrandingPanel } from "@/components/admin/BrandingPanel";
import { ThemeStudioPanel } from "@/components/admin/ThemeStudioPanel";
import type { ExperienceSaveHandle } from "@/components/admin/experience-save";

type Tab = "theme" | "branding";

export default function ExperienceInner() {
  const search = useSearchParams();
  const router = useRouter();
  const themeSaveRef = useRef<ExperienceSaveHandle>(null);
  const brandingSaveRef = useRef<ExperienceSaveHandle>(null);
  const [saving, setSaving] = useState(false);
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

  async function saveActive() {
    const handle = tab === "theme" ? themeSaveRef.current : brandingSaveRef.current;
    if (!handle) return;
    setSaving(true);
    try {
      await handle.save();
    } catch {
      /* panel surfaces its own error message */
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="admin-page">
      <section className="panel admin-card admin-page-head">
        <h2>Experience</h2>
        <p className="muted">
          Theme tokens and platform branding (logo, splash, footer) for the operator and admin apps.
        </p>
      </section>

      <div className="admin-tabs-bar">
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
        <div className="admin-tabs-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={saving}
            onClick={() => void saveActive()}
          >
            {saving ? "Saving…" : tab === "theme" ? "Save & activate" : "Save changes"}
          </button>
        </div>
      </div>

      {tab === "theme" ? (
        <div className="admin-page-body">
          <ThemeStudioPanel ref={themeSaveRef} />
        </div>
      ) : null}
      {tab === "branding" ? (
        <div className="admin-page-body">
          <BrandingPanel ref={brandingSaveRef} />
        </div>
      ) : null}
    </div>
  );
}
