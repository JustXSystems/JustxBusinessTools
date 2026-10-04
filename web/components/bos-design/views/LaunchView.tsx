"use client";

import { useState } from "react";
import {
  ActionTicker,
  AppShell,
  Avatar,
  BosIcon,
  Breadcrumbs,
  Button,
  Checkbox,
  EmptyState,
  Field,
  FilterChip,
  Grid,
  IconButton,
  Input,
  KpiCard,
  ProfileHeader,
  Segmented,
  TimePill,
  WidgetCard,
  WidgetRow,
  Celebrations,
  useToast,
  type BosIconName,
} from "@/components/bos";
import { HOME_CELEBRATIONS, SIGNED_IN_USER, TICKER_ITEMS } from "../data/common";

type Stage = "idle" | "splash" | "login" | "home";
type HomeModule = "myprofile" | "dashboard" | "hr" | "admin" | "sales" | "projects";

const HOME_NAV: ReadonlyArray<{ key: HomeModule; label: string; icon: BosIconName; section?: string }> = [
  { key: "myprofile", label: "My Profile", icon: "user" },
  { key: "dashboard", label: "Dashboard", icon: "grid" },
  { key: "hr", label: "HR Management", icon: "users", section: "Workspace" },
  { key: "admin", label: "Administration", icon: "settings", section: "Workspace" },
  { key: "sales", label: "Sales & CRM", icon: "trend", section: "Workspace" },
  { key: "projects", label: "Projects", icon: "layers", section: "Workspace" },
];

const PLACEHOLDERS: Record<"admin" | "sales" | "projects", { glyph: string; title: string; desc: string }> = {
  admin: { glyph: "⚙", title: "Administration", desc: "User & role management, audit logs, and system settings live here." },
  sales: { glyph: "◈", title: "Sales & CRM", desc: "Pipeline, leads, and customer accounts live here." },
  projects: { glyph: "▤", title: "Projects", desc: "Active projects, timelines, and milestones live here." },
};

const QUICK_LINKS = ["Apply Leave", "Holiday Calendar", "My Payslip", "My Documents", "Attendance History"];

function LoginCard({ onSignIn }: { onSignIn: () => void }) {
  const { show } = useToast();
  const [method, setMethod] = useState<"password" | "otp">("password");
  const [remember, setRemember] = useState(true);
  return (
    <form
      className="bos-login-card"
      onSubmit={(e) => {
        e.preventDefault();
        onSignIn();
      }}
    >
      <h2 className="bos-login-title">Welcome to Justx Systems</h2>
      <p className="bos-login-sub">Sign in to your Justx BOS workspace.</p>
      <Segmented
        block
        role="tabs"
        aria-label="Sign-in method"
        options={[
          { value: "password", label: "Password" },
          { value: "otp", label: "Mobile OTP" },
        ]}
        value={method}
        onChange={setMethod}
      />
      {method === "password" ? (
        <>
          <Field label="Employee ID or work email">{({ id }) => <Input id={id} defaultValue={SIGNED_IN_USER.email} autoComplete="username" />}</Field>
          <Field label="Password">{({ id }) => <Input id={id} type="password" defaultValue="demo-password" autoComplete="current-password" />}</Field>
          <div className="bos-login-between">
            <label className="bos-login-remember">
              <Checkbox checked={remember} onChange={setRemember} aria-label="Remember this device" />
              Remember this device
            </label>
            <button type="button" className="bos-link" onClick={() => show({ title: "Password reset", description: "A reset link goes to the work email in a live tenant." })}>
              Forgot password?
            </button>
          </div>
          <Button type="submit" variant="primary" block>
            Sign in
          </Button>
        </>
      ) : (
        <>
          <Field label="Registered mobile number">{({ id }) => <Input id={id} defaultValue={SIGNED_IN_USER.mobile} inputMode="tel" />}</Field>
          <p className="bos-otp-hint">Enter the 6-digit code sent to your phone.</p>
          <Button type="submit" variant="primary" block>
            Verify &amp; sign in
          </Button>
        </>
      )}
      <div className="bos-login-note">
        <BosIcon name="lock" />
        Protected by enterprise-grade encryption
      </div>
    </form>
  );
}

