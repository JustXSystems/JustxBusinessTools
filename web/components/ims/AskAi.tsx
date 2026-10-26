"use client";

import { Fragment, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Alert, Badge, Button, Dialog, Field, Input } from "@/components/bos";
import { askGemini, connectGemini, dataPrompt, GEMINI_KEY_URL, GeminiError, imsAssistant, loadGemini, pageSystem, saveGemini, type AssistantPage, type GeminiConfig, type GeminiTurn } from "@/lib/ims/assistant";
import { todayLocal } from "@/lib/ims/format";

/* ---------- Rich text: paragraphs, `- ` bullets and **bold** — never raw HTML ---------- */

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith("**") && part.endsWith("**") && part.length > 4 ? <strong key={i}>{part.slice(2, -2)}</strong> : <Fragment key={i}>{part}</Fragment>));
}

export function RichText({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (!bullets.length) return;
    blocks.push(
      <ul key={`ul-${blocks.length}`}>
        {bullets.map((b, i) => (
          <li key={i}>{inline(b)}</li>
        ))}
      </ul>,
    );
    bullets = [];
  };
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (bullet) {
      bullets.push(bullet[1]);
      continue;
    }
    flush();
    if (line.trim()) blocks.push(<p key={`p-${blocks.length}`}>{inline(line.replace(/^#+\s*/, ""))}</p>);
  }
  flush();
  return <div className="ims-ai-rich">{blocks}</div>;
}

/* ---------- Gemini connection (the user's own key, kept in this browser) ---------- */

export function useGemini() {
  const [cfg, setCfg] = useState<GeminiConfig | null>(() => (typeof window === "undefined" ? null : loadGemini()));
  const update = (next: GeminiConfig | null) => {
    saveGemini(next);
    setCfg(next);
  };
  return [cfg, update] as const;
}

function GeminiSetup({ cfg, onChange, onDone }: { cfg: GeminiConfig | null; onChange: (c: GeminiConfig | null) => void; onDone: () => void }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onChange(await connectGemini(key));
      setKey("");
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't connect to Gemini.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ims-ai-setup">
      <p className="ims-ai-muted">
        Built-in answers work without any setup. To ask anything in your own words, connect a free Google Gemini key. The key is stored only in this browser — it is never sent to Justx — and your question goes from this browser straight to Google with a short summary of the data you can already see.
      </p>
      {cfg ? (
        <div className="ims-between" style={{ gap: 10, flexWrap: "wrap" }}>
          <span>
            <Badge tone="emerald">Connected</Badge> <span className="ims-ai-muted">Model {cfg.model}</span>
          </span>
          <Button size="sm" variant="destructive" onClick={() => onChange(null)}>
            Disconnect
          </Button>
        </div>
      ) : (
        <form onSubmit={connect} className="ims-ai-setup-form">
          <Field label="Gemini API key" hint={<a href={GEMINI_KEY_URL} target="_blank" rel="noopener noreferrer">Get a free key from Google AI Studio</a>}>
            {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="password" autoComplete="off" spellCheck={false} placeholder="AIza…" value={key} onChange={(e) => setKey(e.target.value)} />}
          </Field>
          {error ? <Alert tone="coral" title="Not connected">{error}</Alert> : null}
          <div className="ims-between" style={{ gap: 8 }}>
            <Button variant="ghost" size="sm" onClick={onDone}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="sm" disabled={busy || key.trim().length < 20}>
              {busy ? "Checking…" : "Connect"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

/* ---------- Generic ask dialog ---------- */

export type AskResult = { text: string; source: "built-in" | "gemini" | "none"; note?: string; extra?: ReactNode };
type Turn = { id: number; q: string; result: AskResult | null; error: string | null };

export function AskDialog({
  open,
  onClose,
  title,
  description,
  suggestions,
  onAsk,
  gemini,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  suggestions: ReadonlyArray<string>;
  onAsk: (question: string, history: GeminiTurn[]) => Promise<AskResult>;
  gemini: readonly [GeminiConfig | null, (c: GeminiConfig | null) => void];
}) {
  const [cfg, setCfg] = gemini;
  const [turns, setTurns] = useState<Turn[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [setup, setSetup] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [turns]);

  const ask = async (question: string) => {
    const text = question.trim();
    if (!text || busy) return;
    const id = Date.now();
    const history: GeminiTurn[] = turns.slice(-4).flatMap((t) => (t.result ? [{ role: "user" as const, text: t.q }, { role: "model" as const, text: t.result.text }] : []));
    setTurns((list) => [...list, { id, q: text, result: null, error: null }]);
    setQ("");
    setBusy(true);
    try {
      const result = await onAsk(text, history);
      setTurns((list) => list.map((t) => (t.id === id ? { ...t, result } : t)));
    } catch (err) {
      setTurns((list) => list.map((t) => (t.id === id ? { ...t, error: err instanceof Error ? err.message : "Something went wrong." } : t)));
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      wide
      title={title}
      description={description}
      icon={{ tone: "blue", name: "sparkle" }}
      initialFocus={inputRef}
      actionsNote={<span className="ims-ai-muted">Read-only — Ask AI never changes your records. Check important figures before acting.</span>}
      actions={
        <Button size="sm" variant="ghost" icon="settings" onClick={() => setSetup((s) => !s)}>
          {cfg ? "Gemini connected" : "Connect Gemini"}
        </Button>
      }
    >
      <div className="ims-ai">
        {setup ? <GeminiSetup cfg={cfg} onChange={setCfg} onDone={() => setSetup(false)} /> : null}
        <div className="ims-ai-thread" aria-live="polite">
          {turns.length === 0 ? <p className="ims-ai-muted">Pick a question below or type your own.</p> : null}
          {turns.map((t) => (
            <div key={t.id} className="ims-ai-turn">
              <div className="ims-ai-q">{t.q}</div>
              <div className="ims-ai-a">
                {t.error ? (
                  <Alert tone="coral" title="Couldn't answer">
                    {t.error}
                  </Alert>
                ) : t.result ? (
                  <>
                    <RichText text={t.result.text} />
                    {t.result.extra}
                    <div className="ims-ai-src">
                      <Badge tone={t.result.source === "gemini" ? "lavender" : t.result.source === "built-in" ? "blue" : "amber"}>{t.result.source === "gemini" ? "Gemini · from your data" : t.result.source === "built-in" ? "Built-in · from your data" : "Not answered"}</Badge>
                      {t.result.note ? <span className="ims-ai-muted">{t.result.note}</span> : null}
                    </div>
                  </>
                ) : (
                  <span className="ims-ai-muted">Thinking…</span>
                )}
              </div>
            </div>
          ))}
          <div ref={endRef} />
        </div>
        <div className="ims-ai-suggest" role="list" aria-label="Suggested questions">
          {suggestions.map((s) => (
            <button key={s} type="button" role="listitem" className="ims-ai-chip" disabled={busy} onClick={() => void ask(s)}>
              {s}
            </button>
          ))}
        </div>
        <form
          className="ims-ai-form"
          onSubmit={(e) => {
            e.preventDefault();
            void ask(q);
          }}
        >
          <Input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} maxLength={500} placeholder={cfg ? "Ask anything about this page…" : "Ask about this page…"} aria-label="Your question" />
          <Button type="submit" variant="primary" icon="sparkle" disabled={busy || !q.trim()}>
            Ask
          </Button>
        </form>
      </div>
    </Dialog>
  );
}

export const geminiFailNote = (err: unknown) => `Gemini didn't answer (${err instanceof GeminiError ? err.message : "unexpected error"}) — showing the built-in answer.`;

/* ---------- Page-level Ask AI ---------- */

const NOT_ANSWERED =
  "I can answer the suggested questions (and close variations) from your own data. For anything else, connect your own free Gemini key with **Connect Gemini** below — the key stays in this browser.";

export function PageAskAi({ page, open, onClose }: { page: AssistantPage; open: boolean; onClose: () => void }) {
  const gemini = useGemini();
  const [cfg, setCfg] = gemini;
  const [meta, setMeta] = useState<{ title: string; suggestions: string[] } | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    imsAssistant
      .ask(page)
      .then((r) => alive && setMeta({ title: r.title, suggestions: r.suggestions }))
      .catch(() => alive && setMeta({ title: "This page", suggestions: [] }));
    return () => {
      alive = false;
    };
  }, [open, page]);

  const onAsk = async (question: string, history: GeminiTurn[]): Promise<AskResult> => {
    const r = await imsAssistant.ask(page, question);
    if (cfg) {
      try {
        const data = r.answer ? `${r.context}\nBUILT-IN ANSWER (computed by the app): ${r.answer}` : r.context;
        const g = await askGemini(cfg, setCfg, { system: pageSystem(r.business || "this business", todayLocal()), history, prompt: dataPrompt(data, question) });
        return { text: g.text, source: "gemini", note: g.truncated ? "The answer was cut short — ask a narrower question." : undefined };
      } catch (err) {
        if (r.answer) return { text: r.answer, source: "built-in", note: geminiFailNote(err) };
        throw err;
      }
    }
    return r.answer ? { text: r.answer, source: "built-in" } : { text: NOT_ANSWERED, source: "none" };
  };

  return (
    <AskDialog
      open={open}
      onClose={onClose}
      title="Ask AI"
      description={meta ? `${meta.title} — answers from your live data, limited to what your role can see.` : "Loading…"}
      suggestions={meta?.suggestions ?? []}
      onAsk={onAsk}
      gemini={gemini}
    />
  );
}
