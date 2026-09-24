/**
 * @license GPL-3.0-only
 *
 * The Cameras tab schedules a post-write pipeline-restart re-read. That timer
 * must be cleared on unmount so it never fires a load against a drone slice the
 * operator has navigated away from (the orphan-timer race). It also resolves
 * its transport from the node it is rendered for, never from whichever agent
 * happens to be attached.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { render, screen, fireEvent, act } from "@testing-library/react";

import messages from "../../../../../locales/en.json";
import { CameraManagerTab } from "../CameraManagerTab";
import { useCameraManagerStore } from "@/stores/camera-manager-store";
import type { RosterCamera } from "@/lib/agent/feature-types";

const camera: RosterCamera = {
  id: "belly",
  name: "Belly cam",
  source: "/dev/video2",
  role: null,
  purpose: ["navigation"],
  orientation: "down",
  enabled: true,
  owner: "operator",
  state: "assigned",
  live: true,
};

const client = {
  getCameraRoster: vi.fn(),
  setCameraRoster: vi.fn(),
};

// The attached connection: which node's agent the store currently holds.
const attached = { nodeDeviceId: "dev-1" };

vi.mock("@/stores/agent-connection-store", () => ({
  useAgentConnectionStore: (sel: (s: unknown) => unknown) =>
    sel({
      client,
      cloudMode: false,
      agentUrl: "http://192.168.1.50:8080",
      apiKey: "k",
      nodeDeviceId: attached.nodeDeviceId,
    }),
}));
vi.mock("@/stores/agent-capabilities-store", () => ({
  useAgentCapabilitiesStore: (sel: (s: unknown) => unknown) =>
    sel({ byDevice: { "dev-1": { videoStreams: [] } } }),
  selectDeviceCapabilities: (
    s: { byDevice: Record<string, unknown> },
    id: string | null,
  ) => (id ? (s.byDevice[id] ?? null) : null),
}));
vi.mock("@/stores/fleet-store", () => ({
  useFleetStore: (sel: (s: unknown) => unknown) =>
    sel({ drones: [{ id: "d1", cloudDeviceId: "dev-1" }] }),
}));
vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

function wrap(node: React.ReactElement) {
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      {node}
    </NextIntlClientProvider>
  );
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("CameraManagerTab · restart timer lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    client.getCameraRoster.mockReset().mockResolvedValue([{ ...camera }]);
    client.setCameraRoster.mockReset().mockResolvedValue(undefined);
    useCameraManagerStore.setState({ byDrone: {} });
    attached.nodeDeviceId = "dev-1";
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("clears the post-write re-read timer on unmount (no orphan load)", async () => {
    const { unmount } = render(wrap(<CameraManagerTab droneId="d1" />));
    await flush(); // initial roster load resolves
    expect(client.getCameraRoster).toHaveBeenCalledTimes(1);

    // Toggle the camera — this persists and schedules the restart re-read.
    fireEvent.click(screen.getByRole("switch"));
    await flush();
    expect(client.setCameraRoster).toHaveBeenCalledTimes(1);
    // The re-read is still pending (behind the restart delay).
    expect(client.getCameraRoster).toHaveBeenCalledTimes(1);

    unmount();
    // Past the restart delay: a cleared timer must not fire a second read.
    vi.advanceTimersByTime(5000);
    await flush();
    expect(client.getCameraRoster).toHaveBeenCalledTimes(1);
  });

  it("never reads or writes another node's attached agent", async () => {
    attached.nodeDeviceId = "dev-other";
    render(wrap(<CameraManagerTab droneId="d1" />));
    await flush();
    expect(client.getCameraRoster).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /add/i })).toBeDisabled();
  });
});
