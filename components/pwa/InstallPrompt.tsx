"use client";

import { useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function InstallPrompt() {
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

  return (
    <div className="install-prompt">
      <div>
        <strong>Install JBT</strong>
        <p>Add to your home screen for quick access.</p>
      </div>
      <div className="install-prompt-actions">
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setHidden(true)}>
          Later
        </button>
        <button type="button" className="btn btn-primary btn-sm" onClick={install}>
          Install
        </button>
      </div>
    </div>
  );
}
