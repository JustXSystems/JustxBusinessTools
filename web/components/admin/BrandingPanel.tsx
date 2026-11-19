"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useState,
} from "react";
import { api } from "@/lib/api";
import { SplashMark } from "@/components/auth/SplashScreen";
import { BRAND_DEFAULTS } from "@jbt/shared";
import {
  DEFAULT_BRANDING,
  DEFAULT_POWERED_BY,
  invalidateBrandingCache,
  usePlatformBranding,
  type PlatformBranding,
  type PoweredByConfig,
} from "@/components/branding/BrandingProvider";
import { usePlatformConfig } from "@/components/config/ConfigProvider";
import { PlatformBrandMark } from "@/components/branding/PlatformBrandMark";
import type { ExperienceSaveHandle } from "@/components/admin/experience-save";
import { invalidateAdminData } from "@/hooks/useLiveRefresh";
import {
  detectInstallIconSource,
  INSTALL_ICON_FOLLOW_LOGO,
  JUSTX_LOGO_URL,
  resolveInstallIconDisplay,
  resolveInstallName,
  type InstallIconSource,
} from "@/lib/install-branding";
import {
  SPLASH_ANIMATION_LABELS,
  SPLASH_ANIMATIONS,
  SPLASH_INTENSITIES,
  SPLASH_INTENSITY_LABELS,
  type SplashAnimation,
  type SplashIntensity,
} from "@/lib/splash-animation";
import { publicAssetUrl } from "@/lib/base-path";
import { Alert, Button, Field, FormGrid, Grid, Segmented, Switch } from "@/components/bos";
import { AdminSection, AdminTabs } from "@/components/admin/ui";
import { SelectField, TextareaField, TextField } from "@/components/admin/ui/AdminFields";

type PlatformConfig = {
  powered_by?: PoweredByConfig;
  branding?: PlatformBranding;
  registration_copy?: RegistrationCopyForm;
};

type RegistrationCopyForm = {
  pendingOwnerTitle: string;
  pendingOwnerMessage: string;
  pendingOwnerDetail: string;
  pendingJoinTitle: string;
  pendingJoinMessage: string;
  pendingJoinDetail: string;
};

const DEFAULT_REG_COPY: RegistrationCopyForm = {
  pendingOwnerTitle: "Welcome — you're in",
  pendingOwnerMessage: `Your Owner account is ready. You can start using ${BRAND_DEFAULTS.productName} right away while ${BRAND_DEFAULTS.appName} reviews your business profile.`,
  pendingOwnerDetail: `Signed in as {{email}}. A ${BRAND_DEFAULTS.appName} admin may review your Business Profile later; approval is not required to continue.`,
  pendingJoinTitle: "Awaiting approval",
  pendingJoinMessage:
    "Request sent. The Business Profile Owner must approve you before you can sign in.",
  pendingJoinDetail: `We registered {{email}}. You will be able to sign in after the Business Profile Owner (or a ${BRAND_DEFAULTS.appName} admin) approves your request.`,
};

