"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import { PlatformBrandMark } from "@/components/branding/PlatformBrandMark";
import { PoweredByFooter } from "@/components/layout/PoweredByFooter";
import { isEnterableBranch, safeAppPath } from "@/lib/auth-access";
import { withBasePath } from "@/lib/base-path";
import type { SessionUser } from "@/lib/types/auth";

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
    setRole((prev) => prev || preferRole || user.actAsRole || "");
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
    return (
      <div className="enter-page">
        <p className="muted">{loading ? "Loading…" : "Redirecting…"}</p>
      </div>
    );
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
    <div className="enter-page">
      <div className="enter-card panel admin-card">
        <PlatformBrandMark href="/admin" size="md" layout="row" showText />
        <h1>Enter Operator as…</h1>
        <p className="muted">
          Pick a live Business Profile and org role to reproduce authorization the way that customer
          sees it. This does not sign in as their password or MFA — it enacts their menus and
          capability gates. Admin Console stays global and ignores this context.
        </p>

        {noProfiles ? (
          <p className="enter-error">
            No Business Profiles exist yet. Create and approve one in Admin → Profiles, then return
            here.
          </p>
        ) : null}

        {noLive ? (
          <p className="enter-error">
            No approved, non-archived profiles. Enable “Include pending &amp; archived” or approve a
            profile in Admin Console.
          </p>
        ) : null}

        {profileWarn ? <p className="enter-warn">{profileWarn}</p> : null}

        <label className="field">
          <span>Search profiles</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Organization, business name, or GSTIN"
            autoComplete="off"
            disabled={noProfiles}
          />
        </label>

        <label className="enter-toggle">
          <input
            type="checkbox"
            checked={includeNonLive}
            onChange={(e) => setIncludeNonLive(e.target.checked)}
            disabled={noProfiles}
          />
          <span>Show pending &amp; archived (view only — cannot enter)</span>
        </label>

        <label className="field">
          <span>Business Profile</span>
          <select
            value={selectValue}
            onChange={(e) => {
              const v = Number(e.target.value);
              setProfileId(Number.isInteger(v) && v > 0 ? v : null);
              setProfileWarn("");
            }}
            required
            size={Math.min(10, Math.max(4, filtered.length || 4))}
            className="enter-profile-list"
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
        </label>

        <fieldset className="enter-roles">
          <legend>Act as role</legend>
          <div className="enter-role-grid">
            {ROLES.map((r) => (
              <label key={r.id} className={`enter-role${role === r.id ? " is-selected" : ""}`}>
                <input
                  type="radio"
                  name="actAsRole"
                  value={r.id}
                  checked={role === r.id}
                  onChange={() => setRole(r.id)}
                  disabled={noProfiles}
                />
                <span>
                  <strong>{r.label}</strong>
                  <span className="muted small">{r.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {error ? <p className="enter-error">{error}</p> : null}

        <div className="admin-form-row enter-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={
              busy || effectiveProfileId == null || !role || noProfiles || !selectedIsLive
            }
            onClick={() => void continueAs()}
          >
            {busy ? "Entering…" : "Enter Operator"}
          </button>
          <Link href="/admin" className="btn btn-secondary">
            Back to Admin Console
          </Link>
        </div>
      </div>
      <PoweredByFooter />
    </div>
  );
}

export default function EnterPage() {
  return (
    <Suspense
      fallback={
        <div className="enter-page">
          <p className="muted">Loading…</p>
        </div>
      }
    >
      <EnterInner />
    </Suspense>
  );
}
