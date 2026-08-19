"use client";

import type { DocumentConfig } from "@/config/tools.config";
import type { DocumentState } from "@/lib/types/document";
import { INDIAN_STATES } from "@/lib/types/business-profile";

type Props = {
  config: DocumentConfig;
  state: DocumentState;
  onChange: (state: DocumentState) => void;
};

export function DocumentEditor({ config, state, onChange }: Props) {
  function updateTop<K extends keyof DocumentState>(field: K, value: DocumentState[K]) {
    onChange({ ...state, [field]: value });
  }

  function updateParty(field: keyof DocumentState["party"], value: string) {
    onChange({ ...state, party: { ...state.party, [field]: value } });
  }

  function updateItem(id: number, field: keyof DocumentState["items"][0], value: string | number) {
    onChange({
      ...state,
      items: state.items.map((it) =>
        it.id === id ? { ...it, [field]: value } : it,
      ),
    });
  }

  function addItem() {
    const nextId = Math.max(0, ...state.items.map((i) => i.id)) + 1;
    onChange({
      ...state,
      items: [...state.items, { id: nextId, name: "", hsn: "", qty: 1, unit: "NOS", rate: 0 }],
    });
  }

  function removeItem(id: number) {
    onChange({ ...state, items: state.items.filter((it) => it.id !== id) });
  }

  function toggleCgstSgst(checked: boolean) {
    onChange({
      ...state,
      cgstSgstEnabled: checked,
      cgstPct: checked ? state.cgstPct : 0,
      sgstPct: checked ? state.sgstPct : 0,
    });
  }

  return (
    <div className="col-left">
      <div className="panel">
        <div className="panel-title">{config.docLabel} Details</div>
        <div className="field-row2">
          <label className="field">
            <span className="label">{config.docLabel} No.</span>
            <input
              value={state.docNo}
              onChange={(e) => updateTop("docNo", e.target.value)}
            />
          </label>
          <label className="field">
            <span className="label">{config.dateLabel}</span>
            <input
              type="date"
              value={state.docDate}
              onChange={(e) => updateTop("docDate", e.target.value)}
            />
          </label>
        </div>
        <label className="field">
          <span className="label">{config.extraDateLabel}</span>
          <input
            type="date"
            value={state.extraDate}
            onChange={(e) => updateTop("extraDate", e.target.value)}
          />
        </label>
      </div>

      <div className="panel">
        <div className="panel-title">
          {config.partyIcon} {config.partyLabel} Details
        </div>
        <label className="field">
          <span className="label">{config.partyLabel} Name</span>
          <input
            value={state.party.name}
            placeholder="e.g. Shiv Engineering"
            onChange={(e) => updateParty("name", e.target.value)}
          />
        </label>
        <label className="field">
          <span className="label">Address</span>
          <input
            value={state.party.address}
            placeholder="Street, City, State - Pincode"
            onChange={(e) => updateParty("address", e.target.value)}
          />
        </label>
        <div className="field-row2">
          <label className="field">
            <span className="label">Phone</span>
            <input
              value={state.party.phone}
              placeholder="9876543210"
              onChange={(e) => updateParty("phone", e.target.value)}
            />
          </label>
          <label className="field">
            <span className="label">GSTIN</span>
            <input
              value={state.party.gstin}
              placeholder="Optional"
              onChange={(e) => updateParty("gstin", e.target.value)}
            />
          </label>
        </div>
        <label className="field">
          <span className="label">State</span>
          <select
            value={state.party.state}
            onChange={(e) => updateParty("state", e.target.value)}
          >
            <option value="">Select state</option>
            {INDIAN_STATES.map(([name]) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="panel">
        <div className="panel-title">
          📦 Items <span className="tool-badge">{state.items.length}</span>
        </div>
        {config.showTax ? (
          <>
            <label className="field toggle-row toggle-inline">
              <input
                type="checkbox"
                checked={state.cgstSgstEnabled}
                onChange={(e) => toggleCgstSgst(e.target.checked)}
              />
              <span className="toggle-hint">
                Enable CGST + SGST (intra-state)
              </span>
            </label>
            <div className="field-row3 mb-10">
              {state.cgstSgstEnabled ? (
                <>
                  <label className="field">
                    <span className="label">CGST %</span>
                    <input
                      type="number"
                      value={state.cgstPct}
                      onChange={(e) => updateTop("cgstPct", Number(e.target.value))}
                    />
                  </label>
                  <label className="field">
                    <span className="label">SGST %</span>
                    <input
                      type="number"
                      value={state.sgstPct}
                      onChange={(e) => updateTop("sgstPct", Number(e.target.value))}
                    />
                  </label>
                </>
              ) : (
                <>
                  <div />
                  <div />
                </>
              )}
              <label className="field">
                <span className="label">IGST %</span>
                <input
                  type="number"
                  value={state.igstPct}
                  onChange={(e) => updateTop("igstPct", Number(e.target.value))}
                />
              </label>
            </div>
          </>
        ) : null}

        <div className="items-editor">
          {state.items.map((it, idx) => (
            <div key={it.id} className="item-row-card">
              <div className="item-index">{idx + 1}</div>
              {state.items.length > 1 ? (
                <button
                  type="button"
                  className="remove-x"
                  onClick={() => removeItem(it.id)}
                  aria-label="Remove item"
                >
                  ✕
                </button>
              ) : null}
              <label className="field">
                <span className="label">Item / Service Name</span>
                <input
                  value={it.name}
                  placeholder="e.g. Solar Panel 540W"
                  onChange={(e) => updateItem(it.id, "name", e.target.value)}
                />
              </label>
              <div className="field-row4">
                <label className="field">
                  <span className="label">HSN/SAC</span>
                  <input
                    value={it.hsn}
                    placeholder="e.g. 8541"
                    onChange={(e) => updateItem(it.id, "hsn", e.target.value)}
                  />
                </label>
                <label className="field">
                  <span className="label">Qty</span>
                  <input
                    type="number"
                    value={it.qty}
                    onChange={(e) => updateItem(it.id, "qty", Number(e.target.value))}
                  />
                </label>
                <label className="field">
                  <span className="label">Unit</span>
                  <input
                    value={it.unit}
                    onChange={(e) => updateItem(it.id, "unit", e.target.value)}
                  />
                </label>
                <label className="field">
                  <span className="label">Rate (₹)</span>
                  <input
                    type="number"
                    value={it.rate}
                    onChange={(e) => updateItem(it.id, "rate", Number(e.target.value))}
                  />
                </label>
              </div>
            </div>
          ))}
        </div>
        <button type="button" className="btn btn-ghost btn-sm mt-10" onClick={addItem}>
          + Add Item
        </button>
      </div>

      <div className="panel">
        <div className="panel-title">📝 Notes / Terms</div>
        <textarea
          rows={3}
          placeholder={`Optional notes for this ${config.docLabel.toLowerCase()}...`}
          value={state.notes}
          onChange={(e) => updateTop("notes", e.target.value)}
        />
      </div>
    </div>
  );
}