function MyProfile() {
  const { show } = useToast();
  return (
    <>
      <ProfileHeader
        avatar={
          <Avatar size="xl" tone="var(--bos-blue)">
            <BosIcon name="user" width={26} height={26} />
          </Avatar>
        }
        name={SIGNED_IN_USER.name}
        role={SIGNED_IN_USER.role}
        corner={
          <>
            <TimePill />
            <IconButton icon="bell" dot aria-label="Notifications" />
          </>
        }
        details={[
          { label: "Employee ID", value: "JX-2291" },
          { label: "Department", value: "Field Operations" },
          { label: "Designation", value: "Operations Manager" },
          { label: "Work Email", value: SIGNED_IN_USER.email },
          { label: "Mobile", value: SIGNED_IN_USER.mobile },
          { label: "Reporting Manager", value: "Anita Desai" },
          { label: "Date of Joining", value: "12 Mar 2023" },
          { label: "Employment Type", value: "Full-time" },
        ]}
      />
      <Grid cols={4} gap={12} style={{ marginBottom: 20 }}>
        <WidgetCard title="My Tasks" dot="sage">
          <WidgetRow label="New Tasks" value={8} valueTone="blue" />
          <WidgetRow label="Tasks In Progress" value={12} valueTone="emerald" />
          <WidgetRow label="Pending Tasks" value={5} valueTone="coral" />
          <WidgetRow label="Tasks On Hold" value={2} valueTone="amber" />
          <WidgetRow label="Recurring Tasks" value={4} valueTone="faint" />
        </WidgetCard>
        <WidgetCard title="My Projects" dot="mint">
          <WidgetRow label="Active Projects" value={6} valueTone="emerald" />
          <WidgetRow label="Completed Projects" value={21} valueTone="blue" />
          <WidgetRow label="Upcoming Projects" value={3} valueTone="faint" />
          <WidgetRow label="Projects On Hold" value={2} valueTone="coral" />
        </WidgetCard>
        <WidgetCard title="My Reports" dot="lavender">
          {["My Task Sheet", "Work Report", "Projects Reports", "Customer Reports"].map((r) => (
            <WidgetRow key={r} label={r} chevron onClick={() => show({ title: r, description: "Opens the report in a live tenant." })} />
          ))}
        </WidgetCard>
        <WidgetCard title="Leave & Attendance" dot="blue">
          <WidgetRow label="Casual Leave" value={6} valueTone="blue" />
          <WidgetRow label="Sick Leave" value={5} valueTone="emerald" />
          <WidgetRow label="Present (Jul)" value={22} valueTone="emerald" />
          <WidgetRow label="Absent (Jul)" value={1} valueTone="coral" />
        </WidgetCard>
      </Grid>
      <div className="bos-row" style={{ gap: 8, marginBottom: 20 }}>
        {QUICK_LINKS.map((l) => (
          <FilterChip key={l} onClick={() => show({ title: l, description: "Quick link — sample only." })}>
            {l}
          </FilterChip>
        ))}
      </div>
      <ActionTicker items={TICKER_ITEMS} />
      <Celebrations items={HOME_CELEBRATIONS} />
    </>
  );
}

