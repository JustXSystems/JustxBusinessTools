"use client";

import { useState } from "react";
import Link from "next/link";
import type { ToolDefinition } from "@/config/tools.config";
import { useToast } from "@/components/common/ToastProvider";
import { usePlatformConfig } from "@/components/config/ConfigProvider";
import { useSubscription } from "@/hooks/useSubscription";
import { withBasePath } from "@/lib/base-path";
import { openStandaloneAppWindow, resolveToolLaunch } from "@/lib/tool-launch";

function inr(n: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}

function ToolIcon({ icon }: { icon: string }) {
  if (icon.startsWith("/")) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- static public icon asset
      <img className="tool-icon-img" src={withBasePath(icon)} alt="" width={40} height={40} />
    );
  }
  return <>{icon}</>;
}

export function ToolCard({ tool }: { tool: ToolDefinition }) {
  const { subscription, isToolLicensed, openUpgrade, startTrial } = useSubscription();
  const { config } = usePlatformConfig();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const sku = subscription?.catalog?.find((s) => s.toolId === tool.id);
  const licensed = isToolLicensed(tool.id);
  const paidOffer = sku && !sku.includedFree && sku.priceInr > 0;
  const trialEligible = Boolean(sku?.trialEligible && (sku.trialDays ?? 0) > 0);

  const catalogRow = config?.catalog?.find((c) => c.id === tool.id);
  const launch = resolveToolLaunch(tool.id, catalogRow, tool.route);

  async function onTrial() {
    setBusy(true);
    try {
      await startTrial(tool.id);
      showToast(`${sku?.trialDays ?? 14}-day trial started for ${tool.name}`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not start trial");
    } finally {
      setBusy(false);
    }
  }

  function openIndependentApp(e: React.MouseEvent) {
    e.preventDefault();
    const href = withBasePath(launch.href);
    const opened = openStandaloneAppWindow(launch.href, tool.id, href);
    if (!opened) {
      window.location.assign(href);
    }
  }

  const mainClass = "tool-card-main";
  const mainBody = (
    <>
      <div className="tool-icon" aria-hidden>
        <ToolIcon icon={tool.icon} />
      </div>
      <div className="tool-card-copy">
        <div className="tool-name">{tool.name}</div>
        {sku?.tagline ? (
          <div className="tool-card-tagline">{sku.tagline}</div>
        ) : tool.desc ? (
          <div className="tool-card-tagline">{tool.desc}</div>
        ) : null}
        <span className="tool-card-category">{tool.category}</span>
      </div>
    </>
  );

  return (
    <article className={`tool-card${paidOffer && !licensed ? " tool-card-paywall" : ""}`}>
      {launch.openInNewWindow ? (
        <a
          href={withBasePath(launch.href)}
          className={mainClass}
          onClick={openIndependentApp}
          title="Opens as an independent app window"
        >
          {mainBody}
        </a>
      ) : (
        <Link href={launch.href} className={mainClass}>
          {mainBody}
        </Link>
      )}
      {paidOffer ? (
        licensed ? (
          <div className="tool-card-sku is-licensed">Licensed</div>
        ) : trialEligible ? (
          <div className="tool-card-cta-stack">
            <button
              type="button"
              className="tool-card-subscribe"
              disabled={busy}
              onClick={() => void onTrial()}
            >
              Start {sku!.trialDays}-day trial
            </button>
            <button type="button" className="tool-card-subscribe-secondary" onClick={() => openUpgrade(tool.id)}>
              Subscribe · {inr(sku!.priceInr)}/mo
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="tool-card-subscribe"
            onClick={() => openUpgrade(tool.id)}
          >
            Subscribe · {inr(sku!.priceInr)}/mo
          </button>
        )
      ) : null}
    </article>
  );
}
