/**
 * @license GPL-3.0-only
 *
 * Render tests for the ADOS Black Box push affordances against connection
 * states the GCS actually produces: a cloud-paired node reached on the LAN
 * (no cloud session, a live client) can push, a LAN-only node cannot, and a
 * cloud session (no client) cannot push but still lists the windows already
 * exported. A tab rendered for a node whose client is not attached shows a
 * connecting state, never another node's store.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../locales/en.json";

// Gate always passes so the body (and the toolbar) renders.
vi.mock("@/hooks/use-surface-gate", () => ({
  useSurfaceGate: () => ({ mode: "ok", requirement: "agent-online" }),
}));
vi.mock("./shared/agent-gate-fallback", () => ({
  agentGateFallback: () => null,
}));

vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// The reactive cloud-read is driven per test.
let convexWindows: unknown[] | undefined = undefined;
vi.mock("@/hooks/use-convex-skip-query", () => ({
  useConvexSkipQuery: () => convexWindows,
}));
vi.mock("convex/react", () => ({
  useAction: () => vi.fn(async () => ({ url: "https://x/y", window: {} })),
}));

import { BlackBoxTab } from "../BlackBoxTab";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useBlackBoxStore } from "@/stores/blackbox-store";
import { usePairingStore, type PairedDrone } from "@/stores/pairing-store";
import type { AgentClient } from "@/lib/agent/client";

const NODE = "dev_1";

const envelope = (data: unknown[]) => ({
  data,
  page: { next_cursor: null, count: data.length },
  meta: { source: "logd", v: 1, ts: "", db_lag_ms: 0 },
});

function fakeClient(rows: unknown[] = []): AgentClient {
  const logging = {
    sessions: vi.fn(async () => envelope([])),
    query: vi.fn(async () => envelope(rows)),
    aggregate: vi.fn(async () => envelope([])),
    healthz: vi.fn(async () => ({
      ok: true,
      db_open: true,
      writer_alive: true,
      integrity: true,
      source: "logd",
    })),
    stats: vi.fn(async () => null),
    pushWindow: vi.fn(),
  };
  return { logging } as unknown as AgentClient;
}

async function renderTab(nodeDeviceId: string | null = NODE) {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <BlackBoxTab nodeDeviceId={nodeDeviceId} />
    </NextIntlClientProvider>,
  );
  // Let the attach-time reads settle.
  await act(async () => {});
}

/** A LAN session to `nodeDeviceId`: connect() never sets a cloud device id. */
function lanSession(client: AgentClient, nodeDeviceId = NODE) {
  useAgentConnectionStore.setState({
    cloudMode: false,
    cloudDeviceId: null,
    nodeDeviceId,
    agentUrl: "http://192.168.1.50:8080",
    client,
  });
}

/** A cloud session: connectCloud() sets cloudMode and the device id, no client. */
function cloudSession() {
  useAgentConnectionStore.setState({
    cloudMode: true,
    cloudDeviceId: NODE,
    nodeDeviceId: NODE,
    agentUrl: "http://192.168.1.50:8080",
    client: null,
  });
}

function setCloudPaired(paired: boolean) {
  usePairingStore.setState({
    pairedDrones: paired ? [{ _id: "row_1", deviceId: NODE } as PairedDrone] : [],
  });
}

function pushButton(): HTMLButtonElement {
  const btn = screen
    .getAllByRole("button")
    .find((b) => b.textContent?.includes("Push to cloud"));
  if (!btn) throw new Error("Push to cloud button not found");
  return btn as HTMLButtonElement;
}

const pushedWindow = {
  _id: "w1",
  _creationTime: 1,
  deviceId: NODE,
  sessionId: "7",
  kind: "logs",
  windowStartUs: 1,
  windowEndUs: 2,
  contentHash: "h",
  format: "jsonl.zst",
  rowCount: 10,
  sizeBytes: 2048,
  pushedAt: Date.now(),
};

describe("BlackBoxTab push affordances", () => {
  beforeEach(() => {
    convexWindows = undefined;
    useBlackBoxStore.getState().clear();
  });

  it("disables Push to cloud on a LAN-only node with no cloud pairing", async () => {
    setCloudPaired(false);
    lanSession(fakeClient());
    await renderTab();
    const btn = pushButton();
    expect(btn).toBeDisabled();
    expect(btn.title).toBe(messages.blackbox.pushNeedsPairing);
  });

  it("enables Push to cloud on a cloud-paired node reached on the LAN", async () => {
    setCloudPaired(true);
    lanSession(fakeClient());
    await renderTab();
    const btn = pushButton();
    expect(btn).not.toBeDisabled();
    expect(btn.title).toBe(messages.blackbox.push);
  });

  it("disables Push in a cloud session but still lists exported windows", async () => {
    setCloudPaired(true);
    cloudSession();
    convexWindows = [pushedWindow];
    await renderTab();
    const btn = pushButton();
    expect(btn).toBeDisabled();
    expect(btn.title).toBe(messages.blackbox.pushNeedsLocal);
    expect(screen.getByText(messages.blackbox.pushedWindows)).toBeTruthy();
  });

  it("hides the exported-windows list when the query is empty", async () => {
    setCloudPaired(true);
    lanSession(fakeClient());
    convexWindows = [];
    await renderTab();
    expect(screen.queryByText(messages.blackbox.pushedWindows)).toBeNull();
  });

  it("shows connecting, not the attached node's rows, for a node not yet reached", async () => {
    setCloudPaired(false);
    const clientA = fakeClient([
      { id: 1, ts: "2026-01-01T00:00:00Z", level: "info", source: "a", message: "row from node A" },
    ]);
    lanSession(clientA, "dev_a");
    useBlackBoxStore.getState().attach(clientA);
    await act(async () => {});
    await renderTab("dev_b");
    expect(screen.queryByText("row from node A")).toBeNull();
    expect(screen.getByText(messages.blackbox.connecting)).toBeTruthy();
  });
});
