/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SendToBos } from "./SendToBos";

const push = vi.fn();
let config: { features: Record<string, boolean>; catalog: Array<{ id: string; available: boolean }> };

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/components/config/ConfigProvider", () => ({
  useFeatureSwitch: (key: string) => config.features[key] === true,
  useOptionalPlatformConfig: () => ({ config }),
}));

type Reply = { status: number; body: unknown };
let replies: Record<string, Reply>;
let calls: string[];

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function flush() {
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function renderButton(props: Partial<Parameters<typeof SendToBos>[0]> = {}) {
  const onFlash = vi.fn();
  render(<SendToBos tool="quotationv1" recordId="q1" status="approved" saved className="btn btn-secondary" onFlash={onFlash} {...props} />);
  return onFlash;
}

describe("SendToBos", () => {
  beforeEach(() => {
    push.mockReset();
    calls = [];
    config = { features: { "bos.handoff.quotationv1": true }, catalog: [{ id: "bos", available: true }] };
    replies = {
      "GET /links": { status: 200, body: { links: {} } },
      "POST /connect/quotationv1/q1/import": {
        status: 200,
        body: { imported: [{ tool: "quotationv1", ref: "q1", docNo: "QT-1", target: "party", id: "p1", label: "Meridian", created: true }, { tool: "quotationv1", ref: "q1", docNo: "QT-1", target: "invoice", id: "i9", label: "INV/26-27/0009", created: true }], links: { party: "p1", invoice: "i9" } },
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input), "http://localhost").pathname.replace(/^.*\/api\/bos/, "");
        const key = `${(init?.method ?? "GET").toUpperCase()} ${path}`;
        calls.push(key);
        const reply = replies[key];
        return reply ? json(reply.status, reply.body) : json(404, { error: "Not found" });
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders nothing and calls nothing while the admin switch is off", async () => {
    config.features = {};
    const { container } = render(<SendToBos tool="quotationv1" recordId="q1" status="approved" saved className="btn" onFlash={vi.fn()} />);
    await flush();
    expect(container.innerHTML).toBe("");
    expect(calls).toEqual([]);
  });

  it("stays hidden until Justx BOS itself is Live", async () => {
    config.catalog = [{ id: "bos", available: false }];
    renderButton();
    await flush();
    expect(screen.queryByRole("button")).toBeNull();
    expect(calls).toEqual([]);
  });

  it("stays hidden for a record that was never saved", async () => {
    renderButton({ recordId: null });
    await flush();
    expect(screen.queryByRole("button")).toBeNull();
    expect(calls).toEqual([]);
  });

  it("stays hidden when BOS can't be reached", async () => {
    replies["GET /links"] = { status: 503, body: { error: "setting up", code: "BOS_SCHEMA_PENDING" } };
    renderButton();
    await flush();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("explains why drafts and unsaved edits can't be sent", async () => {
    renderButton({ status: "draft" });
    const draft = await screen.findByRole("button", { name: "Send to BOS" });
    expect((draft as HTMLButtonElement).disabled).toBe(true);
    expect(draft.getAttribute("title")).toMatch(/Submit it first/);
    cleanup();
    renderButton({ saved: false });
    const unsaved = await screen.findByRole("button", { name: "Send to BOS" });
    expect((unsaved as HTMLButtonElement).disabled).toBe(true);
    expect(unsaved.getAttribute("title")).toMatch(/Save your changes first/);
  });

  it("creates the draft invoice once, then opens it in BOS", async () => {
    const onFlash = renderButton();
    fireEvent.click(await screen.findByRole("button", { name: "Send to BOS" }));
    const open = await screen.findByRole("button", { name: /Open in BOS/ });
    expect(onFlash).toHaveBeenCalledWith("Sent to BOS — draft invoice INV/26-27/0009 created.");
    expect(calls.filter((c) => c.startsWith("POST"))).toEqual(["POST /connect/quotationv1/q1/import"]);
    fireEvent.click(open);
    expect(push).toHaveBeenCalledWith("/tools/bos?ws=finance&m=invoices&open=i9");
  });

  it("shows Open in BOS straight away for a record BOS already has", async () => {
    replies["GET /links"] = { status: 200, body: { links: { party: "p1", invoice: "i3" } } };
    renderButton();
    fireEvent.click(await screen.findByRole("button", { name: /Open in BOS/ }));
    expect(push).toHaveBeenCalledWith("/tools/bos?ws=finance&m=invoices&open=i3");
  });

  it("reports a refused import through the host tool's flash", async () => {
    replies["POST /connect/quotationv1/q1/import"] = { status: 403, body: { error: "Read-only access — this role cannot modify data" } };
    const onFlash = renderButton();
    fireEvent.click(await screen.findByRole("button", { name: "Send to BOS" }));
    await flush();
    expect(onFlash).toHaveBeenCalledWith("Read-only access — this role cannot modify data", "err");
    expect(screen.getByRole("button", { name: "Send to BOS" })).toBeTruthy();
  });
});
