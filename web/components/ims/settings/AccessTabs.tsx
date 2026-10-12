"use client";

import { Button, Checkbox, Input, Select } from "@/components/bos";
import type { ImsPermission, ImsSettingsMeta, PermissionMatrix, Taxonomy } from "@/lib/ims/api";
import { GST_RATES } from "@/lib/ims/format";
import { EDITABLE_ROLES, ROLE_INFO, TAXONOMY_LISTS } from "@/lib/ims/settings";
import { ChipList, SectionCard, type TabProps } from "./parts";

type EditableRole = (typeof EDITABLE_ROLES)[number];

export function PermissionsTab({ draft, set, readOnly, meta }: TabProps & { meta: ImsSettingsMeta }) {
  const matrix = draft.permissions;
  const update = (next: PermissionMatrix) => set("permissions", next);
  const toggle = (role: EditableRole, perm: ImsPermission, on: boolean) => update({ ...matrix, [role]: { ...matrix[role], [perm]: on } });
  const setRow = (perm: ImsPermission, on: boolean) => update(Object.fromEntries(EDITABLE_ROLES.map((r) => [r, { ...matrix[r], [perm]: on }])) as PermissionMatrix);
  const isDefault = JSON.stringify(matrix) === JSON.stringify(meta.defaults);

  return (
    <SectionCard
      title="Role permissions"
      desc="What each role can do across IMS. Owners always have every permission. Changes apply on each member's next request."
      actions={
        readOnly ? null : (
          <Button size="sm" variant="ghost" disabled={isDefault} onClick={() => update(meta.defaults)}>
            Reset to defaults
          </Button>
        )
      }
    >
      <div className="ims-set-table-wrap">
        <table className="ims-set-table">
          <caption className="bos-sr-only">Permissions by role</caption>
          <thead>
            <tr>
              <th scope="col" className="is-sticky">
                Permission
              </th>
              <th scope="col" className="is-center is-owner" title={ROLE_INFO.owner.desc}>
                {ROLE_INFO.owner.label}
              </th>
              {EDITABLE_ROLES.map((r) => (
                <th key={r} scope="col" className="is-center" title={ROLE_INFO[r].desc}>
                  {ROLE_INFO[r].label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {meta.permissionKeys.map((p) => {
              const onCount = EDITABLE_ROLES.filter((r) => matrix[r]?.[p.key]).length;
              return (
                <tr key={p.key}>
                  <th scope="row" className="is-sticky">
                    <div className="ims-row" style={{ justifyContent: "space-between", flexWrap: "nowrap", gap: 8 }}>
                      <span>
                        <div className="ims-perm-name">{p.label}</div>
                        <div className="ims-perm-key">{p.key}</div>
                      </span>
                      {readOnly ? null : (
                        <Checkbox
                          checked={onCount === EDITABLE_ROLES.length}
                          indeterminate={onCount > 0 && onCount < EDITABLE_ROLES.length}
                          onChange={(v) => setRow(p.key, v)}
                          aria-label={`${p.label} for every role`}
                        />
                      )}
                    </div>
                  </th>
                  <td className="is-center is-owner">
                    <Checkbox checked disabled onChange={() => undefined} aria-label={`${p.label} — owner (always on)`} />
                  </td>
                  {EDITABLE_ROLES.map((r) => (
                    <td key={r} className="is-center">
                      <Checkbox checked={Boolean(matrix[r]?.[p.key])} disabled={readOnly} onChange={(v) => toggle(r, p.key, v)} aria-label={`${p.label} — ${ROLE_INFO[r].label}`} />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}

type Category = Taxonomy["categories"][number];

export function CatalogTab({ draft, set, errors, readOnly }: TabProps) {
  const tax = draft.taxonomy;
  const setList = <K extends keyof Taxonomy>(key: K, value: Taxonomy[K]) => set("taxonomy", { ...tax, [key]: value });
  const cats = tax.categories;
  const setCat = (i: number, patch: Partial<Category>) => setList("categories", cats.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const moveCat = (i: number, d: -1 | 1) => {
    const next = [...cats];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    setList("categories", next);
  };

  return (
    <div>
      <SectionCard
        title="Categories"
        desc="Each category can carry a default HSN code and GST rate that new items inherit."
        actions={
          readOnly ? null : (
            <Button size="sm" icon="plus" onClick={() => setList("categories", [...cats, { name: "", hsn: null, gstRate: draft.defaultGstRate }])}>
              Add category
            </Button>
          )
        }
      >
        {errors.categories ? <div className="bos-field-error" style={{ marginBottom: 8 }}>{errors.categories}</div> : null}
        {cats.length === 0 ? (
          <p className="ims-faint" style={{ margin: 0 }}>
            No categories yet.
          </p>
        ) : (
          <fieldset className="ims-set-fieldset" disabled={readOnly}>
            <div className="ims-set-table-wrap">
              <table className="ims-set-table">
                <caption className="bos-sr-only">Item categories</caption>
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">HSN</th>
                    <th scope="col">GST</th>
                    {readOnly ? null : (
                      <th scope="col">
                        <span className="bos-sr-only">Order and remove</span>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {cats.map((c, i) => (
                    <tr key={i}>
                      <td style={{ minWidth: 180 }}>
                        <Input size="sm" value={c.name} maxLength={80} aria-label={`Category ${i + 1} name`} aria-invalid={!c.name.trim() || undefined} onChange={(e) => setCat(i, { name: e.target.value })} />
                      </td>
                      <td style={{ width: 140 }}>
                        <Input size="sm" className="ims-mono" value={c.hsn ?? ""} maxLength={8} inputMode="numeric" placeholder="—" aria-label={`${c.name || "Category"} HSN`} onChange={(e) => setCat(i, { hsn: e.target.value.replace(/\D/g, "") || null })} />
                      </td>
                      <td style={{ width: 110 }}>
                        <Select size="sm" value={c.gstRate ?? ""} aria-label={`${c.name || "Category"} GST rate`} onChange={(e) => setCat(i, { gstRate: e.target.value === "" ? null : Number(e.target.value) })}>
                          <option value="">Default</option>
                          {GST_RATES.map((r) => (
                            <option key={r} value={r}>
                              {r}%
                            </option>
                          ))}
                        </Select>
                      </td>
                      {readOnly ? null : (
                        <td style={{ width: 1, whiteSpace: "nowrap" }}>
                          <Button size="sm" variant="ghost" disabled={i === 0} onClick={() => moveCat(i, -1)} aria-label={`Move ${c.name || "category"} up`}>
                            ↑
                          </Button>
                          <Button size="sm" variant="ghost" disabled={i === cats.length - 1} onClick={() => moveCat(i, 1)} aria-label={`Move ${c.name || "category"} down`}>
                            ↓
                          </Button>
                          <Button size="sm" variant="ghost" icon="x" onClick={() => setList("categories", cats.filter((_, j) => j !== i))} aria-label={`Remove ${c.name || "category"}`} />
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </fieldset>
        )}
      </SectionCard>

      <div className="ims-list-grid" style={{ marginTop: 16 }}>
        {TAXONOMY_LISTS.map((l) => (
          <SectionCard key={l.key} title={l.label} desc={l.hint}>
            <ChipList label={l.label} values={tax[l.key]} placeholder={l.placeholder} readOnly={readOnly} onChange={(v) => setList(l.key, v)} />
          </SectionCard>
        ))}
      </div>
    </div>
  );
}

/** Role cards used beside the team table. */
export function RoleGuide() {
  return (
    <div className="ims-role-grid">
      {(["owner", ...EDITABLE_ROLES] as const).map((r) => (
        <div key={r} className="ims-role">
          <div className="ims-role-name">{ROLE_INFO[r].label}</div>
          <div className="ims-role-desc">{ROLE_INFO[r].desc}</div>
        </div>
      ))}
    </div>
  );
}