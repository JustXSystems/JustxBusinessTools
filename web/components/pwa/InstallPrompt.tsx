"use client";

import { useEffect, useState } from "react";
import { usePlatformBranding } from "@/components/branding/BrandingProvider";
import { PlatformBrandMark } from "@/components/branding/PlatformBrandMark";
import {
  resolveInstallIconDisplay,
  resolveInstallName,
} from "@/lib/install-branding";
import { withBasePath } from "@/lib/base-path";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function iconVersion(icon: string, name: string): string {
  try {
    return btoa(`${icon}|${name}`).replace(/=+$/, "").slice(0, 24);
  } catch {
    return String(Date.now());
  }
}

export function InstallPrompt() {
  const { branding } = usePlatformBranding();
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    function onBeforeInstall(e: Event) {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    }
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstall);
  }, []);

  if (!deferred || hidden) return null;

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    if (outcome === "accepted") setHidden(true);
    setDeferred(null);
  }

  const name = resolveInstallName(branding.appName, branding.installName);
  const raw = resolveInstallIconDisplay(branding.logoUrl, branding.installIconUrl);
  const v = iconVersion(`${raw}|${branding.installIconBg || "transparent"}`, name);
  // Same square PNG Chrome uses for the desktop shortcut.
  const icon = `${withBasePath("/pwa-icon/192")}?v=${encodeURIComponent(v)}`;

  return (
    <div className="install-prompt">
      <div className="install-prompt-brand">
        <PlatformBrandMark size="sm" showText={false} logoUrl={icon} appName={name} />
        <div>
          <strong>Install {name}</strong>
          <p>Add to your desktop or home screen for quick access.</p>
        </div>
      </div>
      <div className="install-prompt-actions">
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setHidden(true)}>
          Later
        </button>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => void install()}>
          Install
        </button>
      </div>
    </div>
  );
}
