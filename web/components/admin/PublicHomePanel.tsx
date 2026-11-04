"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { api } from "@/lib/api";
import type { ExperienceSaveHandle } from "@/components/admin/experience-save";
import { invalidateAdminData } from "@/hooks/useLiveRefresh";
import { publicAssetUrl } from "@/lib/base-path";
import {
  EMPTY_MEDIA,
  EMPTY_STYLE,
  type CtaButton,
  type HeroSlide,
  type MediaRef,
  type NavItem,
  type PillarItem,
  type PublicHomeConfig,
  type PublicHomeSection,
  type SectionStyle,
  type StatItem,
} from "@/lib/public-home/types";

function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="admin-field" style={{ display: "grid", gap: "0.35rem" }}>
      <span className="muted" style={{ fontSize: "0.82rem" }}>
        {label}
      </span>
      {children}
    </label>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      className="input"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function TextArea({
  value,
  onChange,
  rows = 3,
}: {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
}) {
  return (
    <textarea
      className="input"
      rows={rows}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function MediaEditor({
  label,
  value,
  onChange,
}: {
  label: string;
  value: MediaRef;
  onChange: (next: MediaRef) => void;
}) {
  return (
    <div
      className="panel"
      style={{ padding: "0.75rem", display: "grid", gap: "0.55rem", background: "var(--glass-1)" }}
    >
      <strong style={{ fontSize: "0.85rem" }}>{label}</strong>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 120px), 1fr))",
          gap: "0.55rem",
        }}
      >
        <Field label="Kind">
          <select
            className="input"
            value={value.kind}
            onChange={(e) =>
              onChange({ ...value, kind: e.target.value as MediaRef["kind"] })
            }
          >
            <option value="none">None</option>
            <option value="image">Image</option>
            <option value="svg">SVG</option>
            <option value="video">Video</option>
          </select>
        </Field>
        <Field label="Object fit">
          <select
            className="input"
            value={value.objectFit}
            onChange={(e) =>
              onChange({
                ...value,
                objectFit: e.target.value === "contain" ? "contain" : "cover",
              })
            }
          >
            <option value="cover">Cover</option>
            <option value="contain">Contain</option>
          </select>
        </Field>
      </div>
      <Field label="URL or paste">
        <TextInput
          value={value.url}
          onChange={(url) => onChange({ ...value, url, kind: value.kind === "none" && url ? "image" : value.kind })}
          placeholder="/icons/… or https://… or data URL after upload"
        />
      </Field>
      <Field label="Alt text">
        <TextInput value={value.alt} onChange={(alt) => onChange({ ...value, alt })} />
      </Field>
      {value.kind === "video" ? (
        <Field label="Poster URL">
          <TextInput
            value={value.posterUrl}
            onChange={(posterUrl) => onChange({ ...value, posterUrl })}
          />
        </Field>
      ) : null}
      <p className="muted" style={{ fontSize: "0.78rem", margin: 0 }}>
        Upload PNG/JPEG/WebP/GIF (max 2 MB). For video or SVG, paste a URL above.
      </p>
      <input
        type="file"
        accept="image/png,image/jpeg,image/jpg,image/webp,image/gif"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          if (!/^image\/(png|jpeg|jpg|webp|gif)$/i.test(file.type)) {
            return;
          }
          void readFileAsDataUrl(file)
            .then((url) => {
              onChange({ ...value, kind: "image", url });
            })
            .catch(() => undefined);
          e.target.value = "";
        }}
      />
      {value.url ? (
        <div style={{ fontSize: "0.75rem" }} className="muted">
          Preview:{" "}
          {value.kind === "video" ? (
            <span>video set</span>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={publicAssetUrl(value.url)}
              alt=""
              style={{ maxHeight: 64, verticalAlign: "middle", borderRadius: 8 }}
            />
          )}
        </div>
      ) : null}
    </div>
  );
}

