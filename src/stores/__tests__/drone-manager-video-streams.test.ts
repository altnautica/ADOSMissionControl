/**
 * @license GPL-3.0-only
 *
 * Regression guard: switching drones must reset the leaving drone's stream
 * switcher state. The global video-store override is cleared on selection
 * (clearForSelection), but the per-drone video-streams-store is keyed by drone
 * id, so without an explicit reset a return to a drone showed a stale leg as
 * the active tab while the video fell back to the default URL.
 */

import { describe, it, expect, beforeEach } from "vitest";

import { useDroneManager } from "../drone-manager";
import {
  useVideoStreamsStore,
  type StreamDescriptor,
} from "@/stores/video-streams-store";

function concurrent(id: string, index: number): StreamDescriptor {
  return {
    id,
    index,
    label: id,
    kind: "concurrent",
    address: { whepPath: `${id}/whep`, whepUrl: `http://host:8889/${id}/whep` },
  };
}

describe("drone-manager selectDrone → video-streams reset", () => {
  beforeEach(() => {
    useVideoStreamsStore.getState().clear();
    useDroneManager.setState({ selectedDroneId: null });
  });

  it("clears the leaving drone's active stream + PiP on a drone switch", () => {
    const s = useVideoStreamsStore.getState();
    s.setStreams("A", [concurrent("main", 1), concurrent("ir", 2)]);
    s.selectStream("A", "ir");
    s.setPip("A", "main");
    expect(useVideoStreamsStore.getState().activeStream("A")?.id).toBe("ir");

    useDroneManager.setState({ selectedDroneId: "A" });
    useDroneManager.getState().selectDrone("B");

    // The leaving drone's switcher state is gone; a return re-populates fresh.
    expect(useVideoStreamsStore.getState().streamsForDrone("A")).toEqual([]);
    expect(
      "A" in useVideoStreamsStore.getState().activeStreamIdByDrone,
    ).toBe(false);
    expect(useVideoStreamsStore.getState().pipStream("A")).toBeNull();
  });

  it("does nothing when re-selecting the same drone", () => {
    const s = useVideoStreamsStore.getState();
    s.setStreams("A", [concurrent("main", 1), concurrent("ir", 2)]);
    s.selectStream("A", "ir");

    useDroneManager.setState({ selectedDroneId: "A" });
    useDroneManager.getState().selectDrone("A");

    expect(useVideoStreamsStore.getState().activeStream("A")?.id).toBe("ir");
  });
});
