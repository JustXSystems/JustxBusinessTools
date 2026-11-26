"use client";

import Link from "next/link";
import type { BillingCycle, UserCategory } from "@/lib/types/subscription";

type Props = {
  currentCategory: UserCategory;
  branchCount: number;
  billingCycle: BillingCycle;
  onSelectCycle: (cycle: BillingCycle) => void;
};

type TierSpec = {
  id: UserCategory;
  tone: "cyan" | "emerald" | "violet";
  badge: string;
  title: string;
  audience: string;
  highlights: string[];
  ctaLabel: string;
  ctaHref?: string;
};

const TIERS: TierSpec[] = [
  {
    id: "individual",
    tone: "cyan",
    badge: "Personal · No GSTIN",
    title: "Solo & Freelancer",
    audience: "Individuals, creators, and personal productivity without GST overhead.",
    highlights: [
      "Personal-eligible tools & curated packs",
      "Free trials with ₹0 MRR & clean consumer estimates",
      "Modular pay-per-tool pricing + 17% yearly savings",
      "Instant upgrade to Business anytime by adding GSTIN",
    ],
    ctaLabel: "Personal workspace active",
  },
  {
    id: "business",
    tone: "emerald",
    badge: "Business · Single GSTIN",
    title: "SME & GST Operations",
    audience: "Registered businesses running invoicing, inventory, GST compliance, and operations.",
    highlights: [
      "Full business tool catalog & Auto-Save bundle packs",
      "GST 18% inclusive Proforma Quotes & Tax Receipts (SAC 998314)",
      "Early renewal day-stacking & promo code support",
      "Real-time per-tool quota telemetry & usage alerts",
    ],
    ctaLabel: "Add GSTIN in Profile →",
    ctaHref: "/profile",
  },
  {
    id: "enterprise",
    tone: "violet",
    badge: "Enterprise · Multi-Branch",
    title: "Multi-Branch & Multi-GSTIN",
    audience: "Growing organizations operating across multiple branches, locations, or GSTINs.",
    highlights: [
      "Shared org-level licenses across all workspace branches",
      "Centralized billing, proforma approvals & consolidated receipts",
      "Enterprise-targeted promo campaigns & dedicated packs",
      "Per-branch access control & consolidated usage radar",
    ],
    ctaLabel: "Add another branch →",
    ctaHref: "/profile",
  },
];

export function CategoryTierComparison({
  currentCategory,
  branchCount,
  billingCycle,
  onSelectCycle,
}: Props) {
  return (
    <section className="sub-tier-matrix card" aria-label="Workspace tier comparison">
      <div className="sub-tier-matrix-head">
        <div>
          <p className="card-label">Workspace categories</p>
          <h2>Built for every stage — Personal, Business &amp; Enterprise</h2>
          <p className="muted">
            Your workspace tier adjusts automatically from your GSTIN and branch count — no forced upgrades or hidden
            seat fees.
          </p>
        </div>
        {billingCycle === "month" ? (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => onSelectCycle("year")}
          >
            Preview yearly savings (−17%)
          </button>
        ) : (
          <span className="sub-tier-pill is-emerald">Yearly active · 2 months free</span>
        )}
      </div>

      <div className="sub-tier-grid">
        {TIERS.map((tier) => {
          const isCurrent = tier.id === currentCategory;
          const isLower =
            (currentCategory === "business" && tier.id === "individual") ||
            (currentCategory === "enterprise" && tier.id !== "enterprise");

          return (
            <article
              key={tier.id}
              className={`sub-tier-card is-${tier.tone}${isCurrent ? " is-current" : ""}`}
            >
              <div className="sub-tier-card-top">
                <span className={`sub-tier-pill is-${tier.tone}`}>{tier.badge}</span>
                {isCurrent ? <span className="sub-tier-current-tag">Current tier</span> : null}
              </div>
              <h3>{tier.title}</h3>
              <p className="muted sub-tier-audience">{tier.audience}</p>
              <ul className="sub-tier-list">
                {tier.highlights.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <div className="sub-tier-foot">
                {isCurrent ? (
                  <span className="muted">
                    {tier.id === "enterprise"
                      ? `Active across ${Math.max(2, branchCount)} branches`
                      : "Active on this workspace"}
                  </span>
                ) : isLower ? (
                  <span className="muted">Included in your current tier</span>
                ) : tier.ctaHref ? (
                  <Link href={tier.ctaHref} className="btn btn-secondary btn-sm">
                    {tier.ctaLabel}
                  </Link>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
