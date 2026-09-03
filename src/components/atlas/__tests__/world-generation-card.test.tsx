/**
 * @license GPL-3.0-only
 *
 * The world-model generation card.
 *
 * Three assertions carry the honesty contract into the UI:
 *  - nothing received renders the ABSENT state, with copy that is not the empty
 *    state's copy (the producer publishes nothing for a generation with nothing
 *    readable, so silence means no world model);
 *  - a measured-zero generation renders the EMPTY state;
 *  - an unstated count renders the unknown marker and never the digit `0`.
 *
 * Messages are supplied inline rather than read from `locales/en.json`: the
 * new `atlas.world*` keys land through the localization lane, and this file
 * pins the card's own behaviour rather than the catalogue's state.
 */

import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

import { WorldGenerationCard } from "../WorldGenerationCard";
import { useAtlasWorldStore } from "@/stores/atlas-world-store";
import {
  PLUGIN_ATLAS_SPLAT_TOPIC,
  PLUGIN_ATLAS_OCCUPANCY_TOPIC,
} from "@/lib/atlas/world-contract";
import {
  encodeTestEvent,
  encodeTestMap,
  GOLDEN_EVENT_HEX,
  GOLDEN_OCCUPANCY_ESDF_HEX,
  hexBytes,
} from "@/lib/atlas/__tests__/golden-atlas-frames";

/** The card's own `atlas` strings: the new `world*` keys plus the three
 * already-present keys it reuses. Supplied inline rather than read from
 * `locales/en.json` so this file pins the card's behaviour rather than the
 * translation catalogue's state. */
const WORLD_MESSAGES = {
  // Reused from the existing catalogue (values copied verbatim from en.json).
  worldModelHeading: "World Model",
  worldModelEmpty:
    "No reconstruction yet. A captured session reconstructs on the compute node, then appears here.",
  worldModelNoNode:
    "No compute node paired. Pair a workstation on your network to reconstruct this drone's world model.",
  // New.
  worldGeneration: "Generation {generation}",
  worldSession: "Session",
  worldUnknown: "Unknown",
  worldNotProduced: "Not produced this generation",
  worldAbsentTitle: "No world model",
  worldEmptyTitle: "World model is empty",
  worldEmptyBody:
    "The newest generation reported a measured zero. The reconstruction ran and produced no geometry.",
  worldUnknownTitle: "Content not stated",
  worldUnknownBody:
    "The newest generation arrived without a readable count, so what it contains is unknown rather than empty.",
  worldSplat: "Splat",
  worldPointcloud: "Point cloud",
  worldMesh: "Mesh",
  worldOccupancy: "Occupancy",
  worldGaussians: "Gaussians",
  worldTrainingStep: "Training step",
  worldLodLevels: "LOD levels",
  worldPoints: "Points",
  worldExtent: "Extent",
  worldExtentUnmeasured: "Not measured",
  worldVertices: "Vertices",
  worldFaces: "Faces",
  worldField: "Field",
  worldFieldEsdf: "Signed distance (ESDF)",
  worldFieldOccupancy: "Occupancy probability",
  worldVoxels: "Voxels",
  worldVoxelSize: "Voxel size",
  worldTruncation: "Truncated at",
  worldPartialDescriptor: "Partial descriptor: {fields} not stated",
  worldStreamIdle: "Descriptor stream not subscribed.",
  worldStreamDemo: "The descriptor stream is not available in demo.",
  worldStreamBlockedOrigin:
    "A browser on an HTTPS origin cannot open the LAN descriptor stream. Use HTTP or the desktop app.",
  worldStreamConnecting: "Connecting to the descriptor stream\u2026",
  worldStreamConnected: "Descriptor stream connected.",
  worldStreamReconnecting: "Descriptor stream reconnecting\u2026",
  worldSuperseded: "{count} superseded descriptors dropped",
  worldVersionRejected:
    "{count} frames rejected: envelope version {version} is not spoken by this build",
  worldMalformed: "{count} unreadable frames",
};

const messages = { atlas: WORLD_MESSAGES };
const DRONE = "drone-1";

function renderCard() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <WorldGenerationCard droneDeviceId={DRONE} computeNodeDeviceId={null} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => useAtlasWorldStore.getState().clear());
afterEach(cleanup);

describe("no world model vs an empty world", () => {
  it("renders the ABSENT state, distinct from the empty state, when nothing arrived", () => {
    renderCard();
    expect(screen.getByTestId("world-presence").dataset.presence).toBe("absent");
    expect(screen.getByText(WORLD_MESSAGES.worldAbsentTitle)).toBeTruthy();
    expect(screen.queryByText(WORLD_MESSAGES.worldEmptyTitle)).toBeNull();
    // With no generation there is no artifact grid to read numbers off at all.
    expect(screen.queryByTestId("world-artifact-splat")).toBeNull();
    expect(screen.queryByTestId("world-generation")).toBeNull();
  });

  it("renders the EMPTY state, distinct from absent, for a measured-zero generation", () => {
    useAtlasWorldStore
      .getState()
      .applyFrame(
        DRONE,
        encodeTestEvent(
          PLUGIN_ATLAS_SPLAT_TOPIC,
          DRONE,
          encodeTestMap({
            session_id: "s-1",
            generation: 2,
            gaussian_count: 0,
            step: 500,
          }),
        ),
        1_000,
      );
    renderCard();
    expect(screen.getByTestId("world-presence").dataset.presence).toBe("empty");
    expect(screen.getByText(WORLD_MESSAGES.worldEmptyTitle)).toBeTruthy();
    expect(screen.queryByText(WORLD_MESSAGES.worldAbsentTitle)).toBeNull();
    expect(screen.getByTestId("world-generation").textContent).toBe(
      "Generation 2",
    );
  });

  it("renders CONTENT UNKNOWN, not empty, when no count was stated", () => {
    useAtlasWorldStore
      .getState()
      .applyFrame(
        DRONE,
        encodeTestEvent(
          PLUGIN_ATLAS_SPLAT_TOPIC,
          DRONE,
          encodeTestMap({ session_id: "s-1", generation: 1, step: 10 }),
        ),
        1_000,
      );
    renderCard();
    expect(screen.getByTestId("world-presence").dataset.presence).toBe(
      "unknown",
    );
    expect(screen.getByText(WORLD_MESSAGES.worldUnknownTitle)).toBeTruthy();
    expect(screen.queryByText(WORLD_MESSAGES.worldEmptyTitle)).toBeNull();
  });
});

