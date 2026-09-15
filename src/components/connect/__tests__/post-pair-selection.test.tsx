/**
 * @module connect/post-pair-selection.test
 * @description A successful pair must OPEN the node it just paired.
 *
 * `ConnectDialog` used to select a `local-<deviceId>` / `cloud-<deviceId>` id —
 * the retired fleet-store projector form. Every fleet row is keyed by the
 * canonical `node:<deviceId>`, so the selection matched nothing: the modal
 * closed, a success toast said "Connected. Your drone is live.", and the
 * operator was dropped back on an unchanged screen with nothing open.
 *
 * The harness below mirrors what the dashboard does with the selection
 * (`app/page.tsx`: pick the fleet row whose `_id` equals `selectedDroneId` and
 * render its detail panel), so this asserts the observable outcome — the paired
 * node opens — rather than the shape of an id string.
 *
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { render, screen, cleanup, act } from "@testing-library/react";

// The local-nodes store is persisted; bind a deterministic in-memory
// localStorage before the store module resolves the global.
vi.hoisted(() => {
  const mem = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: {
      getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
      clear: () => mem.clear(),
      key: (i: number) => Array.from(mem.keys())[i] ?? null,
      get length() {
        return mem.size;
      },
    },
  });
});

// The agent pair panel is the surface under the modal; all this test needs
// from it is the post-pair handoff it fires.
vi.mock("@/components/command/AgentConnectPanel", () => ({
  AgentConnectPanel: ({
    onPaired,
  }: {
    onPaired?: (deviceId: string, apiKey: string, url: string) => void;
  }) => (
    <button type="button" onClick={() => onPaired?.(DEVICE_ID, "", "")}>
      fire-paired
    </button>
  ),
}));
vi.mock("@/components/connect/ActiveConnections", () => ({
  ActiveConnections: () => null,
}));
vi.mock("@/components/connect/DirectMavlinkPanel", () => ({
  DirectMavlinkPanel: () => null,
}));

import messages from "../../../../locales/en.json";
import { ConnectDialog } from "../ConnectDialog";
import { useFleetNodes } from "@/hooks/use-fleet-nodes";
import { useDroneManager } from "@/stores/drone-manager";
import { useLocalNodesStore } from "@/stores/local-nodes-store";
import { usePairDialogStore } from "@/stores/pair-dialog-store";
import { usePairingStore } from "@/stores/pairing-store";

const DEVICE_ID = "abc123";

/** What the dashboard does with `selectedDroneId` (see `app/page.tsx`). */
function DashboardHarness() {
  const fleetNodes = useFleetNodes();
  const selectedDroneId = useDroneManager((s) => s.selectedDroneId);
  if (fleetNodes.length === 0) return <div data-testid="first-run" />;
  const open = fleetNodes.find((n) => n._id === selectedDroneId);
  return open ? (
    <div data-testid="open-node">{open.name}</div>
  ) : (
    <div data-testid="nothing-open" />
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  useLocalNodesStore.setState({
    nodes: [
      {
        deviceId: DEVICE_ID,
        name: "Skynode",
        hostname: "http://192.168.1.50:8080",
        apiKey: "k",
        profile: "drone",
        pairedAt: Date.now(),
      },
    ],
  });
  usePairingStore.setState({ pairedDrones: [] });
  useDroneManager.setState({ selectedDroneId: null });
  usePairDialogStore.getState().openDialog("add");
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  useLocalNodesStore.setState({ nodes: [] });
  useDroneManager.setState({ selectedDroneId: null });
  usePairDialogStore.getState().closeDialog();
});

describe("post-pair selection", () => {
  it("opens the node that was just paired", () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <>
          <ConnectDialog />
          <DashboardHarness />
        </>
      </NextIntlClientProvider>,
    );

    expect(screen.getByTestId("nothing-open")).toBeTruthy();

    act(() => {
      screen.getByText("fire-paired").click();
    });
    // The handoff is deferred so the modal's close animation does not race the
    // detail panel's connect-on-select effect.
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(screen.getByTestId("open-node").textContent).toBe("Skynode");
  });

  it("selects an id that resolves to a real fleet row", () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ConnectDialog />
      </NextIntlClientProvider>,
    );
    act(() => {
      screen.getByText("fire-paired").click();
    });
    act(() => {
      vi.advanceTimersByTime(200);
    });

    const selected = useDroneManager.getState().selectedDroneId;
    // The retired projector forms are what this regressed to; neither matches
    // any fleet row.
    expect(selected).not.toBe(`local-${DEVICE_ID}`);
    expect(selected).not.toBe(`cloud-${DEVICE_ID}`);
    expect(selected).toBe(`node:${DEVICE_ID}`);
  });
});
