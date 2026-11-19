"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Alert,
  BosRoot,
  Button,
  Card,
  Checkbox,
  Field,
  SearchInput,
  Segmented,
  Skeleton,
} from "@/components/bos";
import { useAuth } from "@/components/auth/AuthProvider";
import { PlatformBrandMark } from "@/components/branding/PlatformBrandMark";
import { PoweredByFooter } from "@/components/layout/PoweredByFooter";
import { adminDeepLink } from "@/lib/admin-deep-links";
import { isEnterableBranch, safeAppPath } from "@/lib/auth-access";
import { withBasePath } from "@/lib/base-path";
import type { SessionUser } from "@/lib/types/auth";
import "@/components/admin/admin-console.css";

type Branch = SessionUser["branches"][number];

const ROLES: Array<{ id: "owner" | "admin" | "staff" | "viewer"; label: string; hint: string }> = [
  { id: "owner", label: "Owner", hint: "Full Business Profile, Sync Center, team" },
  { id: "admin", label: "Org Admin", hint: "Same as Owner on operator; no /admin" },
  { id: "staff", label: "Staff", hint: "Tools + Email Outbox; Profile read-only" },
  { id: "viewer", label: "Viewer", hint: "Home + My Tools only" },
];

function safeNext(raw: string | null): string {
  return safeAppPath(raw, {
    fallback: "/",
    denyPrefixes: ["/login", "/register", "/enter", "/admin"],
  });
}

