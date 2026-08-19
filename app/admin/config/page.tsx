"use client";

import { useEffect, useMemo, useState } from "react";
import { TRACKER_CONFIGS } from "@/config/tools.config";
import { TrackerSchemaDesigner } from "@/components/admin/SchemaDesigner";
import { api } from "@/lib/api";

type ToolDef = { id: string; toolType: string; definition: Record<string, unknown> };

export default function AdminConfigPage() {
  const [tools, setTools] = useState<ToolDef[]>([]);
  const [poweredBy, setPoweredBy] = useState<{ text: string; locked: boolean } | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [jsonText, setJsonText] = useState("");
  const [message, setMessage] = useState("");
  const [mode, setMode] = useState<"visual" | "json">("visual");

  const selectedType = tools.find((t) => t.id === selectedId)?.toolType ?? "tracker";
  const isTracker = selectedType === "tracker" || TRACKER_CONFIGS[selectedId] != null;

  useEffect(() => {
    api<{ tools: ToolDef[] }>("/admin/config/tools").then((d) => {
      setTools(d.tools);
      if (d.tools[0]) {
        setSelectedId(d.tools[0].id);
        setJsonText(JSON.stringify(d.tools[0].definition, null, 2));
      } else {
        setSelectedId("paymenttracker");
        const base = TRACKER_CONFIGS.paymenttracker;
        if (base) {
          setJsonText(
            JSON.stringify(
              {
                type: "tracker",
                key: "paymenttracker",
                fields: base.fields,
                titleField: base.titleField,
                subtitleFields: base.subtitleFields,
                statusField: base.statusField,
              },
              null,
              2,
            ),
          );
        }
      }
    });
    api<{ config: { powered_by?: { text: string; locked: boolean } } }>("/admin/config/platform").then(
      (d) => setPoweredBy(d.config.powered_by ?? null),
    );
  }, []);

  const catalogOptions = useMemo(() => {
    const ids = new Set([
      ...Object.keys(TRACKER_CONFIGS),
      "gstcalc",
      "tdscalc",
      "quotation",
      "invoice",
      ...tools.map((t) => t.id),
    ]);
    return Array.from(ids).sort();
  }, [tools]);

  function selectTool(id: string) {
    setSelectedId(id);
    const tool = tools.find((t) => t.id === id);
    if (tool) {
      setJsonText(JSON.stringify(tool.definition, null, 2));
      return;
    }
    const base = TRACKER_CONFIGS[id];
    if (base) {
      setJsonText(
        JSON.stringify(
          {
            type: "tracker",
            key: id,
            fields: base.fields,
            titleField: base.titleField,
            subtitleFields: base.subtitleFields,
            statusField: base.statusField,
          },
          null,
          2,
        ),
      );
    } else {
      setJsonText(JSON.stringify({ type: selectedType, key: id }, null, 2));
    }
  }

  async function publish(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    try {
      const definition = JSON.parse(jsonText) as Record<string, unknown>;
      await api(`/admin/config/tools/${selectedId}`, {
        method: "POST",
        body: JSON.stringify({ definition }),
      });
      setMessage("Published new config revision.");
      const refreshed = await api<{ tools: ToolDef[] }>("/admin/config/tools");
      setTools(refreshed.tools);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Publish failed");
    }
  }

  return (
    <div className="admin-page">
      <section className="panel admin-card admin-page-head">
        <h2>Platform branding</h2>
        {poweredBy ? (
          <p>
            <strong>{poweredBy.text}</strong>
            {poweredBy.locked ? <span className="pill">Locked — cannot be removed</span> : null}
          </p>
        ) : null}
      </section>

      <section className="panel admin-card admin-page-head">
        <h2>Create custom tracker</h2>
        <p className="muted">
          Publish a new tracker tool. It appears on the home grid under Custom Tools after publish.
        </p>
        <form
          className="admin-form-row"
          onSubmit={async (e) => {
            e.preventDefault();
            setMessage("");
            const form = e.currentTarget;
            const id = (form.elements.namedItem("customId") as HTMLInputElement).value.trim();
            const title = (form.elements.namedItem("customTitle") as HTMLInputElement).value.trim();
            if (!id || !title) {
              setMessage("Tool id and title are required.");
              return;
            }
            const definition = {
              type: "tracker",
              key: id,
              title,
              icon: "📋",
              subtitle: (form.elements.namedItem("customDesc") as HTMLInputElement).value.trim(),
              category: "Custom Tools",
              addLabel: "+ Add Entry",
              fields: [
                { key: "name", label: "Name", type: "text", required: true },
                { key: "notes", label: "Notes", type: "textarea" },
              ],
              titleField: "name",
              subtitleFields: ["notes"],
              statusField: null,
            };
            try {
              await api(`/admin/config/tools/${id}`, {
                method: "POST",
                body: JSON.stringify({ definition }),
              });
              setMessage(`Custom tool "${id}" published. Refresh operator home to see it.`);
              const refreshed = await api<{ tools: ToolDef[] }>("/admin/config/tools");
              setTools(refreshed.tools);
              selectTool(id);
            } catch (err) {
              setMessage(err instanceof Error ? err.message : "Publish failed");
            }
          }}
        >
          <label className="field">
            <span>Tool id (slug)</span>
            <input name="customId" placeholder="e.g. leadtracker" pattern="[a-z][a-z0-9_]*" />
          </label>
          <label className="field">
            <span>Title</span>
            <input name="customTitle" placeholder="Lead Tracker" />
          </label>
          <label className="field">
            <span>Description</span>
            <input name="customDesc" placeholder="Short description for home card" />
          </label>
          <button type="submit" className="btn btn-secondary">Create & publish</button>
        </form>
      </section>

      <div className="admin-split">
      <section className="panel admin-card">
        <h2>Tools</h2>
        <p className="muted">Pick a tool, then edit on the right.</p>
        <div className="tracker-list">
          {catalogOptions.map((id) => (
            <button
              type="button"
              key={id}
              className={`tracker-row admin-member-row ${selectedId === id ? "is-selected" : ""}`}
              onClick={() => selectTool(id)}
            >
              <strong>{id}</strong>
            </button>
          ))}
        </div>
      </section>

      <section className="panel admin-card">
        <h2>Schema designer</h2>
        <p className="muted">
          Design tracker fields visually or edit JSON for calculators and documents.
        </p>

        <div className="admin-form-row">
          <label className="field">
            <span>Tool</span>
            <select value={selectedId} onChange={(e) => selectTool(e.target.value)}>
              {catalogOptions.map((id) => (
                <option key={id} value={id}>{id}</option>
              ))}
            </select>
          </label>
          {isTracker ? (
            <div className="admin-tabs">
              <button
                type="button"
                className={mode === "visual" ? "active" : ""}
                onClick={() => setMode("visual")}
              >
                Visual
              </button>
              <button
                type="button"
                className={mode === "json" ? "active" : ""}
                onClick={() => setMode("json")}
              >
                JSON
              </button>
            </div>
          ) : null}
        </div>

        <form onSubmit={publish} className="admin-stack">
          {isTracker && mode === "visual" ? (
            <TrackerSchemaDesigner
              toolId={selectedId}
              jsonText={jsonText}
              onChange={setJsonText}
            />
          ) : null}

          {(mode === "json" || !isTracker) && (
            <label className="field">
              <span>Definition JSON</span>
              <textarea
                rows={14}
                value={jsonText}
                onChange={(e) => setJsonText(e.target.value)}
                placeholder='{"type":"tracker","fields":[...]}'
              />
            </label>
          )}

          <button type="submit" className="btn btn-primary">Publish revision</button>
        </form>
        {message ? <p className="muted">{message}</p> : null}
      </section>
      </div>
    </div>
  );
}
