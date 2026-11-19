"use client";

import { useCallback, useState, type ReactNode } from "react";
import { Button, Dialog } from "@/components/bos";

export type AdminConfirmRequest = {
  title: ReactNode;
  /** Consequence copy shown under the title. */
  description?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** Destructive (coral) vs. normal (blue) confirm. Default: destructive. */
  tone?: "destructive" | "primary";
  onConfirm: () => void | Promise<void>;
};

type State = { request: AdminConfirmRequest | null; open: boolean };

/**
 * Imperative confirm for admin pages, built on the BOS Dialog (portal — never nests BosRoot).
 * Render `dialog` once anywhere in the page; call `confirm({...})` from click handlers.
 * The last request is kept while the dialog animates closed so copy does not flash empty.
 */
export function useAdminConfirm() {
  const [state, setState] = useState<State>({ request: null, open: false });

  const confirm = useCallback((request: AdminConfirmRequest) => {
    setState({ request, open: true });
  }, []);

  const close = useCallback(() => {
    setState((s) => ({ ...s, open: false }));
  }, []);

  const { request, open } = state;
  const destructive = (request?.tone ?? "destructive") === "destructive";

  const dialog = request ? (
    <Dialog
      open={open}
      onClose={close}
      title={request.title}
      description={request.description}
      icon={{ tone: destructive ? "coral" : "blue" }}
      actions={
        <>
          <Button variant="ghost" onClick={close}>
            {request.cancelLabel ?? "Cancel"}
          </Button>
          <Button
            variant={destructive ? "destructive" : "primary"}
            onClick={() => {
              close();
              void request.onConfirm();
            }}
          >
            {request.confirmLabel}
          </Button>
        </>
      }
    />
  ) : null;

  return { confirm, dialog };
}
