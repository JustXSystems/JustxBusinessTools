"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useFeatureSwitch, useOptionalPlatformConfig } from "@/components/config/ConfigProvider";
import { bos, errorText } from "@/lib/bos-app/api";
import { canHandOff, HANDOFF, isBosLive, type HandoffTool } from "@/lib/bos-app/handoff";

type Props = {
  tool: HandoffTool;
  /** Saved record id (`document_records.id`); null until the record has been saved once. */
  recordId: string | null | undefined;
  status: string | null | undefined;
  /** False while the editor has unsaved changes — BOS reads the saved record. */
  saved: boolean;
  /** The host tool's own button class, so the button matches its neighbours. */
  className: string;
  onFlash: (message: string, kind?: "ok" | "err") => void;
};

type Lookup = { key: string; linkedId: string | null; failed: boolean };

/**
 * "Send to BOS" for another JBT tool. Renders nothing unless an admin has turned on the tool's
 * switch and Justx BOS is Live for the org; once sent, it becomes "Open in BOS".
 */
export function SendToBos({ tool, recordId, status, saved, className, onFlash }: Props) {
  const spec = HANDOFF[tool];
  const router = useRouter();
  const switchOn = useFeatureSwitch(spec.switchKey);
  const live = isBosLive(useOptionalPlatformConfig()?.config?.catalog);
  const enabled = switchOn && live && Boolean(recordId);
  const key = `${tool}:${recordId ?? ""}`;
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!enabled || !recordId) return;
    let alive = true;
    bos.links(tool, recordId).then(
      (r) => alive && setLookup({ key, linkedId: r.links[spec.target] ?? null, failed: false }),
      () => alive && setLookup({ key, linkedId: null, failed: true }),
    );
    return () => {
      alive = false;
    };
  }, [enabled, tool, recordId, key, spec.target]);

  if (!enabled || !recordId || lookup?.key !== key || lookup.failed) return null;

  const linkedId = lookup.linkedId;
  if (linkedId) {
    return (
      <button type="button" className={className} title={`Open the ${spec.creates} in Justx BOS`} onClick={() => router.push(spec.openHref(linkedId))}>
        Open in BOS ↗
      </button>
    );
  }

  const blocked = !saved ? "Save your changes first — BOS reads the saved record" : !canHandOff(status) ? (status === "rejected" ? "Rejected records aren't sent to BOS" : "Submit it first — drafts stay out of BOS") : null;

  async function send() {
    if (!recordId) return;
    setBusy(true);
    try {
      const res = await bos.importRecord(tool, recordId, spec.target);
      const made = res.imported.find((i) => i.target === spec.target);
      setLookup({ key, linkedId: res.links[spec.target] ?? made?.id ?? null, failed: false });
      const label = made?.label ? ` ${made.label}` : "";
      onFlash(made?.created === false ? `Already in BOS as${label}.` : `Sent to BOS — ${spec.creates}${label} created.`);
    } catch (err) {
      onFlash(errorText(err), "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" className={className} disabled={busy || blocked !== null} title={blocked ?? `Create a ${spec.creates} (and the customer) in Justx BOS`} onClick={() => void send()}>
      {busy ? "Sending…" : "Send to BOS"}
    </button>
  );
}
