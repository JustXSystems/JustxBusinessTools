function initials(name: string | null | undefined, email: string | null | undefined) {
  const raw = (name || email || "?").trim();
  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return raw.slice(0, 2).toUpperCase();
}

/** Compact signed-in session chip — informational only (not a link/button). */
export function SidebarIdentityChip({
  name,
  email,
  mini = false,
}: {
  name?: string | null;
  email?: string | null;
  mini?: boolean;
}) {
  const displayName = (name || email || "Account").trim();
  const displayEmail = (email || "").trim();
  const tip = displayEmail && displayEmail !== displayName
    ? `${displayName} · ${displayEmail}`
    : displayName;

  return (
    <div
      className={`ds-identity-chip${mini ? " is-mini" : ""}`}
      title={tip}
      aria-label={tip}
    >
      <span className="ds-identity-avatar" aria-hidden="true">
        {initials(name, email)}
      </span>
      {!mini ? (
        <span className="ds-identity-meta">
          <span className="ds-identity-name">{displayName}</span>
          {displayEmail && displayEmail !== displayName ? (
            <span className="ds-identity-email">{displayEmail}</span>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}
