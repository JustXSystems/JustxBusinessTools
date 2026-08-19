"use client";

import { Modal } from "@/components/common/Modal";
import type { SubscriptionInfo } from "@/lib/types/subscription";

type Props = {
  open: boolean;
  onClose: () => void;
  subscription: SubscriptionInfo | null;
  onRefresh: () => Promise<void>;
};

/** Billing now lives on /subscription. Modal remains a fallback CTA. */
export function UpgradeModal({ open, onClose }: Props) {
  return (
    <Modal open={open} title="Subscribe to tools" onClose={onClose} maxWidth={480}>
      <p className="modal-msg">
        Each tool has its own monthly price. Open billing to build a cart and pay JustX by UPI.
      </p>
      <div className="modal-btns">
        <a className="btn btn-primary" href="/subscription" onClick={onClose}>
          Open catalog
        </a>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
          Not now
        </button>
      </div>
    </Modal>
  );
}