function HomeModuleView({ module, onOpenHrm, goHome }: { module: HomeModule; onOpenHrm?: () => void; goHome: () => void }) {
  const label = HOME_NAV.find((n) => n.key === module)?.label ?? "";
  if (module === "myprofile") return <MyProfile />;
  const crumbs = <Breadcrumbs items={[{ label: "Justx BOS", onClick: goHome }, { label }]} />;
  if (module === "dashboard") {
    return (
      <>
        {crumbs}
        <div className="bos-greeting">Good morning, {SIGNED_IN_USER.firstName} 👋</div>
        <div className="bos-greeting-sub">Here&apos;s what&apos;s waiting for you today.</div>
        <Grid cols={2} min={140}>
          <KpiCard label="Open service tickets" value="27" chip={{ color: "rose", glyph: "✦" }} delta="▲ 6 since yesterday" deltaTone="down" />
          <KpiCard label="Pending approvals" value="4" chip={{ color: "blue", glyph: "◎" }} delta="Awaiting your review" />
        </Grid>
      </>
    );
  }
  if (module === "hr") {
    return (
      <>
        {crumbs}
        <div className="bos-greeting" style={{ fontSize: 18 }}>
          Good morning, {SIGNED_IN_USER.firstName} 👋
        </div>
        <div className="bos-greeting-sub">214 employees · 198 present today.</div>
        <Grid cols={2} min={140} style={{ marginBottom: 16 }}>
          <KpiCard label="Present today" value="198" chip={{ color: "mint", glyph: "✓" }} delta="92.5% attendance" />
          <KpiCard label="Pending leave requests" value="4" chip={{ color: "rose", glyph: "◐" }} delta="Needs your review" deltaTone="warn" />
        </Grid>
        <Button size="sm" onClick={onOpenHrm}>
          View full HR module →
        </Button>
      </>
    );
  }
  const p = PLACEHOLDERS[module];
  return (
    <>
      {crumbs}
      <EmptyState glyph={p.glyph} title={p.title}>
        {p.desc}
      </EmptyState>
    </>
  );
}

export function LaunchView({ logoSrc, onOpenHrm }: { logoSrc: string; onOpenHrm?: () => void }) {
  const [stage, setStage] = useState<Stage>("idle");
  const [module, setModule] = useState<HomeModule>("myprofile");

  const restart = () => {
    setModule("myprofile");
    setStage("idle");
  };

  return (
    <div className="bos-launch" aria-live="polite">
      {stage !== "idle" ? (
        <Button size="sm" icon="refresh" className="bos-launch-restart" onClick={restart}>
          Restart demo
        </Button>
      ) : null}

      {stage === "idle" ? (
        <div className="bos-launch-stage">
          {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset under the app base path */}
          <img className="bos-launch-idle-logo" src={logoSrc} alt="" />
          <p className="bos-launch-idle-text">This is what a user sees the moment they open the application.</p>
          <Button variant="primary" onClick={() => setStage("splash")}>
            ▶ Open Application
          </Button>
        </div>
      ) : null}

      {stage === "splash" ? (
        <div className="bos-launch-stage">
          {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset under the app base path */}
          <img className="bos-splash-logo" src={logoSrc} alt="Justx" />
          <div className="bos-splash-welcome">Welcome to Justx</div>
          <div className="bos-splash-sub">Setting up your workspace…</div>
          <Button variant="primary" className="bos-splash-cta" onClick={() => setStage("login")}>
            Login
          </Button>
        </div>
      ) : null}

      {stage === "login" ? (
        <div className="bos-launch-stage">
          <LoginCard
            onSignIn={() => {
              setModule("myprofile");
              setStage("home");
            }}
          />
        </div>
      ) : null}

      {stage === "home" ? (
        <div className="bos-launch-stage is-fill">
          <AppShell
            size="fill"
            aria-label="Workspace navigation"
            brand={null}
            items={HOME_NAV.map((n) => ({ key: n.key, label: n.label, section: n.section, icon: <BosIcon name={n.icon} /> }))}
            active={module}
            onSelect={setModule}
          >
            <div key={module} className="bos-fade-in">
              <HomeModuleView module={module} onOpenHrm={onOpenHrm} goHome={() => setModule("myprofile")} />
            </div>
          </AppShell>
        </div>
      ) : null}
    </div>
  );
}
