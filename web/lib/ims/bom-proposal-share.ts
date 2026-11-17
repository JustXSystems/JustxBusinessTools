import { BOM_PROPOSAL_STATUS_LABEL, type BomDoc } from "@/lib/ims/bom";
import { withBasePath } from "@/lib/base-path";

export type BomProposalShareDoc = Pick<
  BomDoc,
  "id" | "status" | "docNo" | "customerName" | "proposalStatus" | "proposalToken" | "proposalResponseNote"
>;

export type BomProposalShareOut = {
  token: string;
  url: string;
  whatsappUrl: string;
  reused: boolean;
  renewed: boolean;
  doc?: BomDoc;
};

type CreateProposalFn = (id: string, body?: { renew?: boolean }) => Promise<{
  token: string;
  proposalUrl: string;
  whatsappUrl: string;
  reused?: boolean;
  renewed?: boolean;
  doc: BomDoc;
}>;

function localUrl(token: string): string {
  const path = withBasePath(`/bom/proposal/${token}`);
  return `${window.location.origin}${path}`;
}

function waUrl(url: string, customerName: string): string {
  return `https://wa.me/?text=${encodeURIComponent(`Please review our materials proposal: ${url}`)}`;
}

/**
 * Full share workflow that respects prior customer decision state.
 * - Open (sent/viewed): reuses the same token (does not reset status).
 * - Accepted: never silently renews; copy existing or explicit new decision round.
 * - Rejected / revoked / none: creates a fresh open link.
 */
export async function shareBomProposal(
  doc: BomProposalShareDoc,
  createProposal: CreateProposalFn,
  ui: {
    confirm: (message: string) => boolean;
    alert: (message: string) => void;
  } = {
    confirm: (m) => window.confirm(m),
    alert: (m) => window.alert(m),
  },
): Promise<BomProposalShareOut | null> {
  if (doc.status !== "confirmed") {
    ui.alert("Confirm the BOM before sharing a proposal link.");
    return null;
  }

  const status = doc.proposalStatus ?? null;
  const token = doc.proposalToken ?? null;
  const label = status ? BOM_PROPOSAL_STATUS_LABEL[status] ?? status : null;

  if (status === "accepted" && token) {
    const renew = ui.confirm(
      `This proposal was already accepted${doc.proposalResponseNote ? ` (${doc.proposalResponseNote})` : ""}.\n\nOK = start a NEW decision round (clears the previous acceptance)\nCancel = keep acceptance and copy the existing link`,
    );
    if (!renew) {
      const url = localUrl(token);
      return { token, url, whatsappUrl: waUrl(url, doc.customerName || ""), reused: true, renewed: false };
    }
    const out = await createProposal(doc.id, { renew: true });
    return {
      token: out.token,
      url: out.proposalUrl.startsWith("http") ? out.proposalUrl : localUrl(out.token),
      whatsappUrl: out.whatsappUrl,
      reused: false,
      renewed: true,
      doc: out.doc,
    };
  }

  if (status === "rejected") {
    const ok = ui.confirm(
      `This proposal was previously rejected${doc.proposalResponseNote ? ` (${doc.proposalResponseNote})` : ""}. Share a new round for another customer decision?`,
    );
    if (!ok) return null;
    const out = await createProposal(doc.id, { renew: true });
    return {
      token: out.token,
      url: out.proposalUrl.startsWith("http") ? out.proposalUrl : localUrl(out.token),
      whatsappUrl: out.whatsappUrl,
      reused: Boolean(out.reused),
      renewed: true,
      doc: out.doc,
    };
  }

  if ((status === "sent" || status === "viewed") && token) {
    // Server reuses token when renew is omitted — status stays sent/viewed.
    const out = await createProposal(doc.id);
    return {
      token: out.token,
      url: out.proposalUrl.startsWith("http") ? out.proposalUrl : localUrl(out.token),
      whatsappUrl: out.whatsappUrl,
      reused: out.reused !== false,
      renewed: false,
      doc: out.doc,
    };
  }

  if (status === "revoked" || !status || !token) {
    const out = await createProposal(doc.id);
    return {
      token: out.token,
      url: out.proposalUrl.startsWith("http") ? out.proposalUrl : localUrl(out.token),
      whatsappUrl: out.whatsappUrl,
      reused: Boolean(out.reused),
      renewed: Boolean(out.renewed),
      doc: out.doc,
    };
  }

  ui.alert(`Cannot share while proposal status is ${label ?? status}.`);
  return null;
}

export function proposalShareButtonLabel(status: string | null | undefined): string {
  if (status === "sent" || status === "viewed") return "Copy link";
  if (status === "accepted") return "Proposal link";
  if (status === "rejected") return "Share again";
  if (status === "revoked") return "Share proposal";
  return "Share proposal";
}

export function canRevokeBomProposal(status: string | null | undefined): boolean {
  return status === "sent" || status === "viewed";
}
