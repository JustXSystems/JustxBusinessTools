"use client";

import "./ims-app.css";

import type { ReactNode } from "react";
import { BosRoot, Footnote } from "@/components/bos";
import { useAuth } from "@/components/auth/AuthProvider";
import { api } from "@/lib/api";
import { publicAssetUrl, withBasePath } from "@/lib/base-path";
import { clearSubscriptionSnapshot } from "@/lib/subscription-cache";
import { clearToolCart } from "@/lib/tool-cart";
import { IMS_LOGO, ImsApp } from "./ImsApp";

function Gate({ children }: { children: ReactNode }) {
  return (
    <BosRoot skin="ims" canvas className="ims-standalone">
      <main className="ims-gate">
        {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset under the app base path */}
        <img className="ims-gate-logo" src={publicAssetUrl(IMS_LOGO)} alt="Justx" />
        {children}
        <Footnote>Justx IMS — Dealer · © 2026 Justx Systems. All Rights Reserved.</Footnote>
      </main>
    </BosRoot>
  );
}

/** `/ims` — Justx IMS-Dealer as a full-screen app. Sign-in is the shared JBT login; access is enforced by `/api/ims`. */
export function ImsStandalone() {
  const { user, loading, refresh } = useAuth();

  const signOut = async () => {
    try {
      await api("/auth/logout", { method: "POST" });
    } finally {
      clearSubscriptionSnapshot();
      clearToolCart();
      await refresh();
    }
  };

  if (loading) {
    return (
      <Gate>
        <p className="bos-text-muted">Setting up your workspace…</p>
      </Gate>
    );
  }

  if (!user) {
    return (
      <Gate>
        <div className="ims-gate-card">
          <h2 style={{ margin: "0 0 6px", fontSize: 22, fontWeight: 600 }}>
            Welcome to Justx IMS
          </h2>
          <p className="bos-text-muted" style={{ margin: "0 0 18px" }}>
            Inventory, purchasing, GST sales and collections for dealers. Sign in with your Justx Business Tools account.
          </p>
          <a className="bos-btn bos-btn-primary bos-btn-block" href={withBasePath("/login?next=/ims")}>
            Sign in
          </a>
        </div>
      </Gate>
    );
  }

  return <ImsApp mode="standalone" onSignOut={() => void signOut()} />;
}
