"use client";

import { useState } from "react";
import { Alert, Button, Field, FormGrid, Input, Segmented, Select } from "@/components/bos";
import { MAP_FLAVORS, TILE_PRESETS, mapApi, probePmtiles, probeTiles, type MapSettings, type MapSource } from "@/lib/ims/fieldmap";
import { Loaded, useIms, useImsAction, useImsData } from "../core";
import { TeamMap, type MapMarker } from "../field/TeamMap";
import { SectionCard } from "./parts";

const SOURCE_OPTIONS: ReadonlyArray<{ value: MapSource; label: string }> = [
  { value: "builtin", label: "Built-in (default)" },
  { value: "tiles", label: "Tile server" },
  { value: "pmtiles", label: "Self-hosted PMTiles" },
];

const PREVIEW: MapMarker[] = [
  { id: "a", lat: 12.9716, lng: 77.5946, label: "Asha", color: "#1FA679", detail: "Active" },
  { id: "b", lat: 12.9352, lng: 77.6245, label: "Ravi", color: "#4C6FF5", detail: "At site" },
  { id: "c", lat: 13.0035, lng: 77.5709, label: "Imran", color: "#7C6CF2", detail: "Travelling" },
];

const SAFE_URL = /^(https:\/\/[^\s"'<>\\]+|\/[^\s"'<>\\]*)$/;
const PMTILES_CREDIT = "© OpenStreetMap contributors · Protomaps";

function mapErrors(d: MapSettings): Record<string, string> {
  const e: Record<string, string> = {};
  if (d.source === "tiles") {
    const u = d.tileUrl?.trim() ?? "";
    if (!SAFE_URL.test(u)) e.tileUrl = "Use an https:// address or a path on this site starting with /";
    else if (!/\{z\}/.test(u) || !/\{x\}/.test(u) || !/\{-?y\}/.test(u)) e.tileUrl = "The address needs {z}, {x} and {y}";
  }
  if (d.source === "pmtiles") {
    const u = d.pmtilesUrl?.trim() ?? "";
    if (!SAFE_URL.test(u)) e.pmtilesUrl = "Use an https:// address or a path on this site starting with /";
    else if (!/\.pmtiles(\?|$)/i.test(u)) e.pmtilesUrl = "Point to a .pmtiles file";
  }
  if (d.source !== "builtin") {
    if (!d.attribution?.trim()) e.attribution = "The map's licence requires a data credit";
    else if (/[<>]/.test(d.attribution)) e.attribution = "Plain text only";
  }
  if (!Number.isInteger(d.maxZoom) || d.maxZoom < 1 || d.maxZoom > 22) e.maxZoom = "1–22";
  return e;
}

export function MapTab() {
  const state = useImsData(() => mapApi.get(), []);
  return <Loaded state={state}>{({ map }) => <MapEditor saved={map} />}</Loaded>;
}

function MapEditor({ saved }: { saved: MapSettings }) {
  const { can } = useIms();
  const { run, busy } = useImsAction();
  const readOnly = !can("settings");
  const [base, setBase] = useState(saved);
  const [draft, setDraft] = useState(saved);
  const [preview, setPreview] = useState(saved);
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const errors = mapErrors(draft);
  const valid = Object.keys(errors).length === 0;
  const changed = JSON.stringify({ ...draft, updatedAt: null }) !== JSON.stringify({ ...base, updatedAt: null });
  const preset = TILE_PRESETS.find((p) => p.tileUrl === draft.tileUrl)?.key ?? "custom";

  const update = (patch: Partial<MapSettings>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setTest(null);
  };

  const pickSource = (source: MapSource) => {
    if (source === "tiles" && !draft.tileUrl) {
      const p = TILE_PRESETS[0];
      update({ source, tileUrl: p.tileUrl, attribution: p.attribution, maxZoom: p.maxZoom });
    } else if (source === "pmtiles" && !draft.attribution) update({ source, attribution: PMTILES_CREDIT, maxZoom: Math.min(draft.maxZoom, 15) });
    else update({ source });
  };

  const runTest = async () => {
    if (draft.source === "builtin") {
      setPreview(draft);
      setTest({ ok: true, text: "The built-in map needs no server." });
      return;
    }
    setTesting(true);
    const problem = draft.source === "pmtiles" ? await probePmtiles(draft.pmtilesUrl ?? "") : await probeTiles(draft.tileUrl ?? "");
    setTesting(false);
    setTest(problem ? { ok: false, text: problem } : { ok: true, text: "Connected. The preview below now uses this source." });
    if (!problem) setPreview(draft);
  };

  const save = async () => {
    const out = await run("map", () => mapApi.save({ source: draft.source, tileUrl: draft.tileUrl?.trim() || null, pmtilesUrl: draft.pmtilesUrl?.trim() || null, attribution: draft.attribution?.trim() || null, maxZoom: draft.maxZoom, flavor: draft.flavor }), {
      success: "Field map saved",
      description: draft.source === "builtin" ? "Onsite Track uses the built-in map" : "Onsite Track maps now load from this source",
      refresh: false,
    });
    if (!out) return;
    setBase(out.map);
    setDraft(out.map);
    setPreview(out.map);
  };

  return (
    <fieldset className="ims-set-fieldset" disabled={readOnly}>
      <SectionCard
        title="Field map"
        desc="Where Onsite Track draws team locations and day trails. The built-in map makes no outside requests. A tile server or a self-hosted PMTiles file adds streets."
        actions={
          readOnly ? null : (
            <>
              <Button size="sm" variant="ghost" disabled={!changed || busy === "map"} onClick={() => setDraft(base)}>
                Discard
              </Button>
              <Button size="sm" variant="primary" icon="check" disabled={!changed || !valid || busy === "map"} onClick={() => void save()}>
                {busy === "map" ? "Saving…" : "Save map"}
              </Button>
            </>
          )
        }
      >
        <div style={{ display: "grid", gap: 14 }}>
          <Segmented<MapSource> role="radio" aria-label="Map source" options={SOURCE_OPTIONS} value={draft.source} onChange={pickSource} />

          {draft.source === "builtin" ? (
            <Alert tone="emerald" title="No map server">
              Positions, trails, distances and a scale are drawn in the browser. There is no street layer; each person and visit links to Google Maps for streets and directions.
            </Alert>
          ) : null}

          {draft.source === "tiles" ? (
            <>
              <FormGrid>
                <Field label="Provider">
                  {({ id }) => (
                    <Select
                      id={id}
                      value={preset}
                      onChange={(e) => {
                        const p = TILE_PRESETS.find((x) => x.key === e.target.value);
                        update(p ? { tileUrl: p.tileUrl, attribution: p.attribution, maxZoom: p.maxZoom } : { tileUrl: "", attribution: "" });
                      }}
                    >
                      {TILE_PRESETS.map((p) => (
                        <option key={p.key} value={p.key}>
                          {p.label}
                        </option>
                      ))}
                      <option value="custom">Other provider or my own server</option>
                    </Select>
                  )}
                </Field>
                <Field label="Highest zoom" error={errors.maxZoom}>
                  {({ id, invalid }) => <Input id={id} type="number" min={1} max={22} aria-invalid={invalid} value={draft.maxZoom} onChange={(e) => update({ maxZoom: Number(e.target.value) })} />}
                </Field>
                <Field label="Tile address" error={errors.tileUrl} hint="Raster tiles with {z}, {x} and {y} — e.g. your server's /tiles/{z}/{x}/{y}.png, or a Mappls, Ola Maps or MapTiler raster URL with your key." full>
                  {({ id, describedBy, invalid }) => (
                    <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} maxLength={500} spellCheck={false} value={draft.tileUrl ?? ""} onChange={(e) => update({ tileUrl: e.target.value })} placeholder="https://tiles.example.com/{z}/{x}/{y}.png" />
                  )}
                </Field>
                <Field label="Map data credit" error={errors.attribution} hint="Shown in the corner of the map, as the provider's licence requires." full>
                  {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} maxLength={200} value={draft.attribution ?? ""} onChange={(e) => update({ attribution: e.target.value })} />}
                </Field>
              </FormGrid>
              {preset !== "custom" ? (
                <Alert tone="amber" title="Light use only">
                  {TILE_PRESETS.find((p) => p.key === preset)?.note}
                </Alert>
              ) : null}
              <Alert tone="blue" title="What users' browsers share">
                Each user&apos;s browser downloads map images from this address, so the provider sees their IP address and the area being viewed — never names or business data. A key in the address is visible in the browser, so use a key restricted to this website.
              </Alert>
            </>
          ) : null}

          {draft.source === "pmtiles" ? (
            <>
              <FormGrid>
                <Field
                  label="PMTiles file"
                  error={errors.pmtilesUrl}
                  hint="Your own copy, e.g. an India extract of a Protomaps basemap build. The server must allow HTTP range requests, and CORS for this website if it's on another domain."
                  full
                >
                  {({ id, describedBy, invalid }) => (
                    <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} maxLength={500} spellCheck={false} value={draft.pmtilesUrl ?? ""} onChange={(e) => update({ pmtilesUrl: e.target.value })} placeholder="https://maps.example.com/india.pmtiles" />
                  )}
                </Field>
                <Field label="Style">
                  {({ id }) => (
                    <Select id={id} value={draft.flavor} onChange={(e) => update({ flavor: e.target.value as MapSettings["flavor"] })}>
                      {MAP_FLAVORS.map((f) => (
                        <option key={f} value={f}>
                          {f[0].toUpperCase() + f.slice(1)}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label="Highest zoom" error={errors.maxZoom} hint="Up to the zoom your file was built with (often 15).">
                  {({ id, describedBy, invalid }) => <Input id={id} type="number" min={1} max={22} aria-describedby={describedBy} aria-invalid={invalid} value={draft.maxZoom} onChange={(e) => update({ maxZoom: Number(e.target.value) })} />}
                </Field>
                <Field label="Map data credit" error={errors.attribution} full>
                  {({ id, invalid }) => <Input id={id} aria-invalid={invalid} maxLength={200} value={draft.attribution ?? ""} onChange={(e) => update({ attribution: e.target.value })} />}
                </Field>
              </FormGrid>
              <Alert tone="emerald" title="No third-party map server">
                The file is read straight from your own server, a small part at a time. No keys and no usage limits.
              </Alert>
            </>
          ) : null}

          <div className="ims-row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <Button size="sm" variant="ghost" icon="refresh" disabled={!valid || testing} onClick={() => void runTest()}>
              {testing ? "Testing…" : "Test and preview"}
            </Button>
            {test ? <span className={test.ok ? "ims-faint" : undefined} style={test.ok ? undefined : { color: "var(--bos-coral)" }} role="status">{test.text}</span> : null}
          </div>
          <TeamMap settings={preview} markers={PREVIEW} title="Map preview" />
        </div>
      </SectionCard>
    </fieldset>
  );
}
