"use client";

import Link from "next/link";

const STEPS = [
  { n: 1, label: "Select tools", href: "/subscription" },
  { n: 2, label: "Checkout", href: "/subscription/checkout" },
  { n: 3, label: "Verification", href: null },
] as const;

export function BillingStepper({
  current,
  pending,
}: {
  current: 1 | 2 | 3;
  pending?: boolean;
}) {
  return (
    <ol className="co-stepper" aria-label="Billing steps">
      {STEPS.map((step) => {
        const state = step.n < current ? "done" : step.n === current ? "current" : "todo";
        const label = step.n === 3 && pending ? "Verification" : step.label;
        const inner = (
          <>
            <span className="co-stepper-n">{step.n}</span>
            <span>{label}</span>
          </>
        );
        return (
          <li key={step.n} className={`co-stepper-item is-${state}`}>
            {step.href && step.n < current ? (
              <Link href={step.href}>{inner}</Link>
            ) : (
              inner
            )}
          </li>
        );
      })}
    </ol>
  );
}