function StyleEditor({
  value,
  onChange,
}: {
  value: SectionStyle;
  onChange: (next: SectionStyle) => void;
}) {
  return (
    <details>
      <summary style={{ cursor: "pointer", fontWeight: 600 }}>Section styles</summary>
      <div style={{ display: "grid", gap: "0.55rem", marginTop: "0.65rem" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 140px), 1fr))",
            gap: "0.55rem",
          }}
        >
          <Field label="Background type">
            <select
              className="input"
              value={value.backgroundType}
              onChange={(e) =>
                onChange({
                  ...value,
                  backgroundType: e.target.value as SectionStyle["backgroundType"],
                })
              }
            >
              <option value="none">None</option>
              <option value="color">Color</option>
              <option value="gradient">Gradient</option>
              <option value="image">Image</option>
              <option value="video">Video</option>
            </select>
          </Field>
          <Field label="Text align">
            <select
              className="input"
              value={value.textAlign}
              onChange={(e) =>
                onChange({
                  ...value,
                  textAlign: e.target.value as SectionStyle["textAlign"],
                })
              }
            >
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
          </Field>
        </div>
        <Field label="Background value (color / CSS gradient / media URL)">
          <TextArea value={value.backgroundValue} onChange={(backgroundValue) => onChange({ ...value, backgroundValue })} rows={2} />
        </Field>
        <Field label="Background overlay">
          <TextInput value={value.backgroundOverlay} onChange={(backgroundOverlay) => onChange({ ...value, backgroundOverlay })} />
        </Field>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 120px), 1fr))",
            gap: "0.55rem",
          }}
        >
          <Field label="Text color">
            <TextInput value={value.textColor} onChange={(textColor) => onChange({ ...value, textColor })} />
          </Field>
          <Field label="Muted color">
            <TextInput value={value.mutedColor} onChange={(mutedColor) => onChange({ ...value, mutedColor })} />
          </Field>
          <Field label="Accent">
            <TextInput value={value.accentColor} onChange={(accentColor) => onChange({ ...value, accentColor })} />
          </Field>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 140px), 1fr))",
            gap: "0.55rem",
          }}
        >
          <Field label="Font family">
            <TextInput value={value.fontFamily} onChange={(fontFamily) => onChange({ ...value, fontFamily })} />
          </Field>
          <Field label="Font size">
            <TextInput value={value.fontSize} onChange={(fontSize) => onChange({ ...value, fontSize })} />
          </Field>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 110px), 1fr))",
            gap: "0.55rem",
          }}
        >
          <Field label="Padding Y">
            <TextInput value={value.paddingY} onChange={(paddingY) => onChange({ ...value, paddingY })} />
          </Field>
          <Field label="Padding X">
            <TextInput value={value.paddingX} onChange={(paddingX) => onChange({ ...value, paddingX })} />
          </Field>
          <Field label="Min height">
            <TextInput value={value.minHeight} onChange={(minHeight) => onChange({ ...value, minHeight })} />
          </Field>
        </div>
        <Field label="Max width">
          <TextInput value={value.maxWidth} onChange={(maxWidth) => onChange({ ...value, maxWidth })} />
        </Field>
        <Field label="Custom CSS (scoped to section)">
          <TextArea value={value.customCss} onChange={(customCss) => onChange({ ...value, customCss })} rows={2} />
        </Field>
      </div>
    </details>
  );
}

function NavListEditor({
  items,
  onChange,
}: {
  items: NavItem[];
  onChange: (next: NavItem[]) => void;
}) {
  return (
    <div style={{ display: "grid", gap: "0.5rem" }}>
      {items.map((item, index) => (
        <div
          key={item.id}
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr) auto",
            gap: "0.4rem",
          }}
        >
          <TextInput
            value={item.label}
            onChange={(label) => {
              const next = [...items];
              next[index] = { ...item, label };
              onChange(next);
            }}
            placeholder="Label"
          />
          <TextInput
            value={item.href}
            onChange={(href) => {
              const next = [...items];
              next[index] = { ...item, href };
              onChange(next);
            }}
            placeholder="/path or #anchor"
          />
          <button
            type="button"
            className="btn"
            onClick={() => onChange(items.filter((_, i) => i !== index))}
          >
            ✕
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn"
        onClick={() =>
          onChange([...items, { id: uid("nav"), label: "New link", href: "#", openInNewTab: false }])
        }
      >
        Add link
      </button>
    </div>
  );
}

function CtaListEditor({
  items,
  onChange,
}: {
  items: CtaButton[];
  onChange: (next: CtaButton[]) => void;
}) {
  return (
    <div style={{ display: "grid", gap: "0.5rem" }}>
      {items.map((item, index) => (
        <div key={item.id} style={{ display: "grid", gap: "0.4rem" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr) auto",
              gap: "0.4rem",
            }}
          >
            <TextInput
              value={item.label}
              onChange={(label) => {
                const next = [...items];
                next[index] = { ...item, label };
                onChange(next);
              }}
            />
            <TextInput
              value={item.href}
              onChange={(href) => {
                const next = [...items];
                next[index] = { ...item, href };
                onChange(next);
              }}
            />
            <button
              type="button"
              className="btn"
              onClick={() => onChange(items.filter((_, i) => i !== index))}
            >
              ✕
            </button>
          </div>
          <select
            className="input"
            value={item.variant}
            onChange={(e) => {
              const next = [...items];
              next[index] = { ...item, variant: e.target.value as CtaButton["variant"] };
              onChange(next);
            }}
          >
            <option value="primary">Primary</option>
            <option value="secondary">Secondary</option>
            <option value="ghost">Ghost</option>
            <option value="link">Link</option>
          </select>
        </div>
      ))}
      <button
        type="button"
        className="btn"
        onClick={() =>
          onChange([
            ...items,
            { id: uid("cta"), label: "Button", href: "/register", variant: "primary", openInNewTab: false },
          ])
        }
      >
        Add button
      </button>
    </div>
  );
}

