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
import { render, screen, fireEvent, act, within } from "@testing-library/react";

import messages from "../../../../../locales/en.json";
import { CameraManagerTab } from "../CameraManagerTab";
import { useCameraManagerStore } from "@/stores/camera-manager-store";
import type { RosterCamera } from "@/lib/agent/camera-roster-types";

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
// The node's arm state as the fleet reports it.
const fleet = { armState: "disarmed" };
// Whether the session is a cloud session (which builds no agent client).
const session = { cloudMode: false };

vi.mock("@/stores/agent-connection-store", () => ({
  useAgentConnectionStore: (sel: (s: unknown) => unknown) =>
    sel({
      client: session.cloudMode ? null : client,
      cloudMode: session.cloudMode,
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
vi.mock("@/stores/node-registry/use-fleet-drones", () => ({
  useFleetDrones: (sel: (drones: unknown[]) => unknown) =>
    sel([{ id: "d1", cloudDeviceId: "dev-1", armState: fleet.armState }]),
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
    fleet.armState = "disarmed";
    session.cloudMode = false;
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

  it("says the node is unreachable instead of reporting no cameras", async () => {
    attached.nodeDeviceId = "dev-other";
    render(wrap(<CameraManagerTab droneId="d1" />));
    await flush();
    expect(screen.getByText(messages.cameras.unavailable)).toBeTruthy();
    expect(screen.queryByText(messages.cameras.empty)).toBeNull();
  });

  it("in a cloud session says the node is unreachable, not that it has no cameras", async () => {
    session.cloudMode = true;
    render(wrap(<CameraManagerTab droneId="d1" />));
    await flush();
    expect(client.getCameraRoster).not.toHaveBeenCalled();
    expect(screen.getByText(messages.cameras.unavailable)).toBeTruthy();
    expect(screen.queryByText(messages.cameras.empty)).toBeNull();
  });
});

describe("CameraManagerTab · writes that restart video", () => {
  beforeEach(() => {
    client.getCameraRoster.mockReset().mockResolvedValue([{ ...camera }]);
    client.setCameraRoster.mockReset().mockResolvedValue(undefined);
    useCameraManagerStore.setState({ byDrone: {} });
    attached.nodeDeviceId = "dev-1";
    fleet.armState = "disarmed";
    session.cloudMode = false;
  });

  it("asks before removing a camera and writes only on confirm", async () => {
    render(wrap(<CameraManagerTab droneId="d1" />));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: messages.cameras.card.remove }));
    await flush();
    expect(client.setCameraRoster).not.toHaveBeenCalled();
    expect(screen.getByText(messages.cameras.confirm.removeMessage.replace("{name}", "Belly cam"))).toBeTruthy();
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: messages.cameras.confirm.removeAction }),
    );
    await flush();
    expect(client.setCameraRoster).toHaveBeenCalledTimes(1);
  });

  it("cancelling a removal writes nothing", async () => {
    render(wrap(<CameraManagerTab droneId="d1" />));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: messages.cameras.card.remove }));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    await flush();
    expect(client.setCameraRoster).not.toHaveBeenCalled();
  });

  it("holds a toggle for confirmation while the drone is armed", async () => {
    fleet.armState = "armed";
    render(wrap(<CameraManagerTab droneId="d1" />));
    await flush();
    fireEvent.click(screen.getByRole("switch"));
    await flush();
    expect(client.setCameraRoster).not.toHaveBeenCalled();
    expect(screen.getByText(messages.cameras.confirm.armedMessage)).toBeTruthy();
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: messages.cameras.confirm.armedAction }),
    );
    await flush();
    expect(client.setCameraRoster).toHaveBeenCalledTimes(1);
  });

  describe("when the arm state is unknown (the drone may be flying)", () => {
    beforeEach(() => {
      fleet.armState = "unknown";
    });

    async function expectHeldForConfirm() {
      await flush();
      expect(client.setCameraRoster).not.toHaveBeenCalled();
      expect(screen.getByText(messages.cameras.confirm.armedUnknownMessage)).toBeTruthy();
      fireEvent.click(
        within(screen.getByRole("alertdialog")).getByRole("button", { name: messages.cameras.confirm.armedAction }),
      );
      await flush();
      expect(client.setCameraRoster).toHaveBeenCalledTimes(1);
    }

    it("holds a toggle for confirmation", async () => {
      render(wrap(<CameraManagerTab droneId="d1" />));
      await flush();
      fireEvent.click(screen.getByRole("switch"));
      await expectHeldForConfirm();
    });

    it("holds an edit for confirmation", async () => {
      render(wrap(<CameraManagerTab droneId="d1" />));
      await flush();
      fireEvent.click(screen.getByRole("button", { name: messages.cameras.card.edit }));
      fireEvent.click(screen.getByRole("button", { name: messages.cameras.editor.save }));
      await expectHeldForConfirm();
    });

    it("holds an added camera for confirmation", async () => {
      render(wrap(<CameraManagerTab droneId="d1" />));
      await flush();
      fireEvent.click(screen.getByRole("button", { name: messages.cameras.addIp }));
      fireEvent.change(screen.getByPlaceholderText(messages.cameras.addDialog.namePlaceholder), {
        target: { value: "Dome" },
      });
      fireEvent.change(screen.getByPlaceholderText(messages.cameras.addDialog.urlPlaceholder), {
        target: { value: "rtsp://192.0.2.10:554/stream" },
      });
      fireEvent.click(screen.getByRole("button", { name: messages.cameras.addDialog.add }));
      await expectHeldForConfirm();
    });

    it("names the possible arm in the removal confirm", async () => {
      render(wrap(<CameraManagerTab droneId="d1" />));
      await flush();
      fireEvent.click(screen.getByRole("button", { name: messages.cameras.card.remove }));
      await flush();
      expect(
        screen.getByText(
          `${messages.cameras.confirm.removeMessage.replace("{name}", "Belly cam")} ${messages.cameras.confirm.armedUnknownMessage}`,
        ),
      ).toBeTruthy();
    });
  });
});