export const BrandingPanel = forwardRef<ExperienceSaveHandle>(function BrandingPanel(_props, ref) {
  const { refresh: refreshConfig } = usePlatformConfig();
  const { refresh: refreshBranding } = usePlatformBranding();
  const [form, setForm] = useState({
    appName: DEFAULT_BRANDING.appName,
    tagline: DEFAULT_BRANDING.tagline,
    legalName: DEFAULT_BRANDING.legalName,
    productName: DEFAULT_BRANDING.productName,
    splashDurationMs: String(DEFAULT_BRANDING.splashDurationMs),
    splashAnimation: DEFAULT_BRANDING.splashAnimation as SplashAnimation,
    splashIntensity: DEFAULT_BRANDING.splashIntensity as SplashIntensity,
    splashShowProgress: DEFAULT_BRANDING.splashShowProgress,
    logoUrl: DEFAULT_BRANDING.logoUrl,
    installName: DEFAULT_BRANDING.installName,
    installIconUrl: DEFAULT_BRANDING.installIconUrl,
  });
  const [footerText, setFooterText] = useState(DEFAULT_POWERED_BY.text);
  const [logoDraft, setLogoDraft] = useState<string | null>(null);
  const [iconDraft, setIconDraft] = useState<string | null>(null);
  const [iconSource, setIconSource] = useState<InstallIconSource>("justx");
  const [publishSiteFavicon, setPublishSiteFavicon] = useState(true);
  const [regCopy, setRegCopy] = useState<RegistrationCopyForm>(DEFAULT_REG_COPY);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);
  const [previewMode, setPreviewMode] = useState<"splash" | "mark" | "install">("splash");

  const reload = useCallback(async () => {
    const d = await api<{ config: PlatformConfig }>("/admin/config/platform");
    const b = d.config.branding ?? DEFAULT_BRANDING;
    const footer = d.config.powered_by ?? DEFAULT_POWERED_BY;
    const logoUrl = b.logoUrl || DEFAULT_BRANDING.logoUrl;
    const installIconUrl = b.installIconUrl || DEFAULT_BRANDING.installIconUrl;
    setForm({
      appName: b.appName || DEFAULT_BRANDING.appName,
      tagline: b.tagline || DEFAULT_BRANDING.tagline,
      legalName: b.legalName || DEFAULT_BRANDING.legalName,
      productName: b.productName || DEFAULT_BRANDING.productName,
      splashDurationMs: String(b.splashDurationMs ?? DEFAULT_BRANDING.splashDurationMs),
      splashAnimation: b.splashAnimation || DEFAULT_BRANDING.splashAnimation,
      splashIntensity: b.splashIntensity || DEFAULT_BRANDING.splashIntensity,
      splashShowProgress:
        b.splashShowProgress == null
          ? DEFAULT_BRANDING.splashShowProgress
          : Boolean(b.splashShowProgress),
      logoUrl,
      installName: b.installName || DEFAULT_BRANDING.installName,
      installIconUrl,
    });
    setIconSource(detectInstallIconSource(logoUrl, installIconUrl));
    setPublishSiteFavicon(
      b.publishSiteFavicon == null
        ? DEFAULT_BRANDING.publishSiteFavicon
        : Boolean(b.publishSiteFavicon),
    );
    const rc = d.config.registration_copy ?? DEFAULT_REG_COPY;
    setRegCopy({
      pendingOwnerTitle: rc.pendingOwnerTitle || DEFAULT_REG_COPY.pendingOwnerTitle,
      pendingOwnerMessage: rc.pendingOwnerMessage || DEFAULT_REG_COPY.pendingOwnerMessage,
      pendingOwnerDetail: rc.pendingOwnerDetail || DEFAULT_REG_COPY.pendingOwnerDetail,
      pendingJoinTitle: rc.pendingJoinTitle || DEFAULT_REG_COPY.pendingJoinTitle,
      pendingJoinMessage: rc.pendingJoinMessage || DEFAULT_REG_COPY.pendingJoinMessage,
      pendingJoinDetail: rc.pendingJoinDetail || DEFAULT_REG_COPY.pendingJoinDetail,
    });
    setFooterText(footer.text || DEFAULT_POWERED_BY.text);
    setLogoDraft(null);
    setIconDraft(null);
    setPreviewKey((k) => k + 1);
  }, []);

  useEffect(() => {
    reload().catch((e: Error) => setMessage(e.message));
  }, [reload]);

  async function onLogoFile(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setMessage("Choose an image file (PNG, SVG, WebP, or JPEG).");
      return;
    }
    if (file.size > 2_000_000) {
      setMessage("Logo must be under 2 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setLogoDraft(String(reader.result || ""));
      setPreviewKey((k) => k + 1);
    };
    reader.readAsDataURL(file);
  }

  async function onIconFile(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setMessage("Choose an image file (PNG, WebP, or JPEG).");
      return;
    }
    if (file.size > 2_000_000) {
      setMessage("Favicon / install icon must be under 2 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setIconDraft(String(reader.result || ""));
      setIconSource("custom");
      setPreviewKey((k) => k + 1);
      setPreviewMode("install");
    };
    reader.readAsDataURL(file);
  }

  const saveAll = useCallback(
    async (opts: { clearLogo?: boolean } = {}) => {
      setSaving(true);
      setMessage("");
      try {
        const splash = Math.round(Number(form.splashDurationMs));
        const body: Record<string, unknown> = {
          appName: form.appName.trim(),
          tagline: form.tagline.trim(),
          legalName: form.legalName.trim() || form.appName.trim(),
          productName: form.productName.trim() || `${form.appName.trim()} Business Tools`,
          splashDurationMs: Number.isFinite(splash) ? splash : DEFAULT_BRANDING.splashDurationMs,
          splashAnimation: form.splashAnimation,
          splashIntensity: form.splashIntensity,
          splashShowProgress: form.splashShowProgress,
          logo: opts.clearLogo ? undefined : logoDraft,
          clearLogo: Boolean(opts.clearLogo),
          installName: form.installName.trim() || form.appName.trim(),
          installIconBg: "transparent",
          publishSiteFavicon,
        };
        if (iconSource === "justx") {
          body.clearInstallIcon = true;
          body.installIconUrl = JUSTX_LOGO_URL;
        } else if (iconSource === "logo") {
          body.installIconUrl = INSTALL_ICON_FOLLOW_LOGO;
        } else if (iconDraft) {
          body.installIcon = iconDraft;
        } else if (form.installIconUrl && form.installIconUrl !== INSTALL_ICON_FOLLOW_LOGO) {
          body.installIconUrl = form.installIconUrl;
        } else {
          body.clearInstallIcon = true;
        }

        await api<{ branding: PlatformBranding }>("/admin/config/branding", {
          method: "PUT",
          body: JSON.stringify(body),
        });
        await api("/admin/config/powered-by", {
          method: "PUT",
          body: JSON.stringify({ text: footerText.trim(), locked: true }),
        });
        await api("/admin/config/registration-copy", {
          method: "PUT",
          body: JSON.stringify(regCopy),
        });
        invalidateBrandingCache();
        invalidateAdminData("branding");
        await refreshBranding();
        await refreshConfig();
        await reload();
        setMessage(
          opts.clearLogo
            ? "Logo reset and branding saved."
            : "Branding, registration copy, favicon, and footer saved.",
        );
      } catch (err) {
        setMessage(err instanceof Error ? err.message : "Save failed");
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [
      form,
      footerText,
      logoDraft,
      iconDraft,
      iconSource,
      publishSiteFavicon,
      regCopy,
      refreshBranding,
      refreshConfig,
      reload,
    ],
  );

  useImperativeHandle(
    ref,
    () => ({
      save: () => saveAll(),
      isSaving: () => saving,
    }),
    [saveAll, saving],
  );

  const previewLogo = logoDraft || form.logoUrl;
  const previewInstallIcon = publicAssetUrl(
    iconDraft ||
      resolveInstallIconDisplay(
        previewLogo,
        iconSource === "justx"
          ? JUSTX_LOGO_URL
          : iconSource === "logo"
            ? INSTALL_ICON_FOLLOW_LOGO
            : form.installIconUrl,
      ),
  );
  const previewInstallName = resolveInstallName(form.appName, form.installName);
  const draftBranding: PlatformBranding = {
    logoUrl: previewLogo,
    appName: form.appName || DEFAULT_BRANDING.appName,
    tagline: form.tagline || DEFAULT_BRANDING.tagline,
    legalName: form.legalName || DEFAULT_BRANDING.legalName,
    productName: form.productName || DEFAULT_BRANDING.productName,
    splashDurationMs: Number.isFinite(Number(form.splashDurationMs))
      ? Math.max(0, Math.round(Number(form.splashDurationMs)))
      : DEFAULT_BRANDING.splashDurationMs,
    splashAnimation: form.splashAnimation,
    splashIntensity: form.splashIntensity,
    splashShowProgress: form.splashShowProgress,
    installName: previewInstallName,
    installIconUrl: previewInstallIcon,
    installIconBg: "transparent",
    publishSiteFavicon,
  };

  const bump = () => setPreviewKey((k) => k + 1);

  return (
    <Grid template="minmax(0, 1.05fr) minmax(320px, 0.95fr)" min={320} gap={14}>
      <div className="admin-cc-split-stack">
        {message ? <Alert tone="blue" title={message} /> : null}

        <AdminSection
          title="Platform branding"
          description="Single source for brand copy across operator, admin, public home defaults, UPI, and emails. Change names here once — surfaces read these fields at runtime."
        >
          <div className="admin-cc-form">
            <FormGrid>
              <TextField
                label="App name"
                value={form.appName}
                onChange={(e) => {
                  setForm({ ...form, appName: e.target.value });
                  bump();
                }}
                placeholder={BRAND_DEFAULTS.appName}
              />
              <TextField
                label="Tagline"
                value={form.tagline}
                onChange={(e) => {
                  setForm({ ...form, tagline: e.target.value });
                  bump();
                }}
              />
              <TextField
                label="Legal name (LLP / copyright / UPI payee fallback)"
                value={form.legalName}
                onChange={(e) => {
                  setForm({ ...form, legalName: e.target.value });
                  bump();
                }}
                placeholder={BRAND_DEFAULTS.legalName}
              />
              <TextField
                label="Product name (marketing title)"
                value={form.productName}
                onChange={(e) => {
                  setForm({ ...form, productName: e.target.value });
                  bump();
                }}
                placeholder={BRAND_DEFAULTS.productName}
              />
              <TextField
                label="Splash duration (ms)"
                type="number"
                min={0}
                max={15000}
                value={form.splashDurationMs}
                onChange={(e) => {
                  setForm({ ...form, splashDurationMs: e.target.value });
                  bump();
                }}
              />
              <SelectField
                label="Splash animation"
                value={form.splashAnimation}
                onChange={(e) => {
                  setForm({ ...form, splashAnimation: e.target.value as SplashAnimation });
                  bump();
                  setPreviewMode("splash");
                }}
              >
                {SPLASH_ANIMATIONS.map((id) => (
                  <option key={id} value={id}>
                    {SPLASH_ANIMATION_LABELS[id]}
                  </option>
                ))}
              </SelectField>
              <SelectField
                label="Splash intensity"
                value={form.splashIntensity}
                onChange={(e) => {
                  setForm({ ...form, splashIntensity: e.target.value as SplashIntensity });
                  bump();
                  setPreviewMode("splash");
                }}
              >
                {SPLASH_INTENSITIES.map((id) => (
                  <option key={id} value={id}>
                    {SPLASH_INTENSITY_LABELS[id]}
                  </option>
                ))}
              </SelectField>
              <Field label="Splash progress bar">
                {({ id }) => (
                  <span className="admin-cc-switch-row" style={{ paddingBottom: 0 }}>
                    <Switch
                      id={id}
                      checked={form.splashShowProgress}
                      onChange={(checked) => {
                        setForm({ ...form, splashShowProgress: checked });
                        bump();
                      }}
                      aria-label="Show splash progress bar"
                    />
                    Show splash progress bar
                  </span>
                )}
              </Field>
              <Field full label="Logo upload">
                {({ id }) => (
                  <input
                    id={id}
                    type="file"
                    accept="image/*"
                    onChange={(e) => void onLogoFile(e.target.files?.[0] ?? null)}
                  />
                )}
              </Field>
            </FormGrid>
            <div className="admin-cc-actions" style={{ justifyContent: "flex-start" }}>
              <Button variant="secondary" size="sm" disabled={saving} onClick={() => void saveAll({ clearLogo: true })}>
                Reset logo to default
              </Button>
            </div>
          </div>
        </AdminSection>

        <AdminSection
          title="Favicon & install icon"
          description="Browser tab favicon, PWA / desktop install icon, and apple touch icon. Choose the official brand mark, match your platform logo, or upload a custom square PNG."
        >
          <div className="admin-cc-form">
            <FormGrid>
              <TextField
                full
                label="Install name"
                maxLength={40}
                placeholder={form.appName || BRAND_DEFAULTS.appName}
                value={form.installName}
                onChange={(e) => {
                  setForm({ ...form, installName: e.target.value });
                  bump();
                  setPreviewMode("install");
                }}
              />
              <Field full label="Icon source">
                {() => (
                  <Segmented
                    role="radio"
                    wrap
                    aria-label="Icon source"
                    options={ICON_SOURCE_OPTIONS}
                    value={iconSource}
                    onChange={(id) => {
                      setIconSource(id);
                      if (id !== "custom") setIconDraft(null);
                      bump();
                      setPreviewMode("install");
                    }}
                  />
                )}
              </Field>
              {iconSource === "custom" ? (
                <Field full label="Upload favicon / install icon">
                  {({ id }) => (
                    <input
                      id={id}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={(e) => void onIconFile(e.target.files?.[0] ?? null)}
                    />
                  )}
                </Field>
              ) : null}
            </FormGrid>
            <div className="install-icon-custom-banner">
              <span className="install-icon-thumb install-icon-checker">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={previewInstallIcon} alt="" />
              </span>
              <div>
                <strong>
                  {iconSource === "justx"
                    ? "Official Justxsystems logo"
                    : iconSource === "logo"
                      ? "Platform logo"
                      : "Custom icon"}
                </strong>
                <p className="admin-cc-note-text">Used for browser favicon and install shortcuts after you save.</p>
              </div>
            </div>
          </div>
        </AdminSection>

        <AdminSection
          title="Marketing homepage favicon"
          description={
            <>
              The marketing site at justxsystems.com is separate from JBT, but you can publish the same icon above to a
              public URL and (with a one-time nginx snippet) serve it as{" "}
              <code className="admin-cc-code">https://justxsystems.com/favicon.ico</code>.
            </>
          }
        >
          <div className="admin-cc-form">
            <span className="admin-cc-switch-row" style={{ paddingBottom: 0 }}>
              <Switch
                checked={publishSiteFavicon}
                onChange={setPublishSiteFavicon}
                aria-label="Publish this favicon for justxsystems.com"
              />
              Publish this favicon for justxsystems.com
            </span>
            <p className="admin-cc-note-text">
              Public URL (always available): <code className="admin-cc-code">{publicAssetUrl("/api/config/favicon.png")}</code>
            </p>
            <p className="admin-cc-note-text">
              Optional HTML on the marketing homepage:{" "}
              <code className="admin-cc-code">{`<link rel="icon" href="${publicAssetUrl("/api/config/favicon.png")}" type="image/png" />`}</code>
            </p>
            <p className="admin-cc-note-text">
              Preferred VPS setup: add the <code className="admin-cc-code">/favicon.ico</code> proxy from{" "}
              <code className="admin-cc-code">deploy/nginx-jbt.conf.example</code>, then reload nginx. After that, saving
              branding here updates the root site tab icon.
            </p>
          </div>
        </AdminSection>

        <AdminSection
          title="Registration screen copy"
          description={
            <>
              Join-request screens still show after someone registers against an existing GSTIN. New-GSTIN Owners sign in
              immediately (these Owner fields are fallbacks only). Use <code className="admin-cc-code">{"{{email}}"}</code>{" "}
              in detail lines.
            </>
          }
        >
          <FormGrid>
            <TextField
              full
              label="New GSTIN (Owner) — title (unused when auto-login succeeds)"
              value={regCopy.pendingOwnerTitle}
              onChange={(e) => setRegCopy({ ...regCopy, pendingOwnerTitle: e.target.value })}
            />
            <TextareaField
              full
              label="New GSTIN (Owner) — message"
              rows={2}
              value={regCopy.pendingOwnerMessage}
              onChange={(e) => setRegCopy({ ...regCopy, pendingOwnerMessage: e.target.value })}
            />
            <TextareaField
              full
              label="New GSTIN (Owner) — detail"
              rows={2}
              value={regCopy.pendingOwnerDetail}
              onChange={(e) => setRegCopy({ ...regCopy, pendingOwnerDetail: e.target.value })}
            />
            <TextField
              full
              label="Join existing GSTIN — title"
              value={regCopy.pendingJoinTitle}
              onChange={(e) => setRegCopy({ ...regCopy, pendingJoinTitle: e.target.value })}
            />
            <TextareaField
              full
              label="Join existing GSTIN — message"
              rows={2}
              value={regCopy.pendingJoinMessage}
              onChange={(e) => setRegCopy({ ...regCopy, pendingJoinMessage: e.target.value })}
            />
            <TextareaField
              full
              label="Join existing GSTIN — detail"
              rows={2}
              value={regCopy.pendingJoinDetail}
              onChange={(e) => setRegCopy({ ...regCopy, pendingJoinDetail: e.target.value })}
            />
          </FormGrid>
        </AdminSection>

        <AdminSection title="Operator footer" description="Shown at the bottom of the operator app (Powered by…).">
          <FormGrid>
            <TextField full label="Footer text" value={footerText} onChange={(e) => setFooterText(e.target.value)} />
          </FormGrid>
        </AdminSection>
      </div>

      <aside aria-label="Branding preview" className="admin-cc-split-stack">
        <AdminSection
          title="Live preview"
          description="Updates as you edit — use Save changes to publish."
          actions={
            <AdminTabs
              aria-label="Preview mode"
              options={PREVIEW_MODE_OPTIONS}
              value={previewMode}
              onChange={setPreviewMode}
            />
          }
        >
          <div className="preview-pane-stage" key={`${previewMode}-${previewKey}`}>
            {previewMode === "splash" ? <SplashMark branding={draftBranding} preview /> : null}
            {previewMode === "mark" ? (
              <div className="preview-install-stage">
                <PlatformBrandMark
                  size="xl"
                  layout="stack"
                  showText
                  logoUrl={previewLogo}
                  appName={draftBranding.appName}
                  tagline={draftBranding.tagline}
                />
              </div>
            ) : null}
            {previewMode === "install" ? (
              <div className="preview-install-stage">
                <div className="preview-install-card">
                  <span className="preview-install-icon install-icon-checker">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={previewInstallIcon} alt="" style={{ objectFit: "contain" }} />
                  </span>
                  <div>
                    <strong>{previewInstallName}</strong>
                    <p>Install {previewInstallName || BRAND_DEFAULTS.appName}</p>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </AdminSection>
      </aside>
    </Grid>
  );
});

const ICON_SOURCE_OPTIONS: ReadonlyArray<{ value: InstallIconSource; label: string }> = [
  { value: "justx", label: "Official Justxsystems logo" },
  { value: "logo", label: "Same as platform logo" },
  { value: "custom", label: "Custom upload" },
];

const PREVIEW_MODE_OPTIONS: ReadonlyArray<{ value: "splash" | "mark" | "install"; label: string }> = [
  { value: "splash", label: "Splash" },
  { value: "mark", label: "Mark" },
  { value: "install", label: "Install" },
];