function HeroSlidesEditor({
  slides,
  onChange,
}: {
  slides: HeroSlide[];
  onChange: (next: HeroSlide[]) => void;
}) {
  return (
    <div style={{ display: "grid", gap: "0.65rem" }}>
      <strong style={{ fontSize: "0.85rem" }}>Hero slides (cinematic mode)</strong>
      <p className="muted" style={{ margin: 0, fontSize: "0.78rem" }}>
        When slides exist, the hero uses full-bleed backgrounds and rotates copy. Upload image/video
        per slide from Admin.
      </p>
      {slides.map((slide, index) => (
        <div
          key={slide.id}
          className="panel"
          style={{ padding: "0.75rem", display: "grid", gap: "0.5rem", background: "var(--glass-1)" }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
            <strong style={{ fontSize: "0.82rem" }}>Slide {index + 1}</strong>
            <button
              type="button"
              className="btn"
              onClick={() => onChange(slides.filter((_, i) => i !== index))}
            >
              Remove
            </button>
          </div>
          <Field label="Eyebrow">
            <TextInput
              value={slide.eyebrow}
              onChange={(eyebrow) => {
                const next = [...slides];
                next[index] = { ...slide, eyebrow };
                onChange(next);
              }}
            />
          </Field>
          <Field label="Headline">
            <TextArea
              value={slide.headline}
              onChange={(headline) => {
                const next = [...slides];
                next[index] = { ...slide, headline };
                onChange(next);
              }}
            />
          </Field>
          <Field label="Subheadline">
            <TextArea
              value={slide.subheadline}
              onChange={(subheadline) => {
                const next = [...slides];
                next[index] = { ...slide, subheadline };
                onChange(next);
              }}
            />
          </Field>
          <Field label="Words (comma-separated)">
            <TextInput
              value={slide.words.join(", ")}
              onChange={(v) => {
                const next = [...slides];
                next[index] = {
                  ...slide,
                  words: v
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                };
                onChange(next);
              }}
            />
          </Field>
          <MediaEditor
            label="Slide background (image / video / SVG)"
            value={slide.background}
            onChange={(background) => {
              const next = [...slides];
              next[index] = { ...slide, background };
              onChange(next);
            }}
          />
          <Field label="Slide CTAs">
            <CtaListEditor
              items={slide.actions}
              onChange={(actions) => {
                const next = [...slides];
                next[index] = { ...slide, actions };
                onChange(next);
              }}
            />
          </Field>
        </div>
      ))}
      <button
        type="button"
        className="btn"
        onClick={() =>
          onChange([
            ...slides,
            {
              id: uid("slide"),
              eyebrow: "",
              headline: "New slide",
              subheadline: "",
              words: [],
              actions: [],
              background: { ...EMPTY_MEDIA },
            },
          ])
        }
      >
        Add slide
      </button>
    </div>
  );
}

function StatsItemsEditor({
  items,
  onChange,
}: {
  items: StatItem[];
  onChange: (next: StatItem[]) => void;
}) {
  return (
    <div style={{ display: "grid", gap: "0.65rem" }}>
      {items.map((item, index) => (
        <div
          key={item.id}
          className="panel"
          style={{ padding: "0.75rem", display: "grid", gap: "0.5rem", background: "var(--glass-1)" }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr) auto",
              gap: "0.4rem",
            }}
          >
            <TextInput
              value={item.value}
              onChange={(value) => {
                const next = [...items];
                next[index] = { ...item, value };
                onChange(next);
              }}
              placeholder="Value e.g. 20+"
            />
            <TextInput
              value={item.icon}
              onChange={(icon) => {
                const next = [...items];
                next[index] = { ...item, icon };
                onChange(next);
              }}
              placeholder="Icon glyph"
            />
            <button
              type="button"
              className="btn"
              onClick={() => onChange(items.filter((_, i) => i !== index))}
            >
              ✕
            </button>
          </div>
          <Field label="Label (use \\n for line break)">
            <TextArea
              value={item.label}
              onChange={(label) => {
                const next = [...items];
                next[index] = { ...item, label };
                onChange(next);
              }}
              rows={2}
            />
          </Field>
          <MediaEditor
            label="Stat icon media"
            value={item.media}
            onChange={(media) => {
              const next = [...items];
              next[index] = { ...item, media };
              onChange(next);
            }}
          />
        </div>
      ))}
      <button
        type="button"
        className="btn"
        onClick={() =>
          onChange([
            ...items,
            {
              id: uid("stat"),
              value: "0",
              label: "Label",
              icon: "◆",
              media: { ...EMPTY_MEDIA },
            },
          ])
        }
      >
        Add stat
      </button>
    </div>
  );
}

