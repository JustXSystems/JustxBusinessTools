"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Alert, Badge, Button } from "@/components/bos";
import { AdminPage, AdminTabs } from "@/components/admin/ui";
import { BrandingPanel } from "@/components/admin/BrandingPanel";
import { ThemeStudioPanel } from "@/components/admin/ThemeStudioPanel";
import { PublicHomePanel } from "@/components/admin/PublicHomePanel";
import type { ExperienceSaveHandle } from "@/components/admin/experience-save";

type Tab = "theme" | "branding" | "public-home";

const TAB_OPTIONS: ReadonlyArray<{ value: Tab; label: string }> = [
  { value: "theme", label: "Theme" },
  { value: "branding", label: "Branding" },
  { value: "public-home", label: "Public home" },
];

const TAB_TITLE: Record<Tab, string> = {
  theme: "Theme studio",
  branding: "Platform branding",
  "public-home": "Guest public home",
};

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
    <AdminPage
      title="Experience"
      section="Product"
      sub={`${TAB_TITLE[tab]} · theme · branding · public home`}
      toolbar={
        <>
          <Badge auto tone="blue">
            {TAB_TITLE[tab]}
          </Badge>
          <AdminTabs aria-label="Experience section" options={TAB_OPTIONS} value={tab} onChange={select} />
          <Button variant="primary" size="sm" disabled={saving} onClick={() => void saveActive()}>
            {saving ? "Saving…" : saveLabel}
          </Button>
        </>
      }
    >
      <Alert tone="blue" title="Operators keep the normal tool home">
        Theme tokens, platform branding, and the guest public home. Logged-in operators always keep the normal tool
        home.
      </Alert>

      {tab === "theme" ? <ThemeStudioPanel ref={themeSaveRef} /> : null}
      {tab === "branding" ? <BrandingPanel ref={brandingSaveRef} /> : null}
      {tab === "public-home" ? <PublicHomePanel ref={publicHomeSaveRef} /> : null}
    </AdminPage>
  );
}
