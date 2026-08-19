"use client";

import Link from "next/link";
import { UpiPaymentsPanel } from "@/components/admin/UpiPaymentsPanel";

export default function AdminUpiPage() {
  return (
    <div className="admin-page">
      <section className="panel admin-card admin-page-head">
        <div className="analytics-toolbar">
          <div>
            <h2>UPI QR &amp; verification</h2>
            <p className="muted">
              This is the JustX company UPI account used on the operator checkout (“Pay JustX with UPI”).
              Operators scan the QR, submit their UTR, then you approve or reject here. Unlimited access
              turns on only after Approve.
            </p>
          </div>
          <div className="admin-form-row">
            <Link href="/admin/subscriptions" className="btn btn-ghost btn-sm">
              Plans
            </Link>
            <Link href="/admin/gateways" className="btn btn-ghost btn-sm">
              Other gateways
            </Link>
          </div>
        </div>
      </section>
      <UpiPaymentsPanel />
    </div>
  );
}
