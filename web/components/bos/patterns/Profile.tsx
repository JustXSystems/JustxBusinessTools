import type { CSSProperties, ReactNode } from "react";

export type BosDetail = { label: ReactNode; value: ReactNode };

/** Mono-label / value grid (profile facts, record headers). */
export function DetailsGrid({ items, cols = 4 }: { items: BosDetail[]; cols?: number }) {
  return (
    <div className="bos-details" style={{ "--bos-detail-cols": cols } as CSSProperties}>
      {items.map((d, i) => (
        <div key={i}>
          <div className="bos-detail-label">{d.label}</div>
          <div className="bos-detail-value">{d.value}</div>
        </div>
      ))}
    </div>
  );
}

/** Record header: avatar, name + status, role line, corner actions, facts grid. */
export function ProfileHeader({
  avatar,
  name,
  status,
  role,
  corner,
  details,
  detailCols = 4,
}: {
  avatar: ReactNode;
  name: ReactNode;
  status?: ReactNode;
  role?: ReactNode;
  corner?: ReactNode;
  details?: BosDetail[];
  detailCols?: number;
}) {
  return (
    <div className="bos-profile">
      {corner ? <div className="bos-profile-corner">{corner}</div> : null}
      <div className="bos-profile-top">
        {avatar}
        <div style={{ minWidth: 0 }}>
          <div className="bos-profile-name">
            {name}
            {status}
          </div>
          {role ? <div className="bos-profile-role">{role}</div> : null}
        </div>
      </div>
      {details?.length ? (
        <div className="bos-profile-info">
          <DetailsGrid items={details} cols={detailCols} />
        </div>
      ) : null}
    </div>
  );
}
