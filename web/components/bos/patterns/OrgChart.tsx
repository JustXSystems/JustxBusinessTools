import type { ReactNode } from "react";
import { Avatar } from "../primitives/Avatar";
import { cx } from "../cx";

export type BosOrgNode = {
  id: string;
  name: string;
  role?: string;
  initials?: string;
  /** Avatar gradient tone (CSS colour). */
  tone?: string;
  /** Dashed grouping node (office / department) that is not a person. */
  virtual?: boolean;
  children?: BosOrgNode[];
};

function Node({ node, onSelect }: { node: BosOrgNode; onSelect?: (node: BosOrgNode) => void }) {
  const body: ReactNode = (
    <>
      <Avatar size="sm" tone={node.tone}>
        {node.initials ?? node.name.slice(0, 2).toUpperCase()}
      </Avatar>
      <div className="bos-org-name">{node.name}</div>
      {node.role ? <div className="bos-org-role">{node.role}</div> : null}
    </>
  );
  const clickable = onSelect && !node.virtual;
  return (
    <li>
      {clickable ? (
        <button type="button" className="bos-org-node" onClick={() => onSelect(node)}>
          {body}
        </button>
      ) : (
        <div className={cx("bos-org-node", node.virtual && "is-virtual")}>{body}</div>
      )}
      {node.children?.length ? (
        <ul>
          {node.children.map((c) => (
            <Node key={c.id} node={c} onSelect={onSelect} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** CSS-connector org tree. Person nodes become buttons when `onSelect` is set. */
export function OrgChart({ root, onSelect }: { root: BosOrgNode; onSelect?: (node: BosOrgNode) => void }) {
  return (
    <div className="bos-org-wrap">
      <div className="bos-org" role="tree" aria-label="Organization chart">
        <ul>
          <Node node={root} onSelect={onSelect} />
        </ul>
      </div>
    </div>
  );
}
