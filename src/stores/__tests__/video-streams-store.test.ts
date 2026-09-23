import { beforeEach, describe, expect, it } from "vitest";

import {
  ROLE_LABEL_KEY,
  useVideoStreamsStore,
  type StreamDescriptor,
} from "@/stores/video-streams-store";

function stream(over: Partial<StreamDescriptor> & Pick<StreamDescriptor, "id" | "index">): StreamDescriptor {
  return {
    label: "Camera",
    kind: "concurrent",
    ...over,
  };
}

function concurrent(id: string, index: number, role?: string): StreamDescriptor {
  return stream({
    id,
    index,
    role,
    label: id,
    kind: "concurrent",
    address: { whepPath: `${id}/whep` },
  });
}

const DRONE = "node:d1";

describe("video-streams-store", () => {
  beforeEach(() => useVideoStreamsStore.getState().clear());

  it("stores streams per drone and defaults the active to the first", () => {
    const s = useVideoStreamsStore.getState();
    s.setStreams(DRONE, [concurrent("eo", 1, "eo"), concurrent("ir", 2, "ir")]);
    const st = useVideoStreamsStore.getState();
    expect(st.streamsForDrone(DRONE)).toHaveLength(2);
    expect(st.activeStream(DRONE)?.id).toBe("eo");
  });

  it("auto-detect: switcher shows only when more than one stream", () => {
    const s = useVideoStreamsStore.getState();
    s.setStreams(DRONE, [concurrent("eo", 1, "eo")]);
    expect(useVideoStreamsStore.getState().streamsForDrone(DRONE).length > 1).toBe(false);
    s.setStreams(DRONE, [concurrent("eo", 1, "eo"), concurrent("ir", 2, "ir")]);
    expect(useVideoStreamsStore.getState().streamsForDrone(DRONE).length > 1).toBe(true);
  });

  it("selects by 1-based index (the hotkey digit)", () => {
    const s = useVideoStreamsStore.getState();
    s.setStreams(DRONE, [
      concurrent("eo", 1),
      concurrent("wide", 2),
      concurrent("ir", 3),
    ]);
    s.selectStream(DRONE, 3);
    expect(useVideoStreamsStore.getState().activeStream(DRONE)?.id).toBe("ir");
    s.selectStream(DRONE, 1);
    expect(useVideoStreamsStore.getState().activeStream(DRONE)?.id).toBe("eo");
  });

  it("selects by id and ignores an unknown id / out-of-range index", () => {
    const s = useVideoStreamsStore.getState();
    s.setStreams(DRONE, [concurrent("eo", 1), concurrent("ir", 2)]);
    s.selectStream(DRONE, "ir");
    expect(useVideoStreamsStore.getState().activeStream(DRONE)?.id).toBe("ir");
    s.selectStream(DRONE, "nope");
    s.selectStream(DRONE, 9);
    expect(useVideoStreamsStore.getState().activeStream(DRONE)?.id).toBe("ir");
  });

  it("cycles the active stream, wrapping both directions", () => {
    const s = useVideoStreamsStore.getState();
    s.setStreams(DRONE, [concurrent("a", 1), concurrent("b", 2), concurrent("c", 3)]);
    s.cycleStream(DRONE, 1);
    expect(useVideoStreamsStore.getState().activeStream(DRONE)?.id).toBe("b");
    s.cycleStream(DRONE, 1);
    s.cycleStream(DRONE, 1);
    expect(useVideoStreamsStore.getState().activeStream(DRONE)?.id).toBe("a"); // wrapped
    s.cycleStream(DRONE, -1);
    expect(useVideoStreamsStore.getState().activeStream(DRONE)?.id).toBe("c"); // wrapped back
  });

  it("never selects or cycles onto a known-dead leg", () => {
    const s = useVideoStreamsStore.getState();
    s.setStreams(DRONE, [
      concurrent("eo", 1, "eo"),
      { ...concurrent("ir", 2, "ir"), live: false },
      concurrent("zoom", 3),
    ]);
    s.selectStream(DRONE, 2);
    expect(useVideoStreamsStore.getState().activeStream(DRONE)?.id).toBe("eo");
    s.cycleStream(DRONE, 1);
    expect(useVideoStreamsStore.getState().activeStream(DRONE)?.id).toBe("zoom");
    s.cycleStream(DRONE, -1);
    expect(useVideoStreamsStore.getState().activeStream(DRONE)?.id).toBe("eo");
  });

  it("does not cycle a single-stream node", () => {
    const s = useVideoStreamsStore.getState();
    s.setStreams(DRONE, [concurrent("eo", 1)]);
    s.cycleStream(DRONE, 1);
    expect(useVideoStreamsStore.getState().activeStream(DRONE)?.id).toBe("eo");
  });

  it("preserves the active stream across a stream-list refresh when it survives", () => {
    const s = useVideoStreamsStore.getState();
    s.setStreams(DRONE, [concurrent("eo", 1), concurrent("ir", 2)]);
    s.selectStream(DRONE, "ir");
    s.setStreams(DRONE, [concurrent("eo", 1), concurrent("ir", 2), concurrent("wide", 3)]);
    expect(useVideoStreamsStore.getState().activeStream(DRONE)?.id).toBe("ir");
  });

  it("resets the active stream when the previously-active one disappears", () => {
    const s = useVideoStreamsStore.getState();
    s.setStreams(DRONE, [concurrent("eo", 1), concurrent("ir", 2)]);
    s.selectStream(DRONE, "ir");
    s.setStreams(DRONE, [concurrent("eo", 1), concurrent("wide", 2)]);
    expect(useVideoStreamsStore.getState().activeStream(DRONE)?.id).toBe("eo");
  });

  it("sets and clears PiP, dropping a PiP id that disappears", () => {
    const s = useVideoStreamsStore.getState();
    s.setStreams(DRONE, [concurrent("eo", 1), concurrent("ir", 2)]);
    s.setPip(DRONE, "ir");
    expect(useVideoStreamsStore.getState().pipStream(DRONE)?.id).toBe("ir");
    s.setStreams(DRONE, [concurrent("eo", 1), concurrent("wide", 2)]);
    expect(useVideoStreamsStore.getState().pipStream(DRONE)).toBeNull();
    s.setPip(DRONE, "wide");
    s.setPip(DRONE, null);
    expect(useVideoStreamsStore.getState().pipStream(DRONE)).toBeNull();
  });

  it("moves the PiP off a leg that becomes the main view (never duplicates)", () => {
    const s = useVideoStreamsStore.getState();
    s.setStreams(DRONE, [concurrent("eo", 1), concurrent("wide", 2), concurrent("ir", 3)]);
    s.setPip(DRONE, "ir");
    // Selecting the leg the PiP shows as the main view moves the PiP elsewhere.
    s.selectStream(DRONE, "ir");
    const st = useVideoStreamsStore.getState();
    expect(st.activeStream(DRONE)?.id).toBe("ir");
    expect(st.pipStream(DRONE)?.id).not.toBe("ir");
    expect(st.pipStream(DRONE)?.id).toBe("eo");
  });

  it("cycling onto the PiP leg also moves the PiP off it", () => {
    const s = useVideoStreamsStore.getState();
    s.setStreams(DRONE, [concurrent("eo", 1), concurrent("ir", 2)]);
    s.setPip(DRONE, "ir");
    // active is "eo"; cycle +1 → "ir", which the PiP shows → PiP moves to "eo".
    s.cycleStream(DRONE, 1);
    const st = useVideoStreamsStore.getState();
    expect(st.activeStream(DRONE)?.id).toBe("ir");
    expect(st.pipStream(DRONE)?.id).toBe("eo");
  });

  it("hides the PiP when the only other leg is not a PiP candidate", () => {
    const s = useVideoStreamsStore.getState();
    s.setStreams(DRONE, [
      { id: "dev0", index: 1, label: "dev0", kind: "switchable", devicePath: "/dev/video0" },
      concurrent("eo", 2),
    ]);
    // active defaults to the first (switchable) leg; PiP is on the concurrent one.
    s.setPip(DRONE, "eo");
    // Select the PiP leg as main; the only other leg is switchable (no PiP) →
    // the PiP hides rather than duplicating or showing a non-PiP leg.
    s.selectStream(DRONE, "eo");
    expect(useVideoStreamsStore.getState().activeStream(DRONE)?.id).toBe("eo");
    expect(useVideoStreamsStore.getState().pipStream(DRONE)).toBeNull();
  });

  it("tracks the optimistic switching flag", () => {
    const s = useVideoStreamsStore.getState();
    s.setSwitching(DRONE, true);
    expect(useVideoStreamsStore.getState().switchingByDrone[DRONE]).toBe(true);
    s.setSwitching(DRONE, false);
    expect(useVideoStreamsStore.getState().switchingByDrone[DRONE]).toBe(false);
  });

  it("clearForDevice drops just that drone", () => {
    const s = useVideoStreamsStore.getState();
    s.setStreams(DRONE, [concurrent("eo", 1), concurrent("ir", 2)]);
    s.setStreams("node:d2", [concurrent("eo", 1), concurrent("ir", 2)]);
    s.clearForDevice(DRONE);
    const st = useVideoStreamsStore.getState();
    expect(st.streamsForDrone(DRONE)).toEqual([]);
    expect(st.streamsForDrone("node:d2")).toHaveLength(2);
  });

  it("maps known roles to a localized label key", () => {
    expect(ROLE_LABEL_KEY.eo).toBe("roleEo");
    expect(ROLE_LABEL_KEY.ir).toBe("roleIr");
    expect(ROLE_LABEL_KEY.unknownRole).toBeUndefined();
  });
});
