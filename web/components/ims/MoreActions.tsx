"use client";

import { useMemo, useState } from "react";
import { Button, Card, EmptyState, Switch } from "@/components/bos";
import type { ImsModuleKey } from "@/lib/ims/api";
import { FAV_KEY, RECENT_KEY, useStoredList } from "@/lib/ims/recent";
import { PageHeader, Stack, useIms } from "./core";
import { visibleModules, type ImsModuleDef, type ImsSection } from "./modules";

const SECTIONS: ReadonlyArray<ImsSection> = ["Inventory", "Purchasing", "Sales & Finance", "Operations", "Insights", "Auditing", "System"];

const SECTION_TINT: Record<ImsSection, string> = {
  Inventory: "var(--bos-emerald-100, #E5F6EE)",
  Purchasing: "var(--bos-blue-100, #ECEEFE)",
  "Sales & Finance": "var(--bos-ims-cyan-100, #E6F8FD)",
  Operations: "var(--bos-amber-100, #FBF0DD)",
  Insights: "var(--bos-ims-lavender-100, #F1F3FC)",
  Auditing: "var(--bos-ims-lavender-100, #F1F3FC)",
  System: "var(--bos-surface-2)",
};

function Tile({ def, badge, editing, fav, onClick }: { def: ImsModuleDef; badge?: number; editing: boolean; fav: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`ims-tile${editing ? " is-editing" : ""}${fav ? " is-fav" : ""}`} onClick={onClick} aria-pressed={editing ? fav : undefined}>
      <span className="ims-tile-ic" style={{ background: SECTION_TINT[def.section] }} aria-hidden="true">
        {def.icon}
      </span>
      <span>
        <div className="ims-tile-title">{def.label}</div>
        <div className="ims-tile-desc">{def.desc}</div>
      </span>
      {editing ? <span className="ims-tile-star">{fav ? "★" : "☆"}</span> : badge ? <span className="ims-tile-badge">{badge > 99 ? "99+" : badge}</span> : null}
    </button>
  );
}

export function MoreActionsModule() {
  const { session, navigate, notifications } = useIms();
  const [favs, setFavs] = useStoredList(FAV_KEY);
  const [recent] = useStoredList(RECENT_KEY);
  const [editing, setEditing] = useState(false);
  const [favsOnly, setFavsOnly] = useState(false);

  const modules = useMemo(() => visibleModules(session).filter((x) => x.key !== "more"), [session]);
  const byKey = useMemo(() => new Map(modules.map((x) => [x.key, x])), [modules]);
  const badges = useMemo(() => {
    const out = new Map<string, number>();
    for (const n of notifications) out.set(n.module, (out.get(n.module) ?? 0) + 1);
    return out;
  }, [notifications]);

  const open = (def: ImsModuleDef) => {
    if (editing) {
      setFavs(favs.includes(def.key) ? favs.filter((k) => k !== def.key) : [...favs, def.key]);
      return;
    }
    navigate(def.key);
  };

  const favDefs = favs.map((k) => byKey.get(k as ImsModuleKey)).filter((x): x is ImsModuleDef => Boolean(x));
  const recentDefs = recent.map((k) => byKey.get(k as ImsModuleKey)).filter((x): x is ImsModuleDef => Boolean(x)).slice(0, 4);
  const tile = (def: ImsModuleDef) => <Tile key={def.key} def={def} badge={badges.get(def.key)} editing={editing} fav={favs.includes(def.key)} onClick={() => open(def)} />;

  return (
    <Stack>
      <PageHeader
        title="More Actions"
        sub="Everything you need to run the business, in one place. Star the ones you use most."
        actions={
          <>
            <span className="ims-row ims-faint" style={{ gap: 8 }}>
              <Switch checked={favsOnly} onChange={setFavsOnly} aria-label="Show favourites only" />
              Favourites only
            </span>
            <Button size="sm" variant={editing ? "primary" : "secondary"} onClick={() => setEditing((e) => !e)}>
              {editing ? "Done" : "Edit favourites"}
            </Button>
          </>
        }
      />

      {editing ? <p className="ims-faint">Tap a tile to add it to, or remove it from, your favourites.</p> : null}

      {favDefs.length ? (
        <section>
          <div className="ims-group-title">★ Favourites</div>
          <div className="ims-tiles">{favDefs.map(tile)}</div>
        </section>
      ) : favsOnly ? (
        <Card interactive={false}>
          <EmptyState glyph="☆" title="No favourites yet">
            Use “Edit favourites” and tap the actions you use most.
          </EmptyState>
        </Card>
      ) : null}

      {!favsOnly && recentDefs.length ? (
        <section>
          <div className="ims-group-title">Recently used</div>
          <div className="ims-tiles">{recentDefs.map(tile)}</div>
        </section>
      ) : null}

      {!favsOnly
        ? SECTIONS.map((section) => {
            const list = modules.filter((x) => x.section === section);
            if (!list.length) return null;
            return (
              <section key={section}>
                <div className="ims-group-title">{section}</div>
                <div className="ims-tiles">{list.map(tile)}</div>
              </section>
            );
          })
        : null}
    </Stack>
  );
}

export default MoreActionsModule;