function PillarsItemsEditor({
  items,
  onChange,
}: {
  items: PillarItem[];
  onChange: (next: PillarItem[]) => void;
}) {
  return (
    <div style={{ display: "grid", gap: "0.65rem" }}>
      <strong style={{ fontSize: "0.85rem" }}>Pillar cards</strong>
      {items.map((item, index) => (
        <div
          key={item.id}
          className="panel"
          style={{ padding: "0.75rem", display: "grid", gap: "0.5rem", background: "var(--glass-1)" }}
        >
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <strong style={{ fontSize: "0.82rem" }}>Pillar {index + 1}</strong>
            <button
              type="button"
              className="btn"
              onClick={() => onChange(items.filter((_, i) => i !== index))}
            >
              Remove
            </button>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 140px), 1fr))",
              gap: "0.4rem",
            }}
          >
            <Field label="Tag">
              <TextInput
                value={item.tag}
                onChange={(tag) => {
                  const next = [...items];
                  next[index] = { ...item, tag };
                  onChange(next);
                }}
              />
            </Field>
            <Field label="Icon text">
              <TextInput
                value={item.icon}
                onChange={(icon) => {
                  const next = [...items];
                  next[index] = { ...item, icon };
                  onChange(next);
                }}
              />
            </Field>
          </div>
          <Field label="Title">
            <TextInput
              value={item.title}
              onChange={(title) => {
                const next = [...items];
                next[index] = { ...item, title };
                onChange(next);
              }}
            />
          </Field>
          <Field label="Subtitle">
            <TextArea
              value={item.subtitle}
              onChange={(subtitle) => {
                const next = [...items];
                next[index] = { ...item, subtitle };
                onChange(next);
              }}
            />
          </Field>
          <Field label="Bullets (one per line)">
            <TextArea
              value={item.bullets.join("\n")}
              onChange={(v) => {
                const next = [...items];
                next[index] = {
                  ...item,
                  bullets: v
                    .split("\n")
                    .map((s) => s.trim())
                    .filter(Boolean),
                };
                onChange(next);
              }}
              rows={4}
            />
          </Field>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 140px), 1fr))",
              gap: "0.4rem",
            }}
          >
            <Field label="Link href">
              <TextInput
                value={item.href}
                onChange={(href) => {
                  const next = [...items];
                  next[index] = { ...item, href };
                  onChange(next);
                }}
              />
            </Field>
            <Field label="Link label">
              <TextInput
                value={item.linkLabel}
                onChange={(linkLabel) => {
                  const next = [...items];
                  next[index] = { ...item, linkLabel };
                  onChange(next);
                }}
              />
            </Field>
          </div>
          <MediaEditor
            label="Card background media"
            value={item.media}
            onChange={(media) => {
              const next = [...items];
              next[index] = { ...item, media };
              onChange(next);
            }}
          />
          <MediaEditor
            label="Icon media"
            value={item.iconMedia}
            onChange={(iconMedia) => {
              const next = [...items];
              next[index] = { ...item, iconMedia };
              onChange(next);
            }}
          />
        </div>
      ))}
      <button
        type="button"
        className="btn"
        onClick={() =>
          onChange([
            ...items,
            {
              id: uid("pillar"),
              tag: "",
              title: "New pillar",
              subtitle: "",
              bullets: [],
              href: "#",
              linkLabel: "Learn more",
              icon: "",
              media: { ...EMPTY_MEDIA },
              iconMedia: { ...EMPTY_MEDIA },
            },
          ])
        }
      >
        Add pillar
      </button>
    </div>
  );
}

function updateSection(
  setConfig: Dispatch<SetStateAction<PublicHomeConfig | null>>,
  id: string,
  patch: Partial<PublicHomeSection> | ((s: PublicHomeSection) => PublicHomeSection),
) {
  setConfig((cfg) => {
    if (!cfg) return cfg;
    return {
      ...cfg,
      sections: cfg.sections.map((s) => {
        if (s.id !== id) return s;
        return typeof patch === "function" ? patch(s) : ({ ...s, ...patch } as PublicHomeSection);
      }),
    };
  });
}