describe("a missing count renders as unknown, never as zero", () => {
  it("shows the unknown marker for an unstated gaussian count", () => {
    useAtlasWorldStore
      .getState()
      .applyFrame(
        DRONE,
        encodeTestEvent(
          PLUGIN_ATLAS_SPLAT_TOPIC,
          DRONE,
          encodeTestMap({ session_id: "s-1", generation: 1, step: 10 }),
        ),
        1_000,
      );
    renderCard();
    const splat = within(screen.getByTestId("world-artifact-splat"));
    expect(splat.getByText(WORLD_MESSAGES.worldUnknown)).toBeTruthy();
    // No cell in the splat block reads `0`: a fabricated zero gaussian count is
    // the exact fact an operator would act on wrongly.
    expect(splat.queryByText("0")).toBeNull();
    expect(splat.getByText(/Partial descriptor/)).toBeTruthy();
  });

  it("shows a stated zero as zero, so a measured empty is still reported", () => {
    useAtlasWorldStore
      .getState()
      .applyFrame(
        DRONE,
        encodeTestEvent(
          PLUGIN_ATLAS_SPLAT_TOPIC,
          DRONE,
          encodeTestMap({
            session_id: "s-1",
            generation: 1,
            gaussian_count: 0,
            step: 10,
          }),
        ),
        1_000,
      );
    renderCard();
    const splat = within(screen.getByTestId("world-artifact-splat"));
    expect(splat.getByText("0")).toBeTruthy();
    expect(splat.queryByText(WORLD_MESSAGES.worldUnknown)).toBeNull();
    expect(splat.queryByText(/Partial descriptor/)).toBeNull();
  });
});

describe("artifact slots", () => {
  it("says a slot was not produced rather than showing it as empty", () => {
    useAtlasWorldStore
      .getState()
      .applyFrame(DRONE, hexBytes(GOLDEN_EVENT_HEX), 1_000);
    renderCard();
    expect(screen.getByTestId("world-presence").dataset.presence).toBe(
      "present",
    );
    expect(
      screen.getByTestId("world-artifact-splat").textContent,
    ).toContain("1,250,000");
    // The generation produced no mesh; that is stated, not shown as zeroes.
    const mesh = within(screen.getByTestId("world-artifact-mesh"));
    expect(mesh.getByText(WORLD_MESSAGES.worldNotProduced)).toBeTruthy();
    expect(mesh.queryByText("0")).toBeNull();
  });

  it("labels an ESDF grid as a signed-distance field with its truncation", () => {
    useAtlasWorldStore
      .getState()
      .applyFrame(
        DRONE,
        encodeTestEvent(
          PLUGIN_ATLAS_OCCUPANCY_TOPIC,
          DRONE,
          hexBytes(GOLDEN_OCCUPANCY_ESDF_HEX),
        ),
        1_000,
      );
    renderCard();
    const occ = screen.getByTestId("world-artifact-occupancy");
    expect(occ.textContent).toContain(WORLD_MESSAGES.worldFieldEsdf);
    expect(occ.textContent).toContain("2,592,000");
    expect(occ.textContent).toContain("0.20 m");
    expect(occ.textContent).toContain("4.0 m");
  });
});

describe("stream status and accounting", () => {
  it("reports the transport cause separately from the data state", () => {
    renderCard();
    // No compute node paired: a transport statement, and the data state is
    // still its own separate "no world model".
    expect(screen.getByTestId("world-stream-status").textContent).toBe(
      WORLD_MESSAGES.worldModelNoNode,
    );
    expect(screen.getByTestId("world-presence").dataset.presence).toBe("absent");
  });

  it("surfaces a refused envelope version instead of failing quietly", () => {
    useAtlasWorldStore
      .getState()
      .applyFrame(
        DRONE,
        encodeTestEvent(
          PLUGIN_ATLAS_SPLAT_TOPIC,
          DRONE,
          encodeTestMap({ gaussian_count: 1, step: 1 }),
          9,
        ),
        1_000,
      );
    renderCard();
    expect(
      screen.getByTestId("world-stream-accounting").textContent,
    ).toContain("envelope version 9");
    // A refused frame leaves the world model absent, not empty.
    expect(screen.getByTestId("world-presence").dataset.presence).toBe("absent");
  });

  it("shows no accounting list when nothing was dropped", () => {
    useAtlasWorldStore
      .getState()
      .applyFrame(DRONE, hexBytes(GOLDEN_EVENT_HEX), 1_000);
    renderCard();
    expect(screen.queryByTestId("world-stream-accounting")).toBeNull();
  });
});
