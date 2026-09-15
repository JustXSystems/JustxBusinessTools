function initials(name: string | null | undefined, email: string | null | undefined) {
  const raw = (name || email || "?").trim();
  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return raw.slice(0, 2).toUpperCase();
}

function formatRoleLabel(role?: string | null) {
  const raw = (role || "").trim();
  if (!raw) return "";
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
}

/** Compact signed-in session chip — informational only (not a link/button). */
export function SidebarIdentityChip({
  name,
  email,
  role,
  mini = false,
}: {
  name?: string | null;
  email?: string | null;
  role?: string | null;
  mini?: boolean;
}) {
  const displayName = (name || email || "Account").trim();
  const displayEmail = (email || "").trim();
  const displayRole = formatRoleLabel(role);
  const emailLine = [displayRole, displayEmail].filter(Boolean).join(" · ");
  const tipParts = [displayName, displayRole, displayEmail].filter(
    (part, index, all) => part && all.indexOf(part) === index,
  );
  const tip = tipParts.join(" · ");

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
          {emailLine && emailLine !== displayName ? (
            <span className="ds-identity-email">{emailLine}</span>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}