function SectionEditor({
  section,
  setConfig,
  index,
  total,
}: {
  section: PublicHomeSection;
  setConfig: Dispatch<SetStateAction<PublicHomeConfig | null>>;
  index: number;
  total: number;
}) {
  const move = (dir: -1 | 1) => {
    setConfig((cfg) => {
      if (!cfg) return cfg;
      const next = [...cfg.sections];
      const j = index + dir;
      if (j < 0 || j >= next.length) return cfg;
      [next[index], next[j]] = [next[j], next[index]];
      return { ...cfg, sections: next };
    });
  };

  return (
    <details className="panel admin-card" style={{ padding: "0.85rem 1rem", overflow: "visible" }}>
      <summary
        style={{
          cursor: "pointer",
          display: "flex",
          gap: "0.75rem",
          alignItems: "center",
          flexWrap: "wrap",
          minWidth: 0,
        }}
      >
        <strong style={{ textTransform: "capitalize" }}>{section.type}</strong>
        <span className="muted">#{section.id}</span>
        <label style={{ marginLeft: "auto", display: "inline-flex", gap: "0.35rem", alignItems: "center" }} onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={section.enabled}
            onChange={(e) => updateSection(setConfig, section.id, { enabled: e.target.checked })}
          />
          Enabled
        </label>
      </summary>

      <div style={{ display: "flex", gap: "0.4rem", margin: "0.75rem 0" }}>
        <button type="button" className="btn" disabled={index === 0} onClick={() => move(-1)}>
          ↑
        </button>
        <button type="button" className="btn" disabled={index >= total - 1} onClick={() => move(1)}>
          ↓
        </button>
        <button
          type="button"
          className="btn"
          onClick={() =>
            setConfig((cfg) =>
              cfg ? { ...cfg, sections: cfg.sections.filter((s) => s.id !== section.id) } : cfg,
            )
          }
        >
          Remove section
        </button>
      </div>

      {section.type === "header" ? (
        <div style={{ display: "grid", gap: "0.65rem" }}>
          <label style={{ display: "inline-flex", gap: "0.4rem", alignItems: "center" }}>
            <input
              type="checkbox"
              checked={section.sticky}
              onChange={(e) => updateSection(setConfig, section.id, { sticky: e.target.checked })}
            />
            Sticky header
          </label>
          <Field label="Logo text">
            <TextInput
              value={section.logoText}
              onChange={(logoText) => updateSection(setConfig, section.id, { logoText })}
            />
          </Field>
          <Field label="Logo href">
            <TextInput
              value={section.logoHref}
              onChange={(logoHref) => updateSection(setConfig, section.id, { logoHref })}
            />
          </Field>
          <MediaEditor
            label="Logo media"
            value={section.logo}
            onChange={(logo) => updateSection(setConfig, section.id, { logo })}
          />
          <Field label="Menus">
            <NavListEditor
              items={section.menus}
              onChange={(menus) => updateSection(setConfig, section.id, { menus })}
            />
          </Field>
          <Field label="Header actions">
            <CtaListEditor
              items={section.actions}
              onChange={(actions) => updateSection(setConfig, section.id, { actions })}
            />
          </Field>
        </div>
      ) : null}

      {section.type === "hero" ? (
        <div style={{ display: "grid", gap: "0.65rem" }}>
          <Field label="Brand label (hero-level)">
            <TextInput
              value={section.brandLabel}
              onChange={(brandLabel) => updateSection(setConfig, section.id, { brandLabel })}
            />
          </Field>
          <Field label="Fallback eyebrow (used when no slides)">
            <TextInput
              value={section.eyebrow}
              onChange={(eyebrow) => updateSection(setConfig, section.id, { eyebrow })}
            />
          </Field>
          <Field label="Fallback headline">
            <TextArea
              value={section.headline}
              onChange={(headline) => updateSection(setConfig, section.id, { headline })}
            />
          </Field>
          <Field label="Fallback subheadline">
            <TextArea
              value={section.subheadline}
              onChange={(subheadline) => updateSection(setConfig, section.id, { subheadline })}
            />
          </Field>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 160px), 1fr))",
              gap: "0.55rem",
            }}
          >
            <Field label="Media position (legacy / no slides)">
              <select
                className="input"
                value={section.mediaPosition}
                onChange={(e) =>
                  updateSection(setConfig, section.id, {
                    mediaPosition: e.target.value as typeof section.mediaPosition,
                  })
                }
              >
                <option value="right">Right</option>
                <option value="left">Left</option>
                <option value="bottom">Bottom</option>
                <option value="background">Background</option>
              </select>
            </Field>
            <Field label="Slide autoplay (sec, 0 = off)">
              <TextInput
                value={String(section.autoplaySec ?? 0)}
                onChange={(v) =>
                  updateSection(setConfig, section.id, {
                    autoplaySec: Math.max(0, Number(v) || 0),
                  })
                }
              />
            </Field>
          </div>
          <MediaEditor
            label="Side / fallback media"
            value={section.media}
            onChange={(media) => updateSection(setConfig, section.id, { media })}
          />
          <Field label="Fallback CTAs">
            <CtaListEditor
              items={section.actions}
              onChange={(actions) => updateSection(setConfig, section.id, { actions })}
            />
          </Field>
          <Field label="Chips (comma-separated)">
            <TextInput
              value={(section.chips ?? []).join(", ")}
              onChange={(v) =>
                updateSection(setConfig, section.id, {
                  chips: v
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
            />
          </Field>
          <HeroSlidesEditor
            slides={section.slides ?? []}
            onChange={(slides) => updateSection(setConfig, section.id, { slides })}
          />
        </div>
      ) : null}

      {section.type === "stats" ? (
        <div style={{ display: "grid", gap: "0.65rem" }}>
          <StatsItemsEditor
            items={section.items}
            onChange={(items) => updateSection(setConfig, section.id, { items })}
          />
        </div>
      ) : null}

      {section.type === "pillars" ? (
        <div style={{ display: "grid", gap: "0.65rem" }}>
          <Field label="Eyebrow">
            <TextInput
              value={section.eyebrow}
              onChange={(eyebrow) => updateSection(setConfig, section.id, { eyebrow })}
            />
          </Field>
          <Field label="Title">
            <TextInput
              value={section.title}
              onChange={(title) => updateSection(setConfig, section.id, { title })}
            />
          </Field>
          <Field label="Subtitle">
            <TextArea
              value={section.subtitle}
              onChange={(subtitle) => updateSection(setConfig, section.id, { subtitle })}
            />
          </Field>
          <Field label="Note">
            <TextArea
              value={section.note}
              onChange={(note) => updateSection(setConfig, section.id, { note })}
            />
          </Field>
          <Field label="Section CTAs">
            <CtaListEditor
              items={section.actions}
              onChange={(actions) => updateSection(setConfig, section.id, { actions })}
            />
          </Field>
          <PillarsItemsEditor
            items={section.items}
            onChange={(items) => updateSection(setConfig, section.id, { items })}
          />
        </div>
      ) : null}

      {section.type === "marquee" ? (
        <div style={{ display: "grid", gap: "0.65rem" }}>
          <Field label="Title">
            <TextInput
              value={section.title}
              onChange={(title) => updateSection(setConfig, section.id, { title })}
            />
          </Field>
          <Field label="Source">
            <select
              className="input"
              value={section.source}
              onChange={(e) =>
                updateSection(setConfig, section.id, {
                  source: e.target.value === "custom" ? "custom" : "catalog",
                })
              }
            >
              <option value="catalog">Tool catalog</option>
              <option value="custom">Custom items</option>
            </select>
          </Field>
          <Field label="Tool IDs (comma-separated, catalog mode)">
            <TextInput
              value={section.toolIds.join(",")}
              onChange={(v) =>
                updateSection(setConfig, section.id, {
                  toolIds: v.split(",").map((s) => s.trim()).filter(Boolean),
                })
              }
            />
          </Field>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 120px), 1fr))",
              gap: "0.55rem",
              alignItems: "end",
            }}
          >
            <Field label="Speed (sec)">
              <TextInput
                value={String(section.speedSec)}
                onChange={(v) =>
                  updateSection(setConfig, section.id, { speedSec: Number(v) || 38 })
                }
              />
            </Field>
            <Field label="Direction">
              <select
                className="input"
                value={section.direction}
                onChange={(e) =>
                  updateSection(setConfig, section.id, {
                    direction: e.target.value === "right" ? "right" : "left",
                  })
                }
              >
                <option value="left">Left</option>
                <option value="right">Right</option>
              </select>
            </Field>
            <label style={{ display: "inline-flex", gap: "0.4rem", alignItems: "center", minHeight: "2.5rem" }}>
              <input
                type="checkbox"
                checked={section.pauseOnHover}
                onChange={(e) =>
                  updateSection(setConfig, section.id, { pauseOnHover: e.target.checked })
                }
              />
              Pause on hover
            </label>
          </div>
        </div>
      ) : null}

      {section.type === "toolsShowcase" ? (
        <div style={{ display: "grid", gap: "0.65rem" }}>
          <Field label="Eyebrow">
            <TextInput
              value={section.eyebrow}
              onChange={(eyebrow) => updateSection(setConfig, section.id, { eyebrow })}
            />
          </Field>
          <Field label="Title">
            <TextInput
              value={section.title}
              onChange={(title) => updateSection(setConfig, section.id, { title })}
            />
          </Field>
          <Field label="Subtitle">
            <TextArea
              value={section.subtitle}
              onChange={(subtitle) => updateSection(setConfig, section.id, { subtitle })}
            />
          </Field>
          <Field label="Layout">
            <select
              className="input"
              value={section.layout}
              onChange={(e) =>
                updateSection(setConfig, section.id, {
                  layout: e.target.value as typeof section.layout,
                })
              }
            >
              <option value="grid">Grid</option>
              <option value="list">List</option>
              <option value="featured">Featured</option>
            </select>
          </Field>
          <Field label="Source">
            <select
              className="input"
              value={section.source}
              onChange={(e) =>
                updateSection(setConfig, section.id, {
                  source: e.target.value === "catalog" ? "catalog" : "custom",
                })
              }
            >
              <option value="custom">Custom tool cards</option>
              <option value="catalog">Tool catalog</option>
            </select>
          </Field>
          {section.tools.map((tool, ti) => (
            <div key={tool.id} className="panel" style={{ padding: "0.75rem", display: "grid", gap: "0.45rem" }}>
              <strong>Tool card {ti + 1}</strong>
              <TextInput
                value={tool.name}
                onChange={(name) => {
                  const tools = [...section.tools];
                  tools[ti] = { ...tool, name };
                  updateSection(setConfig, section.id, { tools });
                }}
              />
              <TextArea
                value={tool.description}
                onChange={(description) => {
                  const tools = [...section.tools];
                  tools[ti] = { ...tool, description };
                  updateSection(setConfig, section.id, { tools });
                }}
              />
              <TextInput
                value={tool.features.join(" | ")}
                onChange={(v) => {
                  const tools = [...section.tools];
                  tools[ti] = {
                    ...tool,
                    features: v.split("|").map((s) => s.trim()).filter(Boolean),
                  };
                  updateSection(setConfig, section.id, { tools });
                }}
                placeholder="Features separated by |"
              />
              <MediaEditor
                label="Tool screenshot"
                value={tool.screenshot}
                onChange={(screenshot) => {
                  const tools = [...section.tools];
                  tools[ti] = { ...tool, screenshot };
                  updateSection(setConfig, section.id, { tools });
                }}
              />
              <button
                type="button"
                className="btn"
                onClick={() =>
                  updateSection(setConfig, section.id, {
                    tools: section.tools.filter((_, i) => i !== ti),
                  })
                }
              >
                Remove card
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn"
            onClick={() =>
              updateSection(setConfig, section.id, {
                tools: [
                  ...section.tools,
                  {
                    id: uid("tool"),
                    toolId: "",
                    name: "New tool",
                    description: "",
                    icon: "✨",
                    screenshot: { ...EMPTY_MEDIA },
                    featureScreenshots: [],
                    features: [],
                    href: "/register",
                    ctaLabel: "Explore",
                  },
                ],
              })
            }
          >
            Add tool card
          </button>
        </div>
      ) : null}

      {section.type === "features" ? (
        <div style={{ display: "grid", gap: "0.65rem" }}>
          <Field label="Title">
            <TextInput
              value={section.title}
              onChange={(title) => updateSection(setConfig, section.id, { title })}
            />
          </Field>
          <Field label="Subtitle">
            <TextArea
              value={section.subtitle}
              onChange={(subtitle) => updateSection(setConfig, section.id, { subtitle })}
            />
          </Field>
          {section.items.map((item, ii) => (
            <div key={item.id} className="panel" style={{ padding: "0.75rem", display: "grid", gap: "0.45rem" }}>
              <TextInput
                value={item.title}
                onChange={(title) => {
                  const items = [...section.items];
                  items[ii] = { ...item, title };
                  updateSection(setConfig, section.id, { items });
                }}
              />
              <TextArea
                value={item.description}
                onChange={(description) => {
                  const items = [...section.items];
                  items[ii] = { ...item, description };
                  updateSection(setConfig, section.id, { items });
                }}
              />
              <MediaEditor
                label="Feature media / screenshot"
                value={item.media}
                onChange={(media) => {
                  const items = [...section.items];
                  items[ii] = { ...item, media };
                  updateSection(setConfig, section.id, { items });
                }}
              />
            </div>
          ))}
        </div>
      ) : null}

      {section.type === "cta" ? (
        <div style={{ display: "grid", gap: "0.65rem" }}>
          <Field label="Title">
            <TextInput
              value={section.title}
              onChange={(title) => updateSection(setConfig, section.id, { title })}
            />
          </Field>
          <Field label="Subtitle">
            <TextArea
              value={section.subtitle}
              onChange={(subtitle) => updateSection(setConfig, section.id, { subtitle })}
            />
          </Field>
          <CtaListEditor
            items={section.actions}
            onChange={(actions) => updateSection(setConfig, section.id, { actions })}
          />
        </div>
      ) : null}

      {section.type === "footer" ? (
        <div style={{ display: "grid", gap: "0.65rem" }}>
          <Field label="Logo text">
            <TextInput
              value={section.logoText}
              onChange={(logoText) => updateSection(setConfig, section.id, { logoText })}
            />
          </Field>
          <Field label="Tagline">
            <TextInput
              value={section.tagline}
              onChange={(tagline) => updateSection(setConfig, section.id, { tagline })}
            />
          </Field>
          <MediaEditor
            label="Footer logo"
            value={section.logo}
            onChange={(logo) => updateSection(setConfig, section.id, { logo })}
          />
          <Field label="Legal text">
            <TextInput
              value={section.legalText}
              onChange={(legalText) => updateSection(setConfig, section.id, { legalText })}
            />
          </Field>
          {section.columns.map((col, ci) => (
            <div key={col.id} className="panel" style={{ padding: "0.75rem", display: "grid", gap: "0.45rem" }}>
              <TextInput
                value={col.title}
                onChange={(title) => {
                  const columns = [...section.columns];
                  columns[ci] = { ...col, title };
                  updateSection(setConfig, section.id, { columns });
                }}
              />
              <NavListEditor
                items={col.links}
                onChange={(links) => {
                  const columns = [...section.columns];
                  columns[ci] = { ...col, links };
                  updateSection(setConfig, section.id, { columns });
                }}
              />
            </div>
          ))}
        </div>
      ) : null}

      <div style={{ marginTop: "0.85rem" }}>
        <StyleEditor
          value={section.style}
          onChange={(style) => updateSection(setConfig, section.id, { style })}
        />
      </div>
    </details>
  );
}

function newSection(type: PublicHomeSection["type"]): PublicHomeSection {
  const id = uid(type);
  const base = { id, enabled: true, style: { ...EMPTY_STYLE } };
  switch (type) {
    case "header":
      return {
        ...base,
        type,
        sticky: true,
        logo: { ...EMPTY_MEDIA },
        logoText: "JustX",
        logoHref: "/",
        menus: [],
        actions: [],
      };
    case "hero":
      return {
        ...base,
        type,
        brandLabel: "JustX Business Tools",
        eyebrow: "",
        headline: "Headline",
        subheadline: "",
        actions: [],
        media: { ...EMPTY_MEDIA },
        mediaPosition: "background",
        slides: [],
        chips: [],
        autoplaySec: 7,
      };
    case "stats":
      return {
        ...base,
        type,
        items: [],
      };
    case "pillars":
      return {
        ...base,
        type,
        eyebrow: "",
        title: "Capabilities",
        subtitle: "",
        note: "",
        actions: [],
        items: [],
      };
    case "marquee":
      return {
        ...base,
        type,
        title: "",
        source: "catalog",
        toolIds: [],
        items: [],
        speedSec: 38,
        pauseOnHover: true,
        direction: "left",
      };
    case "toolsShowcase":
      return {
        ...base,
        type,
        eyebrow: "",
        title: "Tools",
        subtitle: "",
        layout: "grid",
        source: "custom",
        toolIds: [],
        tools: [],
      };
    case "features":
      return {
        ...base,
        type,
        eyebrow: "",
        title: "Features",
        subtitle: "",
        layout: "alternating",
        items: [],
      };
    case "cta":
      return {
        ...base,
        type,
        title: "Get started",
        subtitle: "",
        actions: [],
      };
    case "footer":
      return {
        ...base,
        type,
        logo: { ...EMPTY_MEDIA },
        logoText: "JustX",
        tagline: "",
        columns: [],
        legalText: "",
        socialLinks: [],
      };
    default: {
      const _exhaustive: never = type;
      return _exhaustive;
    }
  }
}

export const PublicHomePanel = forwardRef<ExperienceSaveHandle>(function PublicHomePanel(
  _props,
  ref,
) {
  const [config, setConfig] = useState<PublicHomeConfig | null>(null);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    const d = await api<{ publicHome: PublicHomeConfig }>("/admin/config/public-home");
    setConfig(d.publicHome);
  }, []);

  useEffect(() => {
    reload().catch((e: Error) => setMessage(e.message));
  }, [reload]);

  const save = useCallback(async () => {
    if (!config) return;
    setSaving(true);
    setMessage("");
    try {
      const d = await api<{ publicHome: PublicHomeConfig }>("/admin/config/public-home", {
        method: "PUT",
        body: JSON.stringify({ publicHome: config }),
      });
      setConfig(d.publicHome);
      setMessage("Public home saved.");
      invalidateAdminData();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Save failed");
      throw e;
    } finally {
      setSaving(false);
    }
  }, [config]);

  useImperativeHandle(
    ref,
    () => ({
      save,
      isSaving: () => saving,
    }),
    [save, saving],
  );

  if (!config) {
    return <p className="muted">Loading public home…</p>;
  }

  return (
    <div className="admin-public-home" style={{ display: "grid", gap: "1rem", minWidth: 0 }}>
      <section className="panel admin-card" style={{ padding: "1rem", display: "grid", gap: "0.75rem" }}>
        <div style={{ display: "flex", gap: "1rem", alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ display: "inline-flex", gap: "0.4rem", alignItems: "center" }}>
            <input
              type="checkbox"
              checked={config.enabled}
              onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
            />
            Enabled for guests at `/`
          </label>
          <span className="muted" style={{ fontSize: "0.82rem" }}>
            Guests see this at `/` when enabled. Logged-in users always see the operator home.
          </span>
          <a className="btn" href="/" target="_blank" rel="noreferrer">
            Open public home
          </a>
          <button
            type="button"
            className="btn"
            onClick={() => {
              void (async () => {
                setSaving(true);
                try {
                  const d = await api<{ publicHome: PublicHomeConfig }>(
                    "/admin/config/public-home",
                    { method: "PUT", body: JSON.stringify({ reset: true }) },
                  );
                  setConfig(d.publicHome);
                  setMessage("Reset to JustX marketing defaults.");
                } catch (e) {
                  setMessage(e instanceof Error ? e.message : "Reset failed");
                } finally {
                  setSaving(false);
                }
              })();
            }}
          >
            Reset defaults
          </button>
        </div>
        <Field label="SEO title">
          <TextInput
            value={config.seo.title}
            onChange={(title) => setConfig({ ...config, seo: { ...config.seo, title } })}
          />
        </Field>
        <Field label="SEO description">
          <TextArea
            value={config.seo.description}
            onChange={(description) =>
              setConfig({ ...config, seo: { ...config.seo, description } })
            }
          />
        </Field>
      </section>

      <section className="panel admin-card" style={{ padding: "1rem", display: "grid", gap: "0.65rem" }}>
        <h3 style={{ margin: 0 }}>Page theme</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(140px,1fr))", gap: "0.55rem" }}>
          {(
            [
              ["bg0", "Background"],
              ["bg1", "Surface"],
              ["accent", "Accent"],
              ["accentStrong", "Accent strong"],
              ["textHi", "Text"],
              ["textMid", "Muted text"],
              ["radius", "Radius"],
            ] as const
          ).map(([key, label]) => (
            <Field key={key} label={label}>
              <TextInput
                value={config.theme[key]}
                onChange={(v) => setConfig({ ...config, theme: { ...config.theme, [key]: v } })}
              />
            </Field>
          ))}
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 180px), 1fr))",
            gap: "0.55rem",
          }}
        >
          <Field label="Body font CSS">
            <TextInput
              value={config.theme.fontSans}
              onChange={(fontSans) =>
                setConfig({ ...config, theme: { ...config.theme, fontSans } })
              }
            />
          </Field>
          <Field label="Display font CSS">
            <TextInput
              value={config.theme.fontDisplay}
              onChange={(fontDisplay) =>
                setConfig({ ...config, theme: { ...config.theme, fontDisplay } })
              }
            />
          </Field>
        </div>
        <Field label="Color scheme">
          <select
            className="input"
            value={config.theme.colorScheme}
            onChange={(e) =>
              setConfig({
                ...config,
                theme: {
                  ...config.theme,
                  colorScheme: e.target.value === "light" ? "light" : "dark",
                },
              })
            }
          >
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </Field>
      </section>

      <section style={{ display: "grid", gap: "0.75rem" }}>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
          <h3 style={{ margin: 0, flex: 1 }}>Sections</h3>
          {(
            [
              "header",
              "hero",
              "stats",
              "pillars",
              "marquee",
              "toolsShowcase",
              "features",
              "cta",
              "footer",
            ] as const
          ).map((type) => (
            <button
              key={type}
              type="button"
              className="btn"
              onClick={() =>
                setConfig({ ...config, sections: [...config.sections, newSection(type)] })
              }
            >
              + {type}
            </button>
          ))}
        </div>
        {config.sections.map((section, index) => (
          <SectionEditor
            key={section.id}
            section={section}
            setConfig={setConfig}
            index={index}
            total={config.sections.length}
          />
        ))}
      </section>

      {message ? <p className="muted">{message}</p> : null}
    </div>
  );
});
