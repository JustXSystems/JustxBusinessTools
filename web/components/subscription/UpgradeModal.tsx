"use client";

import Link from "next/link";
import { Modal } from "@/components/common/Modal";
import { describeUserCategory } from "@/lib/subscription-store-helpers";
import type { SubscriptionInfo } from "@/lib/types/subscription";
import { useBrandCopy } from "@/lib/use-brand-copy";

type Props = {
  open: boolean;
  onClose: () => void;
  subscription: SubscriptionInfo | null;
  onRefresh: () => Promise<void>;
};

/** Smart upgrade overview modal with category awareness and Monthly vs Annual fast-track links. */
export function UpgradeModal({ open, onClose, subscription }: Props) {
  const { appName } = useBrandCopy();
  const meta = describeUserCategory(subscription?.userCategory, subscription?.branchCount ?? 1);
  const alerts =
    (subscription?.usageSummary?.toolsNearLimit ?? 0) +
    (subscription?.usageSummary?.toolsAtLimit ?? 0) +
    (subscription?.usageSummary?.trialsExpiringSoon ?? 0);
  const trialReadyCount = (subscription?.catalog ?? []).filter((s) => s.trialEligible).length;

  return (
    <Modal open={open} title="Upgrade your workspace" onClose={onClose} maxWidth={500}>
      <div className="sub-modal-body">
        <span className={`sub-tier-pill is-${meta.tone}`}>{meta.badge}</span>
        <p className="modal-msg">
          Choose individual tools or discounted packs on {appName}. Start eligible free trials with ₹0 MRR or save 17%
          (2 months free) with annual billing.
        </p>
        {alerts > 0 || trialReadyCount > 0 ? (
          <div className="sub-modal-stats">
            {alerts > 0 ? <span>{alerts} tool(s) near limit or expiring soon</span> : null}
            {trialReadyCount > 0 ? <span>{trialReadyCount} free trial(s) available</span> : null}
          </div>
        ) : null}
      </div>
      <div className="modal-btns">
        <Link className="btn btn-primary" href="/subscription?cycle=year" onClick={onClose}>
          Explore annual plans (Save 17%)
        </Link>
        <Link className="btn btn-secondary btn-sm" href="/subscription" onClick={onClose}>
          Monthly catalog
        </Link>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
          Not now
        </button>
      </div>
    </Modal>
  );
}
