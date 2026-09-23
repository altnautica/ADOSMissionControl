/**
 * Component tests for the Command-tab Probe-result confirmation card.
 * Covers the happy pair path, the AgentAlreadyPairedError mapping,
 * the PairClientError code → translated key mapping, and the
 * addNode-before-connect ordering. The connect itself goes through the one
 * canonical local-node path, whose outcome decides success.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderWithIntl } from "../../../helpers/intl-wrapper";
import { fireEvent, waitFor } from "@testing-library/react";

// Use the real lucide-react. Mocking it via Proxy fails vitest's
// static-export validation. The real module is fast enough for unit
// tests; rendering icons in happy-dom is cheap.

const {
  pairLocallyMock,
  connectLocalNodeMock,
  addNodeMock,
  wipePairMock,
  removeNodeMock,
  reconcileHostMock,
  connState,
} = vi.hoisted(() => ({
  pairLocallyMock: vi.fn(),
  connectLocalNodeMock: vi.fn(),
  connState: { connectionError: null as string | null },
  addNodeMock: vi.fn(),
  wipePairMock: vi.fn(),
  removeNodeMock: vi.fn(),
  reconcileHostMock: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useMutation: () => wipePairMock,
}));

vi.mock("@/lib/agent/local-pair-client", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/agent/local-pair-client")
  >("@/lib/agent/local-pair-client");
  return {
    ...actual,
    pairLocally: pairLocallyMock,
  };
});

vi.mock("@/lib/agent/node-click-handler", () => ({
  connectLocalNode: connectLocalNodeMock,
}));

vi.mock("@/stores/agent-connection-store", () => ({
  useAgentConnectionStore: Object.assign(
    (sel: (s: unknown) => unknown) =>
      sel({
        agentUrl: null,
        apiKey: null,
        connected: false,
      }),
    {
      getState: () => connState,
    },
  ),
}));

vi.mock("@/stores/local-nodes-store", () => ({
  useLocalNodesStore: Object.assign(
    (sel: (s: unknown) => unknown) =>
      sel({
        addNode: addNodeMock,
        removeNode: removeNodeMock,
        reconcileHost: reconcileHostMock,
        nodes: [],
      }),
    {
      getState: () => ({
        addNode: addNodeMock,
        removeNode: removeNodeMock,
        reconcileHost: reconcileHostMock,
        nodes: [],
      }),
    },
  ),
}));

import { ProbeResultCard } from "@/components/command/disconnected/ProbeResultCard";
import {
  AgentAlreadyPairedError,
  PairClientError,
  type ProbeResult,
} from "@/lib/agent/local-pair-client";

function probe(overrides: Partial<ProbeResult> = {}): ProbeResult {
  return {
    deviceId: "abc123",
    name: "testnode",
    version: "0.25.0",
    board: "Raspberry Pi 4B",
    paired: false,
    pairingCode: "TEST12",
    mdnsHost: "ados-abc123.local",
    profile: "drone",
    role: null,
    hostname: "http://testnode.local:8080",
    ...overrides,
  };
}

beforeEach(() => {
  pairLocallyMock.mockReset();
  connectLocalNodeMock.mockReset();
  addNodeMock.mockReset();
  connState.connectionError = null;
});

describe("ProbeResultCard", () => {
  it("renders the probed agent identity", () => {
    const { getByText } = renderWithIntl(
      <ProbeResultCard
        probe={probe()}
        onPaired={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(getByText("testnode")).toBeTruthy();
    expect(getByText("abc123")).toBeTruthy();
    expect(getByText("Raspberry Pi 4B")).toBeTruthy();
  });

  it("happy path: pairs locally, persists the node, then calls onPaired", async () => {
    pairLocallyMock.mockResolvedValueOnce({
      apiKey: "ados_k",
      deviceId: "abc123",
      name: "testnode",
      mdnsHost: "ados-abc123.local",
      hostname: "http://testnode.local:8080",
    });
    connectLocalNodeMock.mockResolvedValueOnce("connected");
    const onPaired = vi.fn();
    const { getByText } = renderWithIntl(
      <ProbeResultCard
        probe={probe()}
        onPaired={onPaired}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(getByText(/Pair locally/));
    await waitFor(() => {
      expect(onPaired).toHaveBeenCalledWith("abc123", "connected");
    });
    expect(addNodeMock).toHaveBeenCalledTimes(1);
    expect(addNodeMock.mock.calls[0][0].apiKey).toBe("ados_k");
    expect(connectLocalNodeMock).toHaveBeenCalledWith("abc123", expect.anything());
  });

  it("addNode runs BEFORE connect — node persists even when connect fails", async () => {
    pairLocallyMock.mockResolvedValueOnce({
      apiKey: "ados_k",
      deviceId: "abc123",
      name: "testnode",
      mdnsHost: "ados-abc123.local",
      hostname: "http://testnode.local:8080",
    });
    connectLocalNodeMock.mockImplementationOnce(async () => {
      connState.connectionError = "ECONNREFUSED";
      return "failed";
    });
    const onPaired = vi.fn();
    const { getByText, findByRole } = renderWithIntl(
      <ProbeResultCard
        probe={probe()}
        onPaired={onPaired}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(getByText(/Pair locally/));
    const alert = await findByRole("alert");
    expect(alert.textContent).toMatch(/could not establish a live connection/);
    expect(alert.textContent).toMatch(/ECONNREFUSED/);
    expect(onPaired).not.toHaveBeenCalled();
    expect(addNodeMock).toHaveBeenCalledTimes(1);
    expect(addNodeMock.mock.invocationCallOrder[0]).toBeLessThan(
      connectLocalNodeMock.mock.invocationCallOrder[0],
    );
  });

  it("maps AgentAlreadyPairedError to the locale-aware message", async () => {
    pairLocallyMock.mockRejectedValueOnce(new AgentAlreadyPairedError());
    const { getByText, findByRole } = renderWithIntl(
      <ProbeResultCard
        probe={probe()}
        onPaired={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(getByText(/Pair locally/));
    const alert = await findByRole("alert");
    expect(alert.textContent).toMatch(/another browser/);
  });

  it("maps a PairClientError code to copy that names the fault and a next action", () => {
    // The agent's own fault sentence is the point of the 5xx branch: an
    // operator must be able to tell a full disk from a broken pairing service.
    // The raw status never appears — it goes to the console instead.
    pairLocallyMock.mockRejectedValueOnce(
      new PairClientError("pairAgentFaultError", "raw", {
        host: "testnode.local",
        settingsUrl: "http://testnode.local:8080/settings",
        detail: "No space left on device",
      }),
    );
    const { getByText, findByRole } = renderWithIntl(
      <ProbeResultCard
        probe={probe()}
        onPaired={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(getByText(/Pair locally/));
    return findByRole("alert").then((alert) => {
      expect(alert.textContent).toMatch(/No space left on device/);
      expect(alert.textContent).toMatch(/ados status/);
      expect(alert.textContent).not.toMatch(/\b5\d\d\b/);
    });
  });

  it("Cancel button fires onCancel", () => {
    const onCancel = vi.fn();
    const { getByText } = renderWithIntl(
      <ProbeResultCard
        probe={probe()}
        onPaired={vi.fn()}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(getByText(/Cancel/));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("renders profile + role pills", () => {
    const { getByText } = renderWithIntl(
      <ProbeResultCard
        probe={probe({ profile: "ground-station", role: "relay" })}
        onPaired={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(getByText("Ground station")).toBeTruthy();
    expect(getByText("relay")).toBeTruthy();
  });
});