function parseProfileParam(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function parseRoleParam(raw: string | null): "owner" | "admin" | "staff" | "viewer" | "" {
  if (!raw) return "";
  const key = raw.trim().toLowerCase();
  return ROLES.some((r) => r.id === key) ? (key as "owner" | "admin" | "staff" | "viewer") : "";
}

function branchLabel(b: Branch): string {
  const status = String(b.approvalStatus ?? "approved").toLowerCase();
  const flags: string[] = [];
  if (b.archivedAt) flags.push("archived");
  else if (status !== "approved") flags.push(status);
  const suffix = flags.length ? ` [${flags.join(", ")}]` : "";
  return `${b.organizationName ? `${b.organizationName} — ` : ""}${b.businessName}${
    b.gstin ? ` (${b.gstin})` : ""
  }${suffix}`;
}

function resolveInitialProfileId(
  pool: Branch[],
  preferId: number | null,
  sessionProfileId: number | null | undefined,
): number | null {
  if (preferId != null && pool.some((b) => b.id === preferId)) return preferId;
  if (sessionProfileId != null && pool.some((b) => b.id === sessionProfileId)) {
    return sessionProfileId;
  }
  return pool[0]?.id ?? null;
}

function EnterLoading({ label = "Loading…" }: { label?: string }) {
  return (
    <BosRoot canvas className="admin-bos" defaultTheme="dark" skin="bos">
      <div className="admin-cc-login">
        <Card className="admin-cc-login-card" style={{ width: "min(520px, 100%)" }}>
          <Skeleton width="40%" height={18} radius={6} />
          <div style={{ height: 12 }} />
          <Skeleton width="100%" height={12} radius={4} />
          <div style={{ height: 8 }} />
          <Skeleton width="85%" height={12} radius={4} />
          <p className="bos-text-muted" style={{ margin: "16px 0 0", fontSize: 13 }}>
            {label}
          </p>
        </Card>
      </div>
    </BosRoot>
  );
}

function EnterInner() {
  const { user, loading, isPlatformAdmin, setOperatorContext } = useAuth();
  const router = useRouter();
  const search = useSearchParams();
  const next = safeNext(search.get("next"));
  const preferProfileId = parseProfileParam(search.get("profile"));
  const preferRole = parseRoleParam(search.get("role"));

  const branches = user?.branches ?? [];
  const [query, setQuery] = useState("");
  const [includeNonLive, setIncludeNonLive] = useState(false);
  const [profileId, setProfileId] = useState<number | null>(null);
  const [role, setRole] = useState<"owner" | "admin" | "staff" | "viewer" | "">(preferRole);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [profileWarn, setProfileWarn] = useState("");

  const liveBranches = useMemo(
    () => branches.filter((b) => isEnterableBranch(b)),
    [branches],
  );
  const sourceBranches = includeNonLive ? branches : liveBranches;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sourceBranches;
    return sourceBranches.filter((b) =>
      `${b.organizationName ?? ""} ${b.businessName} ${b.gstin ?? ""} ${b.approvalStatus ?? ""}`
        .toLowerCase()
        .includes(q),
    );
  }, [sourceBranches, query]);

  useEffect(() => {
    if (loading) return;
    if (!user || !isPlatformAdmin) {
      window.location.assign(withBasePath("/"));
    }
  }, [loading, user, isPlatformAdmin]);

  useEffect(() => {
    if (loading || !user?.isPlatformAdmin) return;

    if (preferProfileId != null && !branches.some((b) => b.id === preferProfileId)) {
      setProfileWarn(
        `Profile #${preferProfileId} is not in your session list — pick another Business Profile.`,
      );
    } else if (
      preferProfileId != null &&
      !includeNonLive &&
      branches.some((b) => b.id === preferProfileId) &&
      !liveBranches.some((b) => b.id === preferProfileId)
    ) {
      setProfileWarn(
        `Profile #${preferProfileId} is pending or archived. Enable “Include pending & archived” to select it.`,
      );
      setIncludeNonLive(true);
    } else {
      setProfileWarn("");
    }

    if (sourceBranches.length === 0) {
      setProfileId(null);
      setHydrated(true);
      return;
    }

    setProfileId((prev) => {
      if (prev != null && sourceBranches.some((b) => b.id === prev)) return prev;
      return resolveInitialProfileId(sourceBranches, preferProfileId, user.businessProfileId);
    });
    setRole((prev) => prev || preferRole || user.actAsRole || "owner");
    setHydrated(true);
  }, [
    loading,
    user,
    branches,
    liveBranches,
    sourceBranches,
    preferProfileId,
    preferRole,
    includeNonLive,
  ]);

  useEffect(() => {
    if (!hydrated || profileId == null) return;
    if (filtered.some((b) => b.id === profileId)) return;
    if (filtered[0]) setProfileId(filtered[0].id);
  }, [filtered, hydrated, profileId]);

  if (loading || !user || !isPlatformAdmin) {
    return <EnterLoading label={loading ? "Loading…" : "Redirecting…"} />;
  }

  const selectValue =
    profileId != null && filtered.some((b) => b.id === profileId)
      ? String(profileId)
      : filtered[0]
        ? String(filtered[0].id)
        : "";
  const effectiveProfileId = selectValue ? Number(selectValue) : null;
  const noProfiles = branches.length === 0;
  const noLive = !noProfiles && liveBranches.length === 0 && !includeNonLive;
  const selectedBranch =
    effectiveProfileId != null
      ? branches.find((b) => b.id === effectiveProfileId) ?? null
      : null;
  const selectedIsLive = selectedBranch ? isEnterableBranch(selectedBranch) : false;

  async function continueAs() {
    if (effectiveProfileId == null || !role) {
      setError("Select a Business Profile and a role to continue");
      return;
    }
    if (!selectedIsLive) {
      setError("Act-as requires an approved, non-archived Business Profile");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await setOperatorContext(effectiveProfileId, role);
      router.replace(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start impersonation");
    } finally {
      setBusy(false);
    }
  }

  return (
    <BosRoot canvas className="admin-bos" defaultTheme="dark" skin="bos">
      <div className="admin-cc-login admin-cc-enter">
        <Card className="admin-cc-login-card admin-cc-enter-card">
          <div className="admin-cc-login-brand">
            <PlatformBrandMark href="/admin" size="md" showText={false} />
            <div>
              <h1>Enter Operator as…</h1>
              <p>Reproduce a customer’s menus and capability gates</p>
            </div>
          </div>

          <p className="bos-text-muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.45 }}>
            Pick a live Business Profile and org role. This does not sign in as their password or MFA —
            it enacts their menus and capability gates. Admin Console stays global and ignores this
            context.
          </p>

          {noProfiles ? (
            <Alert
              tone="coral"
              title="No Business Profiles yet"
              actions={
                <Link href={adminDeepLink.profiles()}>
                  <Button variant="secondary" size="sm">
                    Create one
                  </Button>
                </Link>
              }
            >
              Create a profile in Organizations, approve it, then return here.
            </Alert>
          ) : null}

          {noLive ? (
            <Alert
              tone="amber"
              title="No live profiles"
              actions={
                <Link href={adminDeepLink.profilePending()}>
                  <Button variant="secondary" size="sm">
                    Approvals
                  </Button>
                </Link>
              }
            >
              Enable “Include pending &amp; archived” or approve a pending profile.
            </Alert>
          ) : null}

          {profileWarn ? <Alert tone="amber" title="Profile notice">{profileWarn}</Alert> : null}

          <SearchInput
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Organization, business name, or GSTIN"
            autoComplete="off"
            disabled={noProfiles}
            aria-label="Search profiles"
          />

          <label className="admin-cc-enter-check">
            <Checkbox
              checked={includeNonLive}
              onChange={setIncludeNonLive}
              disabled={noProfiles}
              aria-label="Show pending and archived profiles"
            />
            <span>Show pending &amp; archived (view only — cannot enter)</span>
          </label>

          <Field label="Business Profile" full>
            {({ id, describedBy, invalid }) => (
              <select
                id={id}
                aria-describedby={describedBy}
                aria-invalid={invalid || undefined}
                value={selectValue}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setProfileId(Number.isInteger(v) && v > 0 ? v : null);
                  setProfileWarn("");
                }}
                required
                size={Math.min(10, Math.max(4, filtered.length || 4))}
                className="bos-input admin-cc-enter-list"
                aria-label="Business Profile"
                disabled={noProfiles || filtered.length === 0}
              >
                {filtered.length === 0 ? (
                  <option value="">No matching profiles</option>
                ) : (
                  filtered.map((b) => (
                    <option key={b.id} value={b.id}>
                      {branchLabel(b)}
                    </option>
                  ))
                )}
              </select>
            )}
          </Field>

          <div>
            <div className="bos-field-label" style={{ marginBottom: 8 }}>
              Act as role
            </div>
            <Segmented
              role="radio"
              block
              wrap
              aria-label="Act as role"
              value={(role || "owner") as "owner" | "admin" | "staff" | "viewer"}
              onChange={(v) => setRole(v)}
              options={ROLES.map((r) => ({
                value: r.id,
                label: r.label,
                ariaLabel: `${r.label}: ${r.hint}`,
              }))}
            />
            <p className="bos-text-muted" style={{ margin: "8px 0 0", fontSize: 12.5 }}>
              {ROLES.find((r) => r.id === (role || "owner"))?.hint}
            </p>
          </div>

          {error ? <Alert tone="coral" title="Could not enter">{error}</Alert> : null}

          <div className="admin-cc-link-row">
            <Button
              variant="primary"
              disabled={busy || effectiveProfileId == null || !role || noProfiles || !selectedIsLive}
              onClick={() => void continueAs()}
            >
              {busy ? "Entering…" : "Enter Operator"}
            </Button>
            <Link href="/admin">
              <Button variant="secondary">Back to Admin Console</Button>
            </Link>
          </div>
        </Card>
        <PoweredByFooter />
      </div>
    </BosRoot>
  );
}

export default function EnterPage() {
  return (
    <Suspense fallback={<EnterLoading />}>
      <EnterInner />
    </Suspense>
  );
}
