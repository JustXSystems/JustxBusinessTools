"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BrandingPanel } from "@/components/admin/BrandingPanel";
import { ThemeStudioPanel } from "@/components/admin/ThemeStudioPanel";
import { PublicHomePanel } from "@/components/admin/PublicHomePanel";
import type { ExperienceSaveHandle } from "@/components/admin/experience-save";

type Tab = "theme" | "branding" | "public-home";

export default function ExperienceInner() {
  const search = useSearchParams();
  const router = useRouter();
  const themeSaveRef = useRef<ExperienceSaveHandle>(null);
  const brandingSaveRef = useRef<ExperienceSaveHandle>(null);
  const publicHomeSaveRef = useRef<ExperienceSaveHandle>(null);
  const [saving, setSaving] = useState(false);
  const initial = useMemo((): Tab => {
    const t = search.get("tab");
    if (t === "branding") return "branding";
    if (t === "public-home") return "public-home";
    return "theme";
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
    const handle =
      tab === "theme"
        ? themeSaveRef.current
        : tab === "branding"
          ? brandingSaveRef.current
          : publicHomeSaveRef.current;
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

  const saveLabel =
    tab === "theme" ? "Save & activate" : tab === "public-home" ? "Save public home" : "Save changes";

  return (
    <div className="admin-page">
      <section className="panel admin-card admin-page-head">
        <h2>Experience</h2>
        <p className="muted">
          Theme tokens, platform branding, and the guest public home. Logged-in operators always keep
          the normal tool home; public home is off until you enable it under Public home.
        </p>
      </section>

      <div className="admin-tabs-bar">
        <div className="admin-tabs" role="tablist">
          {(
            [
              ["theme", "Theme"],
              ["branding", "Branding"],
              ["public-home", "Public home"],
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
            {saving ? "Saving…" : saveLabel}
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
      {tab === "public-home" ? (
        <div className="admin-page-body">
          <PublicHomePanel ref={publicHomeSaveRef} />
        </div>
      ) : null}
    </div>
  );
}
