import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";

// --- Mocks ----------------------------------------------------------

const useQueryMock = vi.fn();
const useConvexAvailableMock = vi.fn(() => true);
const isDemoModeMock = vi.fn(() => false);

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}));
vi.mock("convex/server", () => ({
  makeFunctionReference: (name: string) => ({ _ref: name }),
}));
vi.mock("@/app/ConvexClientProvider", () => ({
  useConvexAvailable: () => useConvexAvailableMock(),
}));
vi.mock("@/lib/utils", async () => {
  const actual = await vi.importActual<typeof import("@/lib/utils")>(
    "@/lib/utils",
  );
  return {
    ...actual,
    isDemoMode: () => isDemoModeMock(),
  };
});

// --- WebSocket stub --------------------------------------------------

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  url: string;
  protocols: ReadonlyArray<string>;
  readyState = 0;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  closed = false;

  constructor(url: string, protocols?: string | ReadonlyArray<string>) {
    this.url = url;
    this.protocols =
      typeof protocols === "string"
        ? [protocols]
        : (protocols ?? ([] as ReadonlyArray<string>));
    FakeWebSocket.instances.push(this);
  }
  close() {
    this.closed = true;
  }
  emit(stage: string, extra: Record<string, unknown> = {}) {
    this.onmessage?.({ data: JSON.stringify({ stage, ...extra }) });
  }
  emitClose() {
    this.onclose?.({});
  }
}

const OrigWebSocket = globalThis.WebSocket;
const OrigFetch = globalThis.fetch;

import { PluginInstallProgress } from "@/components/plugins/PluginInstallProgress";
import { useInstallProgressStore } from "@/components/plugins/install-progress-store";

/** Stub the ticket-mint REST call so the WebSocket subscription has a
 * synchronous-feeling fast path. Returns a Promise that resolves on
 * the first ticket fetch so tests can await it before checking that
 * the FakeWebSocket constructor fired. */
function stubTicketMint(ticket: string): {
  fetchMock: ReturnType<typeof vi.fn>;
  awaitFirstCall: () => Promise<void>;
} {
  const resolvers: Array<() => void> = [];
  const fetchMock = vi.fn(async () => {
    queueMicrotask(() => {
      const r = resolvers.shift();
      if (r) r();
    });
    return new Response(JSON.stringify({ ticket }), { status: 200 });
  });
  (globalThis as unknown as { fetch: typeof fetch }).fetch =
    fetchMock as unknown as typeof fetch;
  const awaitFirstCall = () =>
    new Promise<void>((resolve) => {
      resolvers.push(resolve);
    });
  return { fetchMock, awaitFirstCall };
}

beforeEach(() => {
  useQueryMock.mockReset();
  useQueryMock.mockReturnValue(undefined);
  useConvexAvailableMock.mockReset();
  useConvexAvailableMock.mockReturnValue(true);
  isDemoModeMock.mockReset();
  isDemoModeMock.mockReturnValue(false);
  FakeWebSocket.instances = [];
  (globalThis as unknown as { WebSocket: typeof FakeWebSocket }).WebSocket =
    FakeWebSocket;
  useInstallProgressStore.getState().clear();
});

afterEach(() => {
  (globalThis as unknown as { WebSocket: typeof WebSocket }).WebSocket =
    OrigWebSocket;
  (globalThis as unknown as { fetch: typeof fetch }).fetch = OrigFetch;
});

// --- Tests -----------------------------------------------------------

