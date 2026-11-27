"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Badge, Button, Field, FormGrid, Switch } from "@/components/bos";
import { AdminSection } from "@/components/admin/ui";
import { SelectField, TextField } from "@/components/admin/ui/AdminFields";
import type { ToolsSaveHandle } from "@/components/admin/tools-actions";
import { usePlatformConfig } from "@/components/config/ConfigProvider";
import { ensureToolsOnHome, removeToolsFromHome } from "@/lib/admin-home-tools";
import { api } from "@/lib/api";
import { supportsStandaloneApp } from "@/lib/tool-launch";
import { defaultPersonalUsage, getToolDefinition } from "@/config/tools.config";

function clampWidthPct(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return 90;
  return Math.min(100, Math.max(50, Math.round(n)));
}

export const ToolPlacementPane = forwardRef<
  ToolsSaveHandle,
  {
    toolId: string;
    groupName: string;
    available: boolean;
    openStandalone: boolean;
    businessProfileId: number | null;
    onGroupName: (v: string) => void;
    onAvailable: (v: boolean) => void;
    onOpenStandalone: (v: boolean) => void;
    onSaved: (msg: string, tone?: "success" | "error") => void;
  }
>(function ToolPlacementPane(
  {
    toolId,
    groupName,
    available,
    openStandalone,
    businessProfileId,
    onGroupName,
    onAvailable,
    onOpenStandalone,
    onSaved,
  },
  ref,
) {
  const { config, refresh: refreshConfig } = usePlatformConfig();
  const [busy, setBusy] = useState(false);
  const [syncHome, setSyncHome] = useState(true);
  const [contentWidthPct, setContentWidthPct] = useState(90);
  const staticDef = getToolDefinition(toolId);
  const defaultPersonal = defaultPersonalUsage(toolId, staticDef?.type);
  const serverPersonalUsage = config?.toolPersonalUsage?.[toolId] ?? defaultPersonal;
  const [personalUsage, setPersonalUsage] = useState(serverPersonalUsage);
  const personalToolIdRef = useRef(toolId);
  const savedPersonalRef = useRef(serverPersonalUsage);
  const livePersonalRef = useRef(personalUsage);
  livePersonalRef.current = personalUsage;
  const canStandalone = supportsStandaloneApp(toolId);
  const isIms = toolId === "imsdealer";

  useEffect(() => {
    if (personalToolIdRef.current !== toolId) {
      personalToolIdRef.current = toolId;
      savedPersonalRef.current = serverPersonalUsage;
      setPersonalUsage(serverPersonalUsage);
      return;
    }
    if (livePersonalRef.current !== savedPersonalRef.current) return;
    if (serverPersonalUsage !== savedPersonalRef.current) {
      savedPersonalRef.current = serverPersonalUsage;
      setPersonalUsage(serverPersonalUsage);
    }
  }, [toolId, serverPersonalUsage]);

  useEffect(() => {
    if (!isIms) return;
    let cancelled = false;
    void api<{ imsLayout: { contentWidthPct: number } }>("/admin/config/ims-layout")
      .then((layout) => {
        if (!cancelled) setContentWidthPct(clampWidthPct(layout.imsLayout?.contentWidthPct));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [isIms]);

  async function save() {
    setBusy(true);
    try {
      // Platform-wide flag — does not need a Business Profile.
      await api("/admin/config/tool-personal-usage", {
        method: "PUT",
        body: JSON.stringify({ toolId, personalUsage }),
      });
      savedPersonalRef.current = personalUsage;

      if (businessProfileId == null) {
        await refreshConfig().catch(() => undefined);
        onSaved(
          personalUsage
            ? "Personal usage enabled (platform-wide). Select a Business Profile to edit Live/Hidden placement."
            : "Personal usage disabled (platform-wide). Select a Business Profile to edit Live/Hidden placement.",
        );
        return;
      }

      const width = clampWidthPct(contentWidthPct);
      await api(`/admin/catalog/${toolId}`, {
        method: "PUT",
        body: JSON.stringify({
          businessProfileId,
          groupName,
          available,
          ...(canStandalone ? { openStandalone } : {}),
        }),
      });
      if (syncHome) {
        if (available) await ensureToolsOnHome(businessProfileId, [toolId]);
        else await removeToolsFromHome(businessProfileId, [toolId]);
      }
      if (isIms) {
        const layout = await api<{ imsLayout: { contentWidthPct: number } }>("/admin/config/ims-layout", {
          method: "PUT",
          body: JSON.stringify({ contentWidthPct: width }),
        });
        setContentWidthPct(clampWidthPct(layout.imsLayout.contentWidthPct));
      }
      await refreshConfig().catch(() => undefined);
      onSaved(
        canStandalone
          ? isIms
            ? `Placement saved · IMS content width ${width}%. Module ceilings live on Access Fabric.`
            : "Placement saved. Standalone apps open without the Justxsystems menu; refresh home to see the change."
          : "Placement saved. Live tools are added to branch home lists; refresh home to see them.",
      );
    } catch (err) {
      onSaved(err instanceof Error ? err.message : "Save failed", "error");
      throw err;
    } finally {
      setBusy(false);
    }
  }

  async function hide() {
    if (businessProfileId == null) {
      onSaved("Select a Business Profile before changing org placement", "error");
      return;
    }
    setBusy(true);
    try {
      await api(`/admin/catalog/${toolId}?businessProfileId=${businessProfileId}`, {
        method: "DELETE",
      });
      if (syncHome) await removeToolsFromHome(businessProfileId, [toolId]);
      onSaved(
        syncHome
          ? "Tool hidden from the operator home catalog and removed from the home allowlist."
          : "Tool hidden from the operator home catalog.",
      );
    } catch (err) {
      onSaved(err instanceof Error ? err.message : "Hide failed", "error");
    } finally {
      setBusy(false);
    }
  }

  useImperativeHandle(
    ref,
    () => ({
      save,
      isBusy: () => busy,
      label: () => "Save placement",
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- latest props closed over on each render
    [busy, toolId, groupName, available, openStandalone, canStandalone, businessProfileId, contentWidthPct, isIms, syncHome, personalUsage],
  );

  return (
    <AdminSection
      title="Placement"
      description={
        <>
          Org catalog visibility on the operator home screen for the Business Profile selected above. Setting Live also
          adds the tool to that org&apos;s branch home allowlists (when fixed).
          {!businessProfileId ? " Select a Business Profile to edit Live/Hidden." : ""}
          {isIms
            ? " Per-profile IMS left-nav modules are managed on Access Fabric → Tool capabilities."
            : ""}
        </>
      }
      actions={
        <Badge auto tone={businessProfileId == null ? "amber" : available ? "emerald" : "neutral"}>
          {businessProfileId == null ? "No profile" : available ? "Live" : "Hidden"}
        </Badge>
      }
    >
      <div className="admin-cc-form">
        <FormGrid>
          <TextField label="Home group" value={groupName} onChange={(e) => onGroupName(e.target.value)} />
          <SelectField
            label="Visible on home"
            value={available ? "1" : "0"}
            onChange={(e) => onAvailable(e.target.value === "1")}
          >
            <option value="1">Live</option>
            <option value="0">Hidden</option>
          </SelectField>
          <SelectField
            label="Personal usage"
            value={personalUsage ? "1" : "0"}
            onChange={(e) => setPersonalUsage(e.target.value === "1")}
            hint="GSTIN-independent. Personal (no-GSTIN) accounts may only use tools marked Yes. Business users with GSTIN can use every Live tool."
          >
            <option value="1">Yes — allowed for personal accounts</option>
            <option value="0">No — business / GSTIN only</option>
          </SelectField>
          {canStandalone ? (
            <SelectField
              full
              label="Open as"
              value={openStandalone ? "standalone" : "embedded"}
              onChange={(e) => onOpenStandalone(e.target.value === "standalone")}
              hint={`Standalone opens ${toolId === "imsdealer" ? "/ims" : "/bos"} in its own window with its own chrome — the Justxsystems sidebar and header stay on the home tab.`}
            >
              <option value="standalone">Standalone app in a new window (no Justxsystems menu)</option>
              <option value="embedded">Inside Justxsystems Business Tools</option>
            </SelectField>
          ) : null}
          {isIms ? (
            <Field
              full
              label={`Full-screen content width (${contentWidthPct}% of window)`}
              hint="Org-wide chrome for `/ims` (not per profile). Default 90%."
            >
              {({ id, describedBy }) => (
                <input
                  id={id}
                  aria-describedby={describedBy}
                  type="range"
                  min={50}
                  max={100}
                  step={1}
                  value={contentWidthPct}
                  disabled={busy}
                  style={{ width: "100%" }}
                  onChange={(e) => setContentWidthPct(clampWidthPct(e.target.value))}
                  aria-label="IMS full-screen content width percent"
                />
              )}
            </Field>
          ) : null}
        </FormGrid>
        <div className="admin-cc-actions" style={{ justifyContent: "flex-start" }}>
          <span className="admin-cc-switch-row" style={{ paddingBottom: 0 }}>
            <Switch
              checked={syncHome}
              disabled={busy || businessProfileId == null}
              onChange={setSyncHome}
              aria-label="Sync home allowlist"
            />
            Sync home allowlist
          </span>
          <Button variant="secondary" disabled={busy} onClick={() => void hide()}>
            Hide from home
          </Button>
        </div>
      </div>
    </AdminSection>
  );
});
