"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Badge, BlockLabel, Button, Field, FormGrid } from "@/components/bos";
import { AdminSection } from "@/components/admin/ui";
import { SelectField, TextField } from "@/components/admin/ui/AdminFields";
import type { ToolsSaveHandle } from "@/components/admin/tools-actions";
import { usePlatformConfig } from "@/components/config/ConfigProvider";
import { ToolIconMark } from "@/components/common/ToolIconMark";
import { api } from "@/lib/api";
import { getToolDefinition } from "@/config/tools.config";
import type { ToolIconConfig, ToolIconShape } from "@/lib/tool-icons";

type IconFormState = {
  light: string;
  dark: string;
  favicon: string;
  appleTouch: string;
  size192: string;
  size512: string;
  size1024: string;
  bg: string;
  shape: "" | ToolIconShape;
  paddingPx: string;
};

function formFromConfig(cfg: ToolIconConfig | undefined): IconFormState {
  return {
    light: cfg?.light ?? "",
    dark: cfg?.dark ?? "",
    favicon: cfg?.favicon ?? "",
    appleTouch: cfg?.appleTouch ?? "",
    size192: cfg?.size192 ?? "",
    size512: cfg?.size512 ?? "",
    size1024: cfg?.size1024 ?? "",
    bg: cfg?.bg ?? "",
    shape: cfg?.shape ?? "",
    paddingPx: cfg?.paddingPx != null ? String(cfg.paddingPx) : "",
  };
}

function previewConfigFromForm(f: IconFormState): ToolIconConfig {
  const pad = f.paddingPx.trim() === "" ? undefined : Math.min(12, Math.max(0, Math.round(Number(f.paddingPx) || 0)));
  return {
    light: f.light.trim() || undefined,
    dark: f.dark.trim() || undefined,
    favicon: f.favicon.trim() || undefined,
    appleTouch: f.appleTouch.trim() || undefined,
    size192: f.size192.trim() || undefined,
    size512: f.size512.trim() || undefined,
    size1024: f.size1024.trim() || undefined,
    bg: f.bg.trim() || undefined,
    shape: f.shape || undefined,
    paddingPx: pad,
  };
}

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const ACCEPT_ICONS = "image/svg+xml,image/png,image/webp,image/x-icon,image/vnd.microsoft.icon,.ico,image/jpeg,image/gif";