describe("PluginInstallProgress", () => {
  it("mints a ticket, opens a LAN WebSocket with the ticket subprotocol, and tracks stage frames", async () => {
    const { fetchMock } = stubTicketMint("abcdef0123");
    render(
      <PluginInstallProgress
        jobId="job-1"
        transport="lan"
        agentLanUrl="http://skynode.local:8080"
        pairingKey="secret-key"
        pluginName="Thermal Cam"
        pluginVersion="1.0.0"
      />,
    );

    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const ws = FakeWebSocket.instances[0]!;
    // URL never carries the pairing key.
    expect(ws.url).toBe("ws://skynode.local:8080/api/plugins/jobs/job-1");
    expect(ws.url.includes("api_key")).toBe(false);
    expect(ws.url.includes("secret-key")).toBe(false);
    // The ticket rides the subprotocol array.
    expect(ws.protocols).toEqual(["ados-ws-ticket", "abcdef0123"]);
    // The ticket mint POST went through the REST middleware with
    // X-ADOS-Key.
    expect(fetchMock).toHaveBeenCalled();
    const [mintUrl, init] = fetchMock.mock.calls[0]!;
    expect(String(mintUrl)).toBe("http://skynode.local:8080/api/_ws/ticket");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      scope: "plugins.install_job",
    });
    expect(
      (init as RequestInit | undefined)?.method,
    ).toBe("POST");
    const hdrs = (init as RequestInit | undefined)?.headers as
      | Record<string, string>
      | undefined;
    expect(hdrs?.["X-ADOS-Key"]).toBe("secret-key");

    act(() => {
      ws.emit("installing");
    });
    expect(screen.getByText(/Installing/)).toBeInTheDocument();
  });

  it("fires onComplete with installId when the LAN socket reports completed", async () => {
    stubTicketMint("t-2");
    const onComplete = vi.fn();
    render(
      <PluginInstallProgress
        jobId="job-2"
        transport="lan"
        agentLanUrl="http://skynode.local:8080"
        pairingKey="k"
        onComplete={onComplete}
      />,
    );
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const ws = FakeWebSocket.instances[0]!;

    act(() => {
      ws.emit("completed", { installId: "inst-xyz" });
    });

    expect(onComplete).toHaveBeenCalledWith({ installId: "inst-xyz" });
    expect(screen.getByText("Done")).toBeInTheDocument();
  });

  it("fires onFailed and shows the error code on a failed stage", async () => {
    stubTicketMint("t-3");
    const onFailed = vi.fn();
    render(
      <PluginInstallProgress
        jobId="job-3"
        transport="lan"
        agentLanUrl="http://skynode.local:8080"
        pairingKey="k"
        onFailed={onFailed}
      />,
    );
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const ws = FakeWebSocket.instances[0]!;

    act(() => {
      ws.emit("failed", {
        error: { code: "sig_mismatch", message: "bad signature" },
      });
    });

    expect(onFailed).toHaveBeenCalledWith({
      code: "sig_mismatch",
      message: "bad signature",
    });
    expect(screen.getByText(/sig_mismatch/)).toBeInTheDocument();
  });

  it("fails with auth_missing when the pairing key is absent", () => {
    render(
      <PluginInstallProgress
        jobId="job-noauth"
        transport="lan"
        agentLanUrl="http://skynode.local:8080"
      />,
    );
    // No fetch attempt, no WebSocket constructed.
    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(screen.getByText(/Failed: auth_missing/)).toBeInTheDocument();
  });

  it("subscribes via Convex useQuery on the cloud path and reflects job updates", () => {
    useQueryMock.mockReturnValue({
      jobId: "job-5",
      stage: "downloading",
      updatedAt: Date.now(),
    });
    render(
      <PluginInstallProgress
        jobId="job-5"
        transport="cloud"
        pluginName="Thermal"
      />,
    );
    expect(useQueryMock).toHaveBeenCalled();
    const lastArgs = useQueryMock.mock.calls.at(-1);
    expect(lastArgs?.[1]).toEqual({ jobId: "job-5" });
    expect(screen.getByText(/Agent downloading/)).toBeInTheDocument();
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it("skips the cloud query in demo mode and walks the simulated sequence", () => {
    vi.useFakeTimers();
    isDemoModeMock.mockReturnValue(true);
    const onComplete = vi.fn();
    try {
      render(
        <PluginInstallProgress
          jobId="demo-1"
          transport="lan"
          agentLanUrl="http://skynode.local:8080"
          pairingKey="k"
          onComplete={onComplete}
        />,
      );
      // No WebSocket in demo mode.
      expect(FakeWebSocket.instances).toHaveLength(0);
      act(() => {
        vi.advanceTimersByTime(600 * 4);
      });
      expect(onComplete).toHaveBeenCalled();
      expect(onComplete.mock.calls[0]?.[0].installId).toMatch(/^demo-/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("handles transport switch from LAN to cloud cleanly", async () => {
    stubTicketMint("t-6");
    const { rerender } = render(
      <PluginInstallProgress
        jobId="job-6"
        transport="lan"
        agentLanUrl="http://skynode.local:8080"
        pairingKey="k"
      />,
    );
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const ws = FakeWebSocket.instances[0]!;

    useQueryMock.mockReturnValue({
      jobId: "job-6",
      stage: "queued",
      updatedAt: Date.now(),
    });

    rerender(
      <PluginInstallProgress
        jobId="job-6"
        transport="cloud"
      />,
    );

    // LAN socket cleaned up.
    expect(ws.closed).toBe(true);
    expect(screen.getByText("Cloud")).toBeInTheDocument();
    expect(useQueryMock).toHaveBeenCalled();
  });

  it("writes every transition into the shared install-progress store", async () => {
    stubTicketMint("t-7");
    render(
      <PluginInstallProgress
        jobId="job-7"
        transport="lan"
        agentLanUrl="http://skynode.local:8080"
        pairingKey="k"
        pluginName="X"
      />,
    );
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const ws = FakeWebSocket.instances[0]!;
    act(() => {
      ws.emit("enabling");
    });
    const snap = useInstallProgressStore.getState().jobs["job-7"];
    expect(snap?.stage).toBe("enabling");
    expect(snap?.transport).toBe("lan");
    expect(snap?.pluginName).toBe("X");
  });
});
