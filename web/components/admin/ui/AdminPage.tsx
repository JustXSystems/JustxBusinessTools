"use client";

import type { ReactNode } from "react";
import {
  Alert,
  Button,
  EmptyState,
  Grid,
  ModuleHeader,
  ModuleToolbar,
  Segmented,
  Skeleton,
  cx,
  type BosIconName,
  type BosSegmentOption,
} from "@/components/bos";

/** Standard admin page frame: module header + optional toolbar + scroll body. */
export function AdminPage({
  title,
  sub,
  brand = "Control center",
  toolbar,
  children,
  className,
}: {
  title: ReactNode;
  sub?: ReactNode;
  brand?: ReactNode;
  toolbar?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("admin-cc-page", className)}>
      <ModuleHeader title={title} sub={sub} brand={brand} />
      {toolbar ? <ModuleToolbar>{toolbar}</ModuleToolbar> : null}
      <div className="admin-cc-body">{children}</div>
    </div>
  );
}

export function AdminPageSkeleton({ cards = 4 }: { cards?: number }) {
  return (
    <div className="admin-cc-page" aria-busy="true" aria-label="Loading">
      <div className="admin-cc-skel-head">
        <Skeleton width={220} height={18} radius={6} />
        <Skeleton width={120} height={12} radius={6} />
      </div>
      <Grid cols={4} min={140} gap={12}>
        {Array.from({ length: cards }, (_, i) => (
          <div key={i} className="bos-card" style={{ padding: 16 }}>
            <Skeleton width="40%" height={10} radius={4} />
            <div style={{ height: 10 }} />
            <Skeleton width="70%" height={22} radius={6} />
            <div style={{ height: 10 }} />
            <Skeleton width="55%" height={10} radius={4} />
          </div>
        ))}
      </Grid>
      <div style={{ height: 16 }} />
      <div className="bos-card" style={{ padding: 16 }}>
        <Skeleton width="30%" height={14} radius={4} />
        <div style={{ height: 14 }} />
        <Skeleton width="100%" height={120} radius={8} />
      </div>
    </div>
  );
}

export function AdminErrorState({
  title = "Couldn’t load this view",
  message,
  onRetry,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <Alert
      tone="coral"
      title={title}
      actions={
        onRetry ? (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Retry
          </Button>
        ) : undefined
      }
    >
      {message}
    </Alert>
  );
}

export function AdminEmpty({
  title,
  children,
  icon = "sparkle",
  actions,
}: {
  title: ReactNode;
  children?: ReactNode;
  icon?: BosIconName;
  actions?: ReactNode;
}) {
  return (
    <EmptyState icon={icon} title={title} actions={actions}>
      {children}
    </EmptyState>
  );
}

/** BOS segmented tabs for admin multi-pane pages. */
export function AdminTabs<V extends string>({
  options,
  value,
  onChange,
  "aria-label": ariaLabel = "Section",
}: {
  options: ReadonlyArray<BosSegmentOption<V>>;
  value: V;
  onChange: (value: V) => void;
  "aria-label"?: string;
}) {
  return (
    <Segmented
      role="tabs"
      scroll
      aria-label={ariaLabel}
      options={options}
      value={value}
      onChange={onChange}
    />
  );
}

export function AdminSection({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx("bos-widget", "admin-cc-section", className)}>
      <div className="admin-cc-section-head">
        <div>
          <h3 className="bos-widget-title" style={{ margin: 0 }}>
            <span className="bos-widget-dot" style={{ background: "var(--bos-pastel-blue)" }} aria-hidden />
            {title}
          </h3>
          {description ? <p className="admin-cc-section-desc">{description}</p> : null}
        </div>
        {actions ? <div className="admin-cc-section-actions">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}