function IconSlotInput({
  label,
  hint,
  value,
  placeholder,
  onChange,
  onError,
}: {
  label: string;
  hint: string;
  value: string;
  placeholder: string;
  onChange: (next: string) => void;
  onError: (msg: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  function handleFile(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      onError("Icon file must be 2 MB or smaller.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") onChange(reader.result);
    };
    reader.readAsDataURL(file);
  }

  return (
    <div style={{ display: "grid", gap: 6 }}>
      <TextField
        label={label}
        hint={hint}
        value={value.startsWith("data:") ? "(uploaded image ready to save)" : value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      <div className="admin-cc-actions" style={{ justifyContent: "flex-start" }}>
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT_ICONS}
          style={{ display: "none" }}
          onChange={(e) => {
            handleFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <Button size="sm" variant="secondary" type="button" onClick={() => fileRef.current?.click()}>
          Upload file
        </Button>
        {value ? (
          <Button size="sm" variant="ghost" type="button" onClick={() => onChange("")}>
            Clear
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export const ToolIconsPane = forwardRef<
  ToolsSaveHandle,
  {
    toolId: string;
    toolName: string;
    onSaved: (msg: string, tone?: "success" | "error") => void;
  }
>(function ToolIconsPane({ toolId, toolName, onSaved }, ref) {
  const { config, refresh: refreshConfig } = usePlatformConfig();
  const serverCfg = config?.toolIcons?.[toolId];
  const builtinIcon = getToolDefinition(toolId)?.icon ?? "📋";

  const [form, setForm] = useState<IconFormState>(() => formFromConfig(serverCfg));
  const [busy, setBusy] = useState(false);

  const syncedToolIdRef = useRef(toolId);
  const savedSnapRef = useRef(JSON.stringify(formFromConfig(serverCfg)));
  const liveFormRef = useRef(form);
  liveFormRef.current = form;

  useEffect(() => {
    const next = formFromConfig(serverCfg);
    const nextSnap = JSON.stringify(next);
    if (syncedToolIdRef.current !== toolId) {
      syncedToolIdRef.current = toolId;
      savedSnapRef.current = nextSnap;
      setForm(next);
      return;
    }
    const isDirty = JSON.stringify(liveFormRef.current) !== savedSnapRef.current;
    if (isDirty) return;
    if (nextSnap !== savedSnapRef.current) {
      savedSnapRef.current = nextSnap;
      setForm(next);
    }
  }, [toolId, serverCfg]);

  const dirty = JSON.stringify(form) !== savedSnapRef.current;
  const previewCfg = previewConfigFromForm(form);

  async function save() {
    setBusy(true);
    try {
      const payload = {
        light: form.light.trim(),
        dark: form.dark.trim(),
        favicon: form.favicon.trim(),
        appleTouch: form.appleTouch.trim(),
        size192: form.size192.trim(),
        size512: form.size512.trim(),
        size1024: form.size1024.trim(),
        bg: form.bg.trim(),
        shape: form.shape || "",
        paddingPx: form.paddingPx.trim() === "" ? "" : Number(form.paddingPx),
      };
      const res = await api<{ icon: ToolIconConfig | null }>(
        `/admin/config/tool-icons/${encodeURIComponent(toolId)}`,
        { method: "PUT", body: JSON.stringify(payload) },
      );
      const next = formFromConfig(res.icon ?? undefined);
      savedSnapRef.current = JSON.stringify(next);
      setForm(next);
      await refreshConfig().catch(() => undefined);
      onSaved(`Icons saved for ${toolName}.`);
    } catch (err) {
      onSaved(err instanceof Error ? err.message : "Failed to save tool icons", "error");
      throw err;
    } finally {
      setBusy(false);
    }
  }

  async function resetDefaults() {
    setBusy(true);
    try {
      await api(`/admin/config/tool-icons/${encodeURIComponent(toolId)}`, { method: "DELETE" });
      const empty = formFromConfig(undefined);
      savedSnapRef.current = JSON.stringify(empty);
      setForm(empty);
      await refreshConfig().catch(() => undefined);
      onSaved(`Reset ${toolName} icons to built-in default.`);
    } catch (err) {
      onSaved(err instanceof Error ? err.message : "Failed to reset icons", "error");
    } finally {
      setBusy(false);
    }
  }

  useImperativeHandle(
    ref,
    () => ({
      save,
      isBusy: () => busy,
      isDirty: () => dirty,
      label: () => "Save icons",
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [busy, dirty, form, toolId, toolName],
  );

  const previewSizes: ReadonlyArray<{ px: number; label: string; hint: "favicon" | "sm" | "md" | "lg" }> = [
    { px: 16, label: "16px tab", hint: "favicon" },
    { px: 24, label: "24px chip", hint: "sm" },
    { px: 40, label: "40px card", hint: "md" },
    { px: 64, label: "64px app", hint: "lg" },
  ];

  return (
    <AdminSection
      title="Icons & favicon"
      description="Configure light/dark mode icons, browser favicon, Apple touch icon, and size variants for this tool. Upload SVG, PNG, WebP, or ICO (max 2 MB) or enter a public path / URL / emoji."
      actions={
        <>
          {dirty ? (
            <Badge auto tone="amber">
              Unsaved
            </Badge>
          ) : null}
          <Button size="sm" variant="ghost" type="button" disabled={busy} onClick={() => void resetDefaults()}>
            Reset to default
          </Button>
        </>
      }
    >
      <div className="admin-cc-form">
        <BlockLabel>Live preview (Light &amp; Dark)</BlockLabel>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
          {(["light", "dark"] as const).map((mode) => (
            <div
              key={mode}
              style={{
                padding: 14,
                borderRadius: 12,
                border: mode === "dark" ? "1px solid #27324d" : "1px solid var(--bos-border-soft)",
                background: mode === "dark" ? "#0b1224" : "#f8fafc",
                color: mode === "dark" ? "#e2e8f0" : "#0f172a",
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", opacity: 0.7, marginBottom: 10 }}>
                {mode === "light" ? "Light mode" : "Dark mode"}
              </div>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
                {previewSizes.map((s) => (
                  <div key={s.label} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                    <div
                      style={{
                        display: "grid",
                        placeItems: "center",
                        minWidth: s.px,
                        minHeight: s.px,
                      }}
                    >
                      <ToolIconMark
                        toolId={toolId}
                        fallback={builtinIcon}
                        size={s.px}
                        sizeHint={s.hint}
                        override={previewCfg}
                        themeOverride={mode}
                      />
                    </div>
                    <span style={{ fontSize: 10.5, opacity: 0.7 }}>{s.label}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <BlockLabel>Theme icons</BlockLabel>
        <FormGrid>
          <IconSlotInput
            label="Light / Default icon"
            hint="Used on Home cards, tool headers, picker, and standalone brand mark."
            value={form.light}
            placeholder={builtinIcon}
            onChange={(v) => setForm((f) => ({ ...f, light: v }))}
            onError={(m) => onSaved(m, "error")}
          />
          <IconSlotInput
            label="Dark mode icon (optional)"
            hint="Automatically shown when dark theme is active. Falls back to Light icon."
            value={form.dark}
            placeholder="Optional dark-mode SVG / PNG / emoji"
            onChange={(v) => setForm((f) => ({ ...f, dark: v }))}
            onError={(m) => onSaved(m, "error")}
          />
        </FormGrid>

        <BlockLabel>Browser favicon &amp; iOS touch icon</BlockLabel>
        <FormGrid>
          <IconSlotInput
            label="Favicon (.ico / .svg / .png)"
            hint="Applied to the browser tab when this tool or its standalone app is open."
            value={form.favicon}
            placeholder="/IMS/icons/favicon.ico"
            onChange={(v) => setForm((f) => ({ ...f, favicon: v }))}
            onError={(m) => onSaved(m, "error")}
          />
          <IconSlotInput
            label="Apple Touch Icon (iOS)"
            hint="Used when users Add to Home Screen on iOS / iPadOS (180–512px PNG)."
            value={form.appleTouch}
            placeholder="/IMS/icons/justx-invoice-icon-512.png"
            onChange={(v) => setForm((f) => ({ ...f, appleTouch: v }))}
            onError={(m) => onSaved(m, "error")}
          />
        </FormGrid>

        <BlockLabel>Resolution variants (optional)</BlockLabel>
        <FormGrid>
          <IconSlotInput
            label="192 × 192 (PWA / compact)"
            hint="Crisp medium-resolution icon for install prompts and compact tiles."
            value={form.size192}
            placeholder="Optional 192px PNG/WebP"
            onChange={(v) => setForm((f) => ({ ...f, size192: v }))}
            onError={(m) => onSaved(m, "error")}
          />
          <IconSlotInput
            label="512 × 512 (PWA / splash)"
            hint="Standard high-DPI icon for app launchers and splash screens."
            value={form.size512}
            placeholder="Optional 512px PNG/WebP"
            onChange={(v) => setForm((f) => ({ ...f, size512: v }))}
            onError={(m) => onSaved(m, "error")}
          />
          <IconSlotInput
            label="1024 × 1024 (High-res / OpenGraph)"
            hint="High-resolution artwork for social share cards and marketing."
            value={form.size1024}
            placeholder="Optional 1024px PNG/WebP"
            onChange={(v) => setForm((f) => ({ ...f, size1024: v }))}
            onError={(m) => onSaved(m, "error")}
          />
        </FormGrid>

        <BlockLabel>Tile presentation</BlockLabel>
        <FormGrid>
          <Field
            label="Tile background"
            hint="Leave blank or transparent for no fill, or pick a hex color."
          >
            {({ id }) => (
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="color"
                  aria-label="Tile background color picker"
                  value={/^#[0-9a-fA-F]{6}$/.test(form.bg) ? form.bg : "#091758"}
                  onChange={(e) => setForm((f) => ({ ...f, bg: e.target.value.toUpperCase() }))}
                  style={{ width: 38, height: 34, padding: 2, borderRadius: 6, border: "1px solid var(--bos-border-soft)", background: "transparent", cursor: "pointer" }}
                />
                <input
                  id={id}
                  className="bos-input"
                  value={form.bg}
                  placeholder="transparent or #091758"
                  onChange={(e) => setForm((f) => ({ ...f, bg: e.target.value }))}
                />
              </div>
            )}
          </Field>
          <SelectField
            label="Tile shape"
            hint="Corner style applied to the icon container."
            value={form.shape}
            onChange={(e) => setForm((f) => ({ ...f, shape: e.target.value as "" | ToolIconShape }))}
          >
            <option value="">Default</option>
            <option value="rounded">Rounded</option>
            <option value="square">Square</option>
            <option value="circle">Circle</option>
          </SelectField>
          <TextField
            label="Inner padding (px)"
            hint="0–12px breathing room inside the tile."
            type="number"
            min={0}
            max={12}
            value={form.paddingPx}
            placeholder="0"
            onChange={(e) => setForm((f) => ({ ...f, paddingPx: e.target.value }))}
          />
        </FormGrid>
      </div>
    </AdminSection>
  );
});
