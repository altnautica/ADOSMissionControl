import { act, cleanup, fireEvent, render as rtlRender, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { specString } from "@/lib/cockpit/spec-strings";
import messages from "../../../../locales/en.json";
import { WhatsLockedChip } from "@/components/vision/WhatsLockedChip";
import { parseFollowState } from "@/lib/hud/nav-types";
import { useNavStreamStore } from "@/stores/nav-stream-store";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import { useSelectedTargetStore } from "@/stores/selected-target-store";
import {
  streamKey,
  useVisionDetectionsStore,
  type VisionDetectionBatch,
} from "@/stores/vision-detections-store";

const DRONE = "node:d1";

function render(node: ReactElement) {
  return rtlRender(
    <NextIntlClientProvider locale="en" messages={messages}>
      {node}
    </NextIntlClientProvider>,
  );
}

function setFollow(raw: Record<string, unknown>, ageMs = 0) {
  act(() => {
    useNavStreamStore.getState().setFollow(DRONE, parseFollowState(raw)!, Date.now() - ageMs);
  });
}

function batch(
  cameraId: string,
  trackId: number,
  lockState: "locked" | "uncertain" | "lost",
  ageMs = 0,
): VisionDetectionBatch {
  return {
    modelId: "m",
    cameraId,
    frameId: 1,
    tsMs: 1,
    frameWidth: 1280,
    frameHeight: 720,
    receivedAt: Date.now() - ageMs,
    detections: [
      {
        bbox: { x: 0, y: 0, width: 10, height: 10 },
        classLabel: "person",
        confidence: 0.8,
        trackId,
        lockState,
      },
    ],
  };
}

function seedStreams(...batches: VisionDetectionBatch[]) {
  const streams: Record<string, VisionDetectionBatch> = {};
  for (const b of batches) streams[streamKey(b.modelId, b.cameraId)] = b;
  useVisionDetectionsStore.setState({
    batches: { [DRONE]: batches[batches.length - 1] },
    streams: { [DRONE]: streams },
  });
}

function seedBatch(trackId: number, lockState: "locked" | "uncertain" | "lost", ageMs = 0) {
  seedStreams(batch("uvc-0", trackId, lockState, ageMs));
}

function designateTrack7(classLabel = "person", droneId = DRONE) {
  useSelectedTargetStore.setState({
    designated: {
      droneId,
      cameraId: "uvc-0",
      trackId: 7,
      bbox: { x: 0, y: 0, width: 10, height: 10 },
      classLabel,
      confidence: 0.87,
    },
  });
}

describe("WhatsLockedChip", () => {
  beforeEach(() => {
    useSelectedTargetStore.getState().reset();
    useVisionDetectionsStore.getState().clear();
    useNavStreamStore.getState().clear(DRONE);
    useAgentCapabilitiesStore.setState({
      perceptionTier: undefined,
      perceptionOffloadTarget: undefined,
    });
  });
  afterEach(cleanup);

  it("renders nothing when no target is designated", () => {
    const { container } = render(<WhatsLockedChip droneId={DRONE} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when the designation is for another drone", () => {
    designateTrack7("person", "node:other");
    const { container } = render(<WhatsLockedChip droneId={DRONE} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the class, track id and LIVE lock state for the designated target", () => {
    seedBatch(7, "locked");
    designateTrack7();
    render(<WhatsLockedChip droneId={DRONE} />);
    expect(screen.getByText(specString("lock.who", { label: "PERSON", id: 7 }))).toBeTruthy();
    expect(screen.getByText(specString("lock.locked"))).toBeTruthy();
    // Confidence comes from the LIVE detection (0.8), not the click-time copy.
    expect(screen.getByText("80%")).toBeTruthy();
  });

  it("reflects a changed live lock state (uncertain)", () => {
    seedBatch(7, "uncertain");
    designateTrack7("car");
    render(<WhatsLockedChip droneId={DRONE} />);
    expect(screen.getByText(specString("lock.uncertain"))).toBeTruthy();
  });

  it("shows the tracker's Lost state while the feed is still FRESH", () => {
    seedBatch(7, "lost", 0);
    designateTrack7();
    render(<WhatsLockedChip droneId={DRONE} />);
    expect(screen.getByText("Lost")).toBeTruthy();
  });

  it("says 'Not in view' with no confidence when a fresh feed lacks the track", () => {
    seedBatch(3, "locked", 0);
    designateTrack7();
    render(<WhatsLockedChip droneId={DRONE} />);
    expect(screen.getByText(specString("lock.not_in_view"))).toBeTruthy();
    expect(screen.getByText("—")).toBeTruthy();
    expect(screen.queryByText("87%")).toBeNull();
  });

  it("reads the designated camera's stream, not the newest batch of another camera", () => {
    // cam uvc-0 no longer sees track 7; uvc-1 has its own, unrelated track 7.
    seedStreams(batch("uvc-0", 3, "locked", 100), batch("uvc-1", 7, "locked"));
    designateTrack7();
    render(<WhatsLockedChip droneId={DRONE} />);
    expect(screen.getByText(specString("lock.not_in_view"))).toBeTruthy();
    expect(screen.queryByText("Locked")).toBeNull();
  });

  it("shows 'Perception feed stale' (not a tracker Lost) when a live feed went stale", () => {
    seedBatch(7, "locked", 5000);
    designateTrack7();
    render(<WhatsLockedChip droneId={DRONE} />);
    expect(screen.getByText("Perception feed stale")).toBeTruthy();
    expect(screen.queryByText("Locked")).toBeNull();
  });

  it("shows 'Offload link lost' when a stale feed was running on the offload tier", () => {
    useAgentCapabilitiesStore.setState({ perceptionTier: "offload" });
    seedBatch(7, "locked", 5000);
    designateTrack7();
    render(<WhatsLockedChip droneId={DRONE} />);
    expect(screen.getByText("Offload link lost")).toBeTruthy();
  });

  it("releases the designation from the chip", () => {
    seedBatch(7, "locked");
    designateTrack7();
    render(<WhatsLockedChip droneId={DRONE} />);
    fireEvent.click(screen.getByRole("button", { name: "Release target" }));
    expect(useSelectedTargetStore.getState().designated).toBeNull();
  });

  it("reads the fresh follow-me phase before the lock words", () => {
    seedBatch(7, "locked");
    designateTrack7();
    setFollow({ phase: "following", track_id: 7 });
    render(<WhatsLockedChip droneId={DRONE} />);
    expect(screen.getByText("Following")).toBeTruthy();
    expect(screen.queryByText("Locked")).toBeNull();
  });

  it("words coasting and holding phases with their detail", () => {
    seedBatch(7, "locked");
    designateTrack7();
    setFollow({ phase: "coasting", track_id: 7, coast_remaining_s: 1.43 });
    const { unmount } = render(<WhatsLockedChip droneId={DRONE} />);
    expect(screen.getByText(specString("lock.coasting", { s: "1.4" }))).toBeTruthy();
    unmount();
    setFollow({ phase: "holding", track_id: 7, hold_reason: "HOLD_NO_RANGE" });
    render(<WhatsLockedChip droneId={DRONE} />);
    expect(screen.getByText(specString("lock.holding", { label: "No range" }))).toBeTruthy();
  });

  it("ignores a stale follow state", () => {
    seedBatch(7, "locked");
    designateTrack7();
    setFollow({ phase: "following", track_id: 7 }, 2500);
    render(<WhatsLockedChip droneId={DRONE} />);
    expect(screen.getByText(specString("lock.locked"))).toBeTruthy();
  });

  it("reads Re-acquired with the similarity for 4 s after the event", () => {
    seedBatch(7, "locked");
    designateTrack7();
    act(() => {
      useNavStreamStore
        .getState()
        .pushFollowEvent(DRONE, { topic: "follow.reacquired", trackId: 7, similarity: 0.862, gapS: 1.8 });
    });
    render(<WhatsLockedChip droneId={DRONE} />);
    expect(screen.getByText(specString("lock.reacquired", { sim: "0.86" }))).toBeTruthy();
  });

  it("keeps the stale-feed reason above every follow word", () => {
    seedBatch(7, "locked", 5000);
    designateTrack7();
    setFollow({ phase: "following", track_id: 7 });
    render(<WhatsLockedChip droneId={DRONE} />);
    expect(screen.getByText("Perception feed stale")).toBeTruthy();
  });
});
