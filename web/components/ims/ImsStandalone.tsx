"use client";

import "./ims-app.css";

import { useEffect, type ReactNode } from "react";
import { BosRoot, Footnote } from "@/components/bos";
import { useAuth } from "@/components/auth/AuthProvider";
import { useToolIconConfig, useToolName } from "@/components/config/ConfigProvider";
import { useActiveColorMode, useDynamicToolFavicon } from "@/components/common/ToolIconMark";
import { isImageIcon, resolveIconAssetUrl, resolveToolIconSource } from "@/lib/tool-icons";
import { ImpersonationBanner } from "@/components/layout/ImpersonationBanner";
import { api } from "@/lib/api";
import { publicAssetUrl, withBasePath } from "@/lib/base-path";
import { clearSubscriptionSnapshot } from "@/lib/subscription-cache";
import { clearToolCart } from "@/lib/tool-cart";
import { IMS_LOGO, ImsApp } from "./ImsApp";

function Gate({ children, productName, logoSrc }: { children: ReactNode; productName: string; logoSrc: string }) {
  return (
    <BosRoot skin="ims" canvas className="ims-standalone">
      <main className="ims-gate">
        {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset under the app base path */}
        <img className="ims-gate-logo" src={logoSrc} alt={productName} />
        {children}
        <Footnote>{productName} · © 2026 Justxsystems. All Rights Reserved.</Footnote>
      </main>
    </BosRoot>
  );
}

/** `/ims` — Justxsystems IMS-Dealer as a full-screen app. Sign-in is the shared JBT login; access is enforced by `/api/ims`. */
export function ImsStandalone() {
  const { user, loading, refresh } = useAuth();
  const productName = useToolName("imsdealer", "Justxsystems IMS");
  const iconCfg = useToolIconConfig("imsdealer");
  const colorMode = useActiveColorMode();
  const resolvedIcon = resolveToolIconSource(iconCfg, IMS_LOGO, { theme: colorMode, size: "lg" });
  const logoSrc = isImageIcon(resolvedIcon) ? resolveIconAssetUrl(resolvedIcon) : publicAssetUrl(IMS_LOGO);
  useDynamicToolFavicon("imsdealer", "/IMS/icons/favicon.ico");

  useEffect(() => {
    document.title = productName;
  }, [productName]);

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
      <Gate productName={productName} logoSrc={logoSrc}>
        <p className="bos-text-muted">Setting up your workspace…</p>
      </Gate>
    );
  }

  if (!user) {
    return (
      <Gate productName={productName} logoSrc={logoSrc}>
        <div className="ims-gate-card">
          <h2 style={{ margin: "0 0 6px", fontSize: 22, fontWeight: 600 }}>
            Welcome to {productName}
          </h2>
          <p className="bos-text-muted" style={{ margin: "0 0 18px" }}>
            Inventory, purchasing, GST sales and collections for dealers. Sign in with your Justxsystems Business Tools account.
          </p>
          <a className="bos-btn bos-btn-primary bos-btn-block" href={withBasePath("/login?next=/ims")}>
            Sign in
          </a>
        </div>
      </Gate>
    );
  }

  return (
    <>
      <ImpersonationBanner />
      <ImsApp mode="standalone" onSignOut={() => void signOut()} />
    </>
  );
}
