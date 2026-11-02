"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { themeCssVars } from "@/lib/public-home/style";
import type { PublicHomeConfig, PublicHomeSection } from "@/lib/public-home/types";
import {
  PhCtaSection,
  PhFeaturesSection,
  PhFooterSection,
  PhHeaderSection,
  PhHeroSection,
  PhMarqueeSection,
  PhToolsShowcaseSection,
} from "./sections";

function SectionView({ section }: { section: PublicHomeSection }) {
  if (!section.enabled) return null;
  switch (section.type) {
    case "header":
      return <PhHeaderSection section={section} />;
    case "hero":
      return <PhHeroSection section={section} />;
    case "marquee":
      return <PhMarqueeSection section={section} />;
    case "toolsShowcase":
      return <PhToolsShowcaseSection section={section} />;
    case "features":
      return <PhFeaturesSection section={section} />;
    case "cta":
      return <PhCtaSection section={section} />;
    case "footer":
      return <PhFooterSection section={section} />;
    default:
      return null;
  }
}

export function PublicHomePage() {
  const router = useRouter();
  const [config, setConfig] = useState<PublicHomeConfig | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const data = await api<{ publicHome: PublicHomeConfig }>("/config/public-home");
        if (!alive) return;
        // Disabled, missing, or partial payload → same guest UX as before (login).
        if (!data.publicHome?.enabled) {
          router.replace("/login");
          return;
        }
        setConfig(data.publicHome);
        if (data.publicHome.seo?.title) {
          document.title = data.publicHome.seo.title;
        }
        const desc = data.publicHome.seo?.description;
        if (desc) {
          let meta = document.querySelector('meta[name="description"]');
          if (!meta) {
            meta = document.createElement("meta");
            meta.setAttribute("name", "description");
            document.head.appendChild(meta);
          }
          meta.setAttribute("content", desc);
        }
      } catch {
        // Rolling deploy / API blip must not strand guests — fall back to login.
        if (alive) router.replace("/login");
      }
    })();
    return () => {
      alive = false;
    };
  }, [router]);

  if (!config) {
    return (
      <div
        className="ph-root"
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          color: "rgba(255,255,255,0.55)",
        }}
        aria-busy="true"
      >
        Loading…
      </div>
    );
  }

  return (
    <div className="ph-root" style={themeCssVars(config.theme)} data-scheme={config.theme.colorScheme}>
      {config.sections.map((section) => (
        <SectionView key={section.id} section={section} />
      ))}
    </div>
  );
}
