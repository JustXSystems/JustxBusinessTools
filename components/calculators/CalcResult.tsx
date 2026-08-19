import type { ReactNode } from "react";
import Link from "next/link";

type Item = { value: string; label: string };

type Props = {
  value: string;
  label: string;
  items: Item[];
};

export function CalcResult({ value, label, items }: Props) {
  return (
    <div className="result-box">
      <div className="result-value">{value}</div>
      <div className="result-label">{label}</div>
      <div className="result-grid">
        {items.map((item) => (
          <div key={item.label} className="rg-item">
            <div className="rg-val">{item.value}</div>
            <div className="rg-lbl">{item.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

type LayoutProps = {
  title: string;
  icon: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
};

export function CalcLayout({ title, icon, subtitle, children, footer }: LayoutProps) {
  return (
    <div>
      <div className="tool-header">
        <Link href="/" className="back-btn" aria-label="Back">←</Link>
        <div className="tool-header-text">
          <div className="tool-header-title">{icon} {title}</div>
          <div className="tool-header-sub">{subtitle}</div>
        </div>
      </div>
      {children}
      {footer}
    </div>
  );
}
