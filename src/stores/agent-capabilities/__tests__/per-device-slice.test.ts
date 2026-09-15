/**
 * @module agent-capabilities/per-device-slice.test
 * @description The node-detail tab strip resolves from the capability store,
 * which was a process-wide singleton for the focused agent. Switching from a
 * ground station to a drone therefore painted the ground station's Radio and
 * RC/ELRS tabs on the drone for one frame, the connect's `disconnect()` then
 * cleared the store and those tabs vanished, and the new node's first
 * heartbeat re-added its own set — the strip reflowed twice within ~1 s of
 * every node switch, with a clickable tab belonging to the previous node in
 * between.
 * @license GPL-3.0-only
 */

import { describe, expect, it, beforeEach } from "vitest";

import {
  useAgentCapabilitiesStore,
  selectDeviceCapabilities,
  capabilityPresence,
} from "@/stores/agent-capabilities-store";

const GS = "dev-gs";
const DRONE = "dev-drone";

beforeEach(() => {
  useAgentCapabilitiesStore.setState({ byDevice: {}, focusedDeviceId: null });
  useAgentCapabilitiesStore.getState().clear();
});

const caps = (id: string) =>
  selectDeviceCapabilities(useAgentCapabilitiesStore.getState(), id);

describe("per-device capability slices", () => {
  it("files each node's reading under its own device id", () => {
    const s = useAgentCapabilitiesStore.getState();
    s.setCapabilities({ crsf: { state: "link_ok" }, radio: { rssi: -60 } }, GS);
    s.setCapabilities({}, DRONE);

    expect(caps(GS)?.crsf).not.toBeNull();
    expect(caps(DRONE)?.crsf).toBeNull();
  });

  it("reports a node this browser has never heard from as unknown, not absent", () => {
    // `unknown` is the whole point: a surface must neither advertise the
    // capability nor claim the hardware is missing.
    expect(caps("dev-never-seen")).toBeNull();
    expect(
      capabilityPresence(caps("dev-never-seen"), (c) => c.crsf !== null),
    ).toBe("unknown");
  });

  it("distinguishes present from absent once a node has described itself", () => {
    const s = useAgentCapabilitiesStore.getState();
    s.setCapabilities({ crsf: { state: "link_ok" } }, GS);
    s.setCapabilities({}, DRONE);

    expect(capabilityPresence(caps(GS), (c) => c.crsf !== null)).toBe("present");
    expect(capabilityPresence(caps(DRONE), (c) => c.crsf !== null)).toBe(
      "absent",
    );
  });

  it("keeps a node's slice across the disconnect a node switch performs", () => {
    const s = useAgentCapabilitiesStore.getState();
    s.setCapabilities({ crsf: { state: "link_ok" } }, GS);

    // This is what `client-manager.disconnect()` does mid-switch.
    useAgentCapabilitiesStore.getState().clear();

    // The focused slice is reset (nothing is connected)...
    expect(useAgentCapabilitiesStore.getState().crsf).toBeNull();
    // ...but the ground station's own reading survives, so re-opening it
    // paints its gates on the first frame instead of collapsing the strip.
    expect(caps(GS)?.crsf).not.toBeNull();
  });

  it("drops a node's slice only when it is explicitly forgotten", () => {
    const s = useAgentCapabilitiesStore.getState();
    s.setCapabilities({ crsf: { state: "link_ok" } }, GS);
    useAgentCapabilitiesStore.getState().forgetDevice(GS);
    expect(caps(GS)).toBeNull();
  });

  it("still updates the focused flat slice for the ~60 focused-agent readers", () => {
    useAgentCapabilitiesStore
      .getState()
      .setCapabilities({ crsf: { state: "link_ok" } }, GS);
    expect(useAgentCapabilitiesStore.getState().crsf).not.toBeNull();
    expect(useAgentCapabilitiesStore.getState().focusedDeviceId).toBe(GS);
  });
});
