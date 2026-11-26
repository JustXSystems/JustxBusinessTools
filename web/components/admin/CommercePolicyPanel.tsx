"use client";

import { useEffect, useMemo, useState } from "react";
import { AdminSection } from "@/components/admin/ui";
import { SelectField, SwitchField, TextField, TextareaField } from "@/components/admin/ui/AdminFields";
import { Badge, Button, FormGrid } from "@/components/bos";
import { api } from "@/lib/api";
import {
  DEFAULT_COMMERCE_POLICY,
  type BillingCycle,
  type CommercePolicy,
  type GstPricingMode,
  type UserCategory,
} from "@/lib/types/subscription";

type Props = {
  onMessage: (msg: string) => void;
  onError: (msg: string) => void;
};

function fmtInr(n: number): string {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

export function CommercePolicyPanel({ onMessage, onError }: Props) {
  const [policy, setPolicy] = useState<CommercePolicy>(DEFAULT_COMMERCE_POLICY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Live impact simulator state
  const [simMonthly, setSimMonthly] = useState("500");
  const [simCategory, setSimCategory] = useState<UserCategory>("business");
  const [simCycle, setSimCycle] = useState<BillingCycle>("year");
  const [simPromoPct, setSimPromoPct] = useState("15");

  useEffect(() => {
    setLoading(true);
    void api<{ policy: CommercePolicy }>("/admin/subscriptions/policy")
      .then((res) => {
        if (res.policy) setPolicy({ ...DEFAULT_COMMERCE_POLICY, ...res.policy });
      })
      .catch((err) => onError(err instanceof Error ? err.message : "Could not load commerce policy"))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sim = useMemo(() => {
    const baseMo = Math.max(0, Number(simMonthly) || 0);
    const effectiveCycle: BillingCycle = policy.annualEnabled ? simCycle : "month";
    const listPrice = effectiveCycle === "year" ? baseMo * 12 : baseMo;
    const cycleSubtotal =
      effectiveCycle === "year" ? baseMo * policy.defaultAnnualMonths : baseMo;

    const catPct = policy.categoryDiscountPct[simCategory] ?? 0;
    const catDiscount = Math.round((cycleSubtotal * catPct) / 100);
    const afterCategory = Math.max(0, cycleSubtotal - catDiscount);

    const promoPct = Math.max(0, Math.min(100, Number(simPromoPct) || 0));
    const promoBlocked =
      !policy.promosEnabled || (effectiveCycle === "year" && !policy.allowPromoOnAnnual);
    const rawPromo = promoBlocked ? 0 : Math.round((afterCategory * promoPct) / 100);
    const minAllowed = Math.round((listPrice * (100 - policy.maxCombinedDiscountPct)) / 100);
    const maxPromo = Math.max(0, afterCategory - minAllowed);
    const promoDiscount = Math.min(rawPromo, maxPromo);
    const promoCapped = rawPromo > maxPromo && maxPromo >= 0 && !promoBlocked && promoPct > 0;
    const netTotal = Math.max(0, afterCategory - promoDiscount);

    const applyGst = policy.gstEnabled && simCategory !== "individual";
    const rate = policy.gstRatePct / 100;
    const taxable =
      applyGst && policy.gstPricingMode === "inclusive"
        ? Math.round((netTotal / (1 + rate)) * 100) / 100
        : netTotal;
    const gstAmount = applyGst
      ? policy.gstPricingMode === "inclusive"
        ? Math.round((netTotal - taxable) * 100) / 100
        : Math.round(netTotal * rate * 100) / 100
      : 0;
    const grandTotal =
      applyGst && policy.gstPricingMode === "exclusive" ? Math.round(netTotal + gstAmount) : netTotal;

    return {
      effectiveCycle,
      listPrice,
      cycleSubtotal,
      catPct,
      catDiscount,
      promoBlocked,
      promoDiscount,
      promoCapped,
      taxable,
      gstAmount,
      grandTotal,
      applyGst,
    };
  }, [policy, simMonthly, simCategory, simCycle, simPromoPct]);

  async function save(e?: React.FormEvent) {
    e?.preventDefault();
    setSaving(true);
    try {
      const res = await api<{ policy: CommercePolicy }>("/admin/subscriptions/policy", {
        method: "PUT",
        body: JSON.stringify(policy),
      });
      if (res.policy) setPolicy(res.policy);
      onMessage("Commerce policy saved. Pricing, checkout, tax receipts, and renewals updated live.");
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not save commerce policy");
    } finally {
      setSaving(false);
    }
  }

  async function resetDefaults() {
    setSaving(true);
    try {
      const res = await api<{ policy: CommercePolicy }>("/admin/subscriptions/policy/reset", {
        method: "POST",
      });
      setPolicy(res.policy ?? DEFAULT_COMMERCE_POLICY);
      onMessage("Commerce policy reset to defaults.");
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not reset commerce policy");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="muted">Loading commerce policy…</p>;

  return (
    <form className="admin-cc-stack" onSubmit={(e) => void save(e)}>
      <AdminSection
        title="Live pricing, tax & discount simulator"
        description="Preview how your current policy affects a real customer order before saving."
        actions={
          <div className="admin-cc-actions">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={saving}
              onClick={() => void resetDefaults()}
            >
              Reset defaults
            </Button>
            <Button type="submit" variant="primary" size="sm" disabled={saving}>
              {saving ? "Saving…" : "Save policy"}
            </Button>
          </div>
        }
      >
        <FormGrid>
          <TextField
            label="Sample tool (₹/mo)"
            type="number"
            min={0}
            value={simMonthly}
            onChange={(e) => setSimMonthly(e.target.value)}
          />
          <SelectField
            label="User category"
            value={simCategory}
            onChange={(e) => setSimCategory(e.target.value as UserCategory)}
          >
            <option value="individual">Personal (no GSTIN)</option>
            <option value="business">Business (GSTIN)</option>
            <option value="enterprise">Enterprise (Multi-Branch)</option>
          </SelectField>
          <SelectField
            label="Cycle"
            value={simCycle}
            onChange={(e) => setSimCycle(e.target.value as BillingCycle)}
          >
            <option value="month">Monthly ({policy.monthlyDurationDays}d)</option>
            <option value="year">Yearly ({policy.annualDurationDays}d)</option>
          </SelectField>
          <TextField
            label="Sample promo (%)"
            type="number"
            min={0}
            max={100}
            value={simPromoPct}
            onChange={(e) => setSimPromoPct(e.target.value)}
          />
        </FormGrid>

        <div
          className="admin-cc-actions"
          style={{ marginTop: 14, flexWrap: "wrap", gap: 8 }}
          aria-live="polite"
        >
          <Badge auto tone="blue">
            List: {fmtInr(sim.listPrice)}
          </Badge>
          {sim.catDiscount > 0 ? (
            <Badge auto tone="emerald">
              Category ({sim.catPct}%): −{fmtInr(sim.catDiscount)}
            </Badge>
          ) : null}
          {sim.promoBlocked ? (
            <Badge auto tone="amber">
              Promo blocked by policy
            </Badge>
          ) : sim.promoDiscount > 0 ? (
            <Badge auto tone="emerald">
              Promo: −{fmtInr(sim.promoDiscount)}
              {sim.promoCapped ? ` (capped @ ${policy.maxCombinedDiscountPct}%)` : ""}
            </Badge>
          ) : null}
          {sim.applyGst ? (
            <Badge auto tone="neutral">
              Taxable ₹{sim.taxable.toFixed(2)} + GST {policy.gstRatePct}% ₹{sim.gstAmount.toFixed(2)} (SAC{" "}
              {policy.sacCode})
            </Badge>
          ) : (
            <Badge auto tone="neutral">
              Personal estimate (no GSTIN)
            </Badge>
          )}
          <Badge auto tone="lavender">
            Customer pays: {fmtInr(sim.grandTotal)}
          </Badge>
        </div>
      </AdminSection>

      <AdminSection
        title="1. Billing cycle & pricing"
        description="Control annual billing availability, default cycle, annual multiplier, and Auto-Save bundle nudges."
      >
        <FormGrid>
          <SwitchField
            label="Enable yearly billing"
            checked={policy.annualEnabled}
            onChange={(annualEnabled) =>
              setPolicy((p) => ({
                ...p,
                annualEnabled,
                defaultBillingCycle: annualEnabled ? p.defaultBillingCycle : "month",
              }))
            }
          />
          <SelectField
            label="Default storefront cycle"
            value={policy.defaultBillingCycle}
            disabled={!policy.annualEnabled}
            onChange={(e) =>
              setPolicy((p) => ({ ...p, defaultBillingCycle: e.target.value as BillingCycle }))
            }
          >
            <option value="month">Monthly</option>
            <option value="year">Yearly</option>
          </SelectField>
          <TextField
            label="Default annual multiplier (months paid)"
            type="number"
            min={1}
            max={12}
            value={String(policy.defaultAnnualMonths)}
            onChange={(e) =>
              setPolicy((p) => ({ ...p, defaultAnnualMonths: Number(e.target.value || 10) }))
            }
          />
          <TextField
            label="Monthly duration (days)"
            type="number"
            min={7}
            max={60}
            value={String(policy.monthlyDurationDays)}
            onChange={(e) =>
              setPolicy((p) => ({ ...p, monthlyDurationDays: Number(e.target.value || 30) }))
            }
          />
          <TextField
            label="Annual duration (days)"
            type="number"
            min={300}
            max={400}
            value={String(policy.annualDurationDays)}
            onChange={(e) =>
              setPolicy((p) => ({ ...p, annualDurationDays: Number(e.target.value || 365) }))
            }
          />
          <SwitchField
            label="Auto-Save pack recommendations in cart & checkout"
            checked={policy.autoSavePackNudgeEnabled}
            onChange={(autoSavePackNudgeEnabled) =>
              setPolicy((p) => ({ ...p, autoSavePackNudgeEnabled }))
            }
          />
        </FormGrid>
      </AdminSection>

      <AdminSection
        title="2. User categories & tier discounts"
        description="Define Enterprise branch threshold, automatic category discounts, and tier comparison visibility."
      >
        <FormGrid>
          <TextField
            label="Enterprise threshold (min branches)"
            type="number"
            min={2}
            max={20}
            value={String(policy.enterpriseMinBranches)}
            onChange={(e) =>
              setPolicy((p) => ({ ...p, enterpriseMinBranches: Number(e.target.value || 2) }))
            }
          />
          <TextField
            label="Personal category discount (%)"
            type="number"
            min={0}
            max={50}
            value={String(policy.categoryDiscountPct.individual)}
            onChange={(e) =>
              setPolicy((p) => ({
                ...p,
                categoryDiscountPct: {
                  ...p.categoryDiscountPct,
                  individual: Number(e.target.value || 0),
                },
              }))
            }
          />
          <TextField
            label="Business category discount (%)"
            type="number"
            min={0}
            max={50}
            value={String(policy.categoryDiscountPct.business)}
            onChange={(e) =>
              setPolicy((p) => ({
                ...p,
                categoryDiscountPct: {
                  ...p.categoryDiscountPct,
                  business: Number(e.target.value || 0),
                },
              }))
            }
          />
          <TextField
            label="Enterprise volume discount (%)"
            type="number"
            min={0}
            max={50}
            value={String(policy.categoryDiscountPct.enterprise)}
            onChange={(e) =>
              setPolicy((p) => ({
                ...p,
                categoryDiscountPct: {
                  ...p.categoryDiscountPct,
                  enterprise: Number(e.target.value || 0),
                },
              }))
            }
          />
          <SwitchField
            label="Allow Personal users to preview Business suite"
            checked={policy.allowPersonalBusinessPreview}
            onChange={(allowPersonalBusinessPreview) =>
              setPolicy((p) => ({ ...p, allowPersonalBusinessPreview }))
            }
          />
          <SwitchField
            label="Show Personal/Business/Enterprise comparison matrix"
            checked={policy.showTierComparisonMatrix}
            onChange={(showTierComparisonMatrix) =>
              setPolicy((p) => ({ ...p, showTierComparisonMatrix }))
            }
          />
        </FormGrid>
      </AdminSection>

      <AdminSection
        title="3. Trials, early renewals & notice sweep"
        description="Control batch trial activation, concurrent trial caps, renewal day-stacking, and sweep windows."
      >
        <FormGrid>
          <SwitchField
            label="Enable 1-click 'Start all free trials' button"
            checked={policy.allowBatchStartAllTrials}
            onChange={(allowBatchStartAllTrials) =>
              setPolicy((p) => ({ ...p, allowBatchStartAllTrials }))
            }
          />
          <TextField
            label="Max concurrent trials per workspace (blank = unlimited)"
            type="number"
            min={1}
            max={50}
            placeholder="Unlimited"
            value={
              policy.maxConcurrentTrialsPerOrg == null
                ? ""
                : String(policy.maxConcurrentTrialsPerOrg)
            }
            onChange={(e) =>
              setPolicy((p) => ({
                ...p,
                maxConcurrentTrialsPerOrg: e.target.value.trim()
                  ? Number(e.target.value)
                  : null,
              }))
            }
          />
          <TextField
            label="Early renewal window (days before expiry)"
            type="number"
            min={1}
            max={60}
            value={String(policy.earlyRenewalWindowDays)}
            onChange={(e) =>
              setPolicy((p) => ({ ...p, earlyRenewalWindowDays: Number(e.target.value || 7) }))
            }
          />
          <SwitchField
            label="Stack remaining paid days on early renewal"
            checked={policy.stackEarlyRenewalDays}
            onChange={(stackEarlyRenewalDays) =>
              setPolicy((p) => ({ ...p, stackEarlyRenewalDays }))
            }
          />
          <TextField
            label="Renewal sweep lookahead (days)"
            type="number"
            min={1}
            max={90}
            value={String(policy.renewalSweepDays)}
            onChange={(e) =>
              setPolicy((p) => ({ ...p, renewalSweepDays: Number(e.target.value || 14) }))
            }
          />
          <TextField
            label="Urgent notification threshold (days left)"
            type="number"
            min={1}
            max={14}
            value={String(policy.urgentWarningDays)}
            onChange={(e) =>
              setPolicy((p) => ({ ...p, urgentWarningDays: Number(e.target.value || 3) }))
            }
          />
        </FormGrid>
      </AdminSection>

      <AdminSection
        title="4. Tax (GST), proforma quotations & receipts"
        description="Configure GST rate, SAC code, seller GSTIN, and printable Proforma Quote / Tax Receipt rules."
      >
        <FormGrid>
          <SwitchField
            label="Show GST tax split for GSTIN workspaces"
            checked={policy.gstEnabled}
            onChange={(gstEnabled) => setPolicy((p) => ({ ...p, gstEnabled }))}
          />
          <TextField
            label="GST rate (%)"
            type="number"
            min={0}
            max={28}
            value={String(policy.gstRatePct)}
            onChange={(e) => setPolicy((p) => ({ ...p, gstRatePct: Number(e.target.value || 0) }))}
          />
          <SelectField
            label="GST pricing mode"
            value={policy.gstPricingMode}
            onChange={(e) =>
              setPolicy((p) => ({ ...p, gstPricingMode: e.target.value as GstPricingMode }))
            }
          >
            <option value="inclusive">Tax inclusive (listed price includes GST)</option>
            <option value="exclusive">Tax exclusive (add GST on top of subtotal)</option>
          </SelectField>
          <TextField
            label="SAC / HSN code"
            value={policy.sacCode}
            onChange={(e) => setPolicy((p) => ({ ...p, sacCode: e.target.value }))}
          />
          <TextField
            label="Seller GSTIN (optional, printed on quotes & receipts)"
            placeholder="e.g. 27ABCDE1234F1Z5"
            value={policy.sellerGstin ?? ""}
            onChange={(e) =>
              setPolicy((p) => ({ ...p, sellerGstin: e.target.value.toUpperCase() || null }))
            }
          />
          <SwitchField
            label="Enable 1-click Proforma Quote PDF"
            checked={policy.proformaQuoteEnabled}
            onChange={(proformaQuoteEnabled) =>
              setPolicy((p) => ({ ...p, proformaQuoteEnabled }))
            }
          />
          <TextField
            label="Proforma quote validity (days)"
            type="number"
            min={1}
            max={90}
            value={String(policy.proformaValidityDays)}
            onChange={(e) =>
              setPolicy((p) => ({ ...p, proformaValidityDays: Number(e.target.value || 7) }))
            }
          />
        </FormGrid>
        <div style={{ marginTop: 12 }}>
          <TextareaField
            label="Proforma / Receipt footer note"
            rows={2}
            value={policy.proformaFooterNote}
            onChange={(e) => setPolicy((p) => ({ ...p, proformaFooterNote: e.target.value }))}
          />
        </div>
      </AdminSection>

      <AdminSection
        title="5. Promo engine guardrails"
        description="Global promo kill-switch, discount stacking rules, and maximum combined discount safety cap."
      >
        <FormGrid>
          <SwitchField
            label="Enable promo codes at checkout"
            checked={policy.promosEnabled}
            onChange={(promosEnabled) => setPolicy((p) => ({ ...p, promosEnabled }))}
          />
          <SwitchField
            label="Surface 1-click featured promo chips in checkout"
            checked={policy.showFeaturedPromoChips}
            onChange={(showFeaturedPromoChips) =>
              setPolicy((p) => ({ ...p, showFeaturedPromoChips }))
            }
          />
          <TextField
            label="Max promo chips shown"
            type="number"
            min={0}
            max={8}
            value={String(policy.maxFeaturedPromoChips)}
            onChange={(e) =>
              setPolicy((p) => ({ ...p, maxFeaturedPromoChips: Number(e.target.value || 0) }))
            }
          />
          <SwitchField
            label="Allow promos on discounted packs"
            checked={policy.allowPromoOnPacks}
            onChange={(allowPromoOnPacks) => setPolicy((p) => ({ ...p, allowPromoOnPacks }))}
          />
          <SwitchField
            label="Allow promos on annual billing"
            checked={policy.allowPromoOnAnnual}
            onChange={(allowPromoOnAnnual) => setPolicy((p) => ({ ...p, allowPromoOnAnnual }))}
          />
          <TextField
            label="Max combined discount safety cap (%)"
            type="number"
            min={0}
            max={100}
            value={String(policy.maxCombinedDiscountPct)}
            onChange={(e) =>
              setPolicy((p) => ({ ...p, maxCombinedDiscountPct: Number(e.target.value || 50) }))
            }
          />
        </FormGrid>
      </AdminSection>

      <AdminSection
        title="6. Usage telemetry & proactive nudges"
        description="Tune when quota banners warn users and how 1-click upgrade CTAs route into checkout."
        actions={
          <Button type="submit" variant="primary" size="sm" disabled={saving}>
            {saving ? "Saving…" : "Save policy"}
          </Button>
        }
      >
        <FormGrid>
          <TextField
            label="Near-limit warning threshold (%)"
            type="number"
            min={50}
            max={99}
            value={String(policy.nearLimitThresholdPct)}
            onChange={(e) =>
              setPolicy((p) => ({ ...p, nearLimitThresholdPct: Number(e.target.value || 80) }))
            }
          />
          <SwitchField
            label="Show proactive subscription strip on Home dashboard"
            checked={policy.showHomeSubscriptionStrip}
            onChange={(showHomeSubscriptionStrip) =>
              setPolicy((p) => ({ ...p, showHomeSubscriptionStrip }))
            }
          />
          <SelectField
            label="Default checkout cycle from nudges & banners"
            value={policy.defaultCheckoutCycleFromNudge}
            disabled={!policy.annualEnabled}
            onChange={(e) =>
              setPolicy((p) => ({
                ...p,
                defaultCheckoutCycleFromNudge: e.target.value as BillingCycle,
              }))
            }
          >
            <option value="year">Yearly (maximize LTV)</option>
            <option value="month">Monthly (lowest friction)</option>
          </SelectField>
        </FormGrid>
      </AdminSection>
    </form>
  );
}
