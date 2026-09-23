/**
 * Tests for useSafehomeStore and useGeozoneStore.
 *
 * Uses a minimal fake DroneProtocol that resolves with pre-set fixture data
 * so the tests run offline without a flight controller.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeEach, vi, type MockInstance } from "vitest";
import { useSafehomeStore, SAFEHOME_MAX } from "@/stores/safehome-store";
import { useGeozoneStore, GEOZONE_MAX, GEOZONE_VERTEX_MAX, GEOZONE_SHAPE, GEOZONE_TYPE } from "@/stores/geozone-store";
import type { DroneProtocol } from "@/lib/protocol/types";
import type { INavSafehome, INavGeozone, INavGeozoneVertex } from "@/lib/protocol/msp/msp-decoders-inav";

// ── Fake protocol helpers ─────────────────────────────────────

function makeFakeSafehomeProtocol(
  slots: INavSafehome[] = [],
  uploadResult = { success: true, resultCode: 0, message: "ok" },
): Partial<DroneProtocol> {
  return {
    downloadSafehomes: vi.fn().mockResolvedValue(slots),
    uploadSafehomes: vi.fn().mockResolvedValue(uploadResult),
  };
}

function makeFakeGeozoneProtocol(
  zones: INavGeozone[] = [],
  vertices: INavGeozoneVertex[] = [],
  uploadResult = { success: true, resultCode: 0, message: "ok" },
): Partial<DroneProtocol> {
  return {
    downloadGeozones: vi.fn().mockResolvedValue({ zones, vertices }),
    uploadGeozones: vi.fn().mockResolvedValue(uploadResult),
  };
}

function fakeSafehome(index: number, enabled = true): INavSafehome {
  return { index, enabled, lat: 12.97 + index * 0.01, lon: 77.59 + index * 0.01 };
}

function fakeZone(number: number): INavGeozone {
  return {
    number,
    type: GEOZONE_TYPE.EXCLUSIVE,
    shape: GEOZONE_SHAPE.POLYGON,
    minAlt: 0,
    maxAlt: 12000,
    fenceAction: 1,
    vertexCount: 0,
    isSeaLevelRef: false,
  };
}

function fakeVertex(geozoneId: number, vertexIdx: number): INavGeozoneVertex {
  return { geozoneId, vertexIdx, lat: 12.97 + vertexIdx * 0.001, lon: 77.59 + vertexIdx * 0.001 };
}

// ── Safehome store tests ──────────────────────────────────────

describe("useSafehomeStore", () => {
  beforeEach(() => {
    useSafehomeStore.getState().clear();
  });

  it("initialises with 16 disabled slots", () => {
    const { safehomes } = useSafehomeStore.getState();
    expect(safehomes).toHaveLength(SAFEHOME_MAX);
    expect(safehomes.every((sh) => !sh.enabled)).toBe(true);
  });

  it("setSlot updates the slot and marks dirty", () => {
    useSafehomeStore.getState().setSlot(3, { lat: 12.99, lon: 77.60, enabled: true });
    const { safehomes, dirty } = useSafehomeStore.getState();
    expect(safehomes[3].lat).toBe(12.99);
    expect(safehomes[3].enabled).toBe(true);
    expect(dirty).toBe(true);
  });

  it("toggleEnabled flips the enabled flag", () => {
    useSafehomeStore.getState().toggleEnabled(0);
    expect(useSafehomeStore.getState().safehomes[0].enabled).toBe(true);
    useSafehomeStore.getState().toggleEnabled(0);
    expect(useSafehomeStore.getState().safehomes[0].enabled).toBe(false);
  });

  it("setActiveIndex sets and clears the active index", () => {
    useSafehomeStore.getState().setActiveIndex(5);
    expect(useSafehomeStore.getState().activeIndex).toBe(5);
    useSafehomeStore.getState().setActiveIndex(null);
    expect(useSafehomeStore.getState().activeIndex).toBeNull();
  });

  it("loadFromFc populates slots from protocol", async () => {
    const slots = [fakeSafehome(0), fakeSafehome(1, false)];
    const proto = makeFakeSafehomeProtocol(slots);
    await useSafehomeStore.getState().loadFromFc(proto as DroneProtocol);
    const { safehomes, dirty } = useSafehomeStore.getState();
    expect(safehomes[0].lat).toBeCloseTo(12.97, 4);
    expect(safehomes[1].enabled).toBe(false);
    expect(dirty).toBe(false);
  });

  it("loadFromFc sets error if downloadSafehomes is missing", async () => {
    const proto = {} as DroneProtocol;
    await useSafehomeStore.getState().loadFromFc(proto);
    expect(useSafehomeStore.getState().error).toBeTruthy();
  });

  it("uploadToFc calls protocol and clears dirty on success", async () => {
    useSafehomeStore.getState().setSlot(0, { lat: 1, lon: 2 });
    const proto = makeFakeSafehomeProtocol();
    await useSafehomeStore.getState().uploadToFc(proto as DroneProtocol);
    const { dirty, error } = useSafehomeStore.getState();
    expect(dirty).toBe(false);
    expect(error).toBeNull();
    expect(proto.uploadSafehomes).toHaveBeenCalledOnce();
  });

  it("uploadToFc sets error on protocol failure", async () => {
    const proto = makeFakeSafehomeProtocol(
      [],
      { success: false, resultCode: -1, message: "FC rejected" },
    );
    await useSafehomeStore.getState().uploadToFc(proto as DroneProtocol);
    expect(useSafehomeStore.getState().error).toBe("FC rejected");
  });

  it("clear resets state to defaults", () => {
    useSafehomeStore.getState().setSlot(2, { lat: 10, lon: 20, enabled: true });
    useSafehomeStore.getState().clear();
    const { safehomes, dirty, error, activeIndex } = useSafehomeStore.getState();
    expect(safehomes.every((sh) => !sh.enabled)).toBe(true);
    expect(dirty).toBe(false);
    expect(error).toBeNull();
    expect(activeIndex).toBeNull();
  });
});

// ── Geozone store tests ───────────────────────────────────────

describe("useGeozoneStore", () => {
  beforeEach(() => {
    useGeozoneStore.getState().clear();
  });

  it("initialises with empty zones", () => {
    expect(useGeozoneStore.getState().zones).toHaveLength(0);
  });

  it("addZone creates a zone with auto-incremented id", () => {
    useGeozoneStore.getState().addZone();
    useGeozoneStore.getState().addZone();
    const { zones } = useGeozoneStore.getState();
    expect(zones).toHaveLength(2);
    expect(zones[0].number).toBe(0);
    expect(zones[1].number).toBe(1);
  });

  it("addZone respects partial overrides", () => {
    useGeozoneStore.getState().addZone({ type: GEOZONE_TYPE.INCLUSIVE, maxAlt: 5000 });
    const zone = useGeozoneStore.getState().zones[0];
    expect(zone.type).toBe(GEOZONE_TYPE.INCLUSIVE);
    expect(zone.maxAlt).toBe(5000);
  });

  it("addZone refuses when at GEOZONE_MAX", () => {
    for (let i = 0; i < GEOZONE_MAX; i++) useGeozoneStore.getState().addZone();
    useGeozoneStore.getState().addZone(); // one too many
    expect(useGeozoneStore.getState().zones).toHaveLength(GEOZONE_MAX);
    expect(useGeozoneStore.getState().error).toBeTruthy();
  });

  it("removeZone removes the zone and its vertices", () => {
    useGeozoneStore.getState().addZone();
    const id = useGeozoneStore.getState().zones[0].number;
    useGeozoneStore.getState().addVertex(id, { lat: 1, lon: 2 });
    useGeozoneStore.getState().removeZone(id);
    expect(useGeozoneStore.getState().zones).toHaveLength(0);
    expect(useGeozoneStore.getState().vertices.get(id)).toBeUndefined();
  });

  it("removeZone clears activeId when matching", () => {
    useGeozoneStore.getState().addZone();
    const id = useGeozoneStore.getState().zones[0].number;
    useGeozoneStore.getState().setActiveId(id);
    useGeozoneStore.getState().removeZone(id);
    expect(useGeozoneStore.getState().activeId).toBeNull();
  });

  it("updateZone patches only the given fields", () => {
    useGeozoneStore.getState().addZone();
    const id = useGeozoneStore.getState().zones[0].number;
    useGeozoneStore.getState().updateZone(id, { maxAlt: 9000 });
    const zone = useGeozoneStore.getState().zones.find((z) => z.number === id)!;
    expect(zone.maxAlt).toBe(9000);
    expect(zone.minAlt).toBe(0); // unchanged
  });

  it("addVertex appends and updates vertexCount", () => {
    useGeozoneStore.getState().addZone();
    const id = useGeozoneStore.getState().zones[0].number;
    useGeozoneStore.getState().addVertex(id, { lat: 1, lon: 2 });
    useGeozoneStore.getState().addVertex(id, { lat: 3, lon: 4 });
    const verts = useGeozoneStore.getState().vertices.get(id)!;
    expect(verts).toHaveLength(2);
    expect(verts[0].vertexIdx).toBe(0);
    expect(verts[1].vertexIdx).toBe(1);
    const zone = useGeozoneStore.getState().zones.find((z) => z.number === id)!;
    expect(zone.vertexCount).toBe(2);
  });

  it("addVertex refuses when at GEOZONE_VERTEX_MAX", () => {
    useGeozoneStore.getState().addZone();
    const id = useGeozoneStore.getState().zones[0].number;
    for (let i = 0; i < GEOZONE_VERTEX_MAX; i++) {
      useGeozoneStore.getState().addVertex(id, { lat: i, lon: i });
    }
    useGeozoneStore.getState().addVertex(id, { lat: 99, lon: 99 });
    expect(useGeozoneStore.getState().vertices.get(id)!).toHaveLength(GEOZONE_VERTEX_MAX);
    expect(useGeozoneStore.getState().error).toBeTruthy();
  });

  it("removeVertex re-indexes remaining vertices", () => {
    useGeozoneStore.getState().addZone();
    const id = useGeozoneStore.getState().zones[0].number;
    for (let i = 0; i < 3; i++) {
      useGeozoneStore.getState().addVertex(id, { lat: i, lon: i });
    }
    useGeozoneStore.getState().removeVertex(id, 1); // remove middle
    const verts = useGeozoneStore.getState().vertices.get(id)!;
    expect(verts).toHaveLength(2);
    expect(verts.map((v) => v.vertexIdx)).toEqual([0, 1]);
  });

  it("updateVertex updates lat/lon by index", () => {
    useGeozoneStore.getState().addZone();
    const id = useGeozoneStore.getState().zones[0].number;
    useGeozoneStore.getState().addVertex(id, { lat: 0, lon: 0 });
    useGeozoneStore.getState().updateVertex(id, 0, 12.97, 77.59);
    const vert = useGeozoneStore.getState().vertices.get(id)![0];
    expect(vert.lat).toBe(12.97);
    expect(vert.lon).toBe(77.59);
  });

  it("loadFromFc populates zones and vertices", async () => {
    const zone = fakeZone(0);
    const vert0 = fakeVertex(0, 0);
    const vert1 = fakeVertex(0, 1);
    const proto = makeFakeGeozoneProtocol([zone], [vert0, vert1]);
    await useGeozoneStore.getState().loadFromFc(proto as DroneProtocol);
    const state = useGeozoneStore.getState();
    expect(state.zones).toHaveLength(1);
    const verts = state.vertices.get(0)!;
    expect(verts).toHaveLength(2);
    expect(state.dirty).toBe(false);
  });

  it("loadFromFc sets error if downloadGeozones is missing", async () => {
    const proto = {} as DroneProtocol;
    await useGeozoneStore.getState().loadFromFc(proto);
    expect(useGeozoneStore.getState().error).toBeTruthy();
  });

  it("uploadToFc calls protocol with all vertices and clears dirty", async () => {
    useGeozoneStore.getState().addZone();
    const id = useGeozoneStore.getState().zones[0].number;
    useGeozoneStore.getState().addVertex(id, { lat: 1, lon: 2 });
    useGeozoneStore.getState().addVertex(id, { lat: 3, lon: 4 });
    useGeozoneStore.getState().addVertex(id, { lat: 5, lon: 6 });
    const proto = makeFakeGeozoneProtocol();
    await useGeozoneStore.getState().uploadToFc(proto as DroneProtocol);
    expect(proto.uploadGeozones).toHaveBeenCalledOnce();
    const [, calledVerts] = (proto.uploadGeozones as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(calledVerts).toHaveLength(3);
    expect(useGeozoneStore.getState().dirty).toBe(false);
  });

  it("uploadToFc sets error on protocol failure", async () => {
    const proto = makeFakeGeozoneProtocol(
      [],
      [],
      { success: false, resultCode: -1, message: "Upload failed" },
    );
    await useGeozoneStore.getState().uploadToFc(proto as DroneProtocol);
    expect(useGeozoneStore.getState().error).toBe("Upload failed");
  });

  it("uploads a circle as its centre vertex with radius and two FC vertex slots", async () => {
    useGeozoneStore.getState().addZone({ shape: GEOZONE_SHAPE.CIRCULAR });
    const id = useGeozoneStore.getState().zones[0].number;
    const proto = makeFakeGeozoneProtocol();

    await useGeozoneStore.getState().uploadToFc(proto as DroneProtocol);
    expect(proto.uploadGeozones).not.toHaveBeenCalled();
    expect(useGeozoneStore.getState().error).toMatch(/radius/);

    useGeozoneStore.getState().setCircle(id, 12.5, 77.5, 15000);
    await useGeozoneStore.getState().uploadToFc(proto as DroneProtocol);
    const [zones, verts] = (proto.uploadGeozones as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(zones[0].vertexCount).toBe(2);
    expect(verts).toEqual([{ geozoneId: id, vertexIdx: 0, lat: 12.5, lon: 77.5, radius: 15000 }]);
  });

  it("changing a zone's shape discards geometry of the other shape", () => {
    useGeozoneStore.getState().addZone();
    const id = useGeozoneStore.getState().zones[0].number;
    for (let i = 0; i < 3; i++) useGeozoneStore.getState().addVertex(id, { lat: i, lon: i });
    useGeozoneStore.getState().updateZone(id, { shape: GEOZONE_SHAPE.CIRCULAR });
    expect(useGeozoneStore.getState().vertices.get(id)).toBeUndefined();
    expect(useGeozoneStore.getState().zones[0].vertexCount).toBe(0);
  });

  it("clear resets state to defaults", () => {
    useGeozoneStore.getState().addZone();
    useGeozoneStore.getState().clear();
    const { zones, vertices, dirty, error, activeId } = useGeozoneStore.getState();
    expect(zones).toHaveLength(0);
    expect(vertices.size).toBe(0);
    expect(dirty).toBe(false);
    expect(error).toBeNull();
    expect(activeId).toBeNull();
  });
});

// ── Boundary tests ────────────────────────────────────────────

describe("useSafehomeStore - slot 15 boundary", () => {
  beforeEach(() => {
    useSafehomeStore.getState().clear();
  });

  it("setSlot(15) stores data at the last slot", () => {
    useSafehomeStore.getState().setSlot(15, { lat: 13.01, lon: 77.70, enabled: true });
    const sh = useSafehomeStore.getState().safehomes[15];
    expect(sh.lat).toBeCloseTo(13.01, 4);
    expect(sh.lon).toBeCloseTo(77.70, 4);
    expect(sh.enabled).toBe(true);
  });

  it("upload then download preserves slot 15 data", async () => {
    useSafehomeStore.getState().setSlot(15, { lat: 13.01, lon: 77.70, enabled: true });
    const uploadProto = makeFakeSafehomeProtocol();
    await useSafehomeStore.getState().uploadToFc(uploadProto as DroneProtocol);
    expect(uploadProto.uploadSafehomes).toHaveBeenCalledOnce();

    const capturedSlots = (uploadProto.uploadSafehomes as ReturnType<typeof vi.fn>).mock.calls[0][0] as INavSafehome[];
    const downloadProto = makeFakeSafehomeProtocol(capturedSlots);
    await useSafehomeStore.getState().loadFromFc(downloadProto as DroneProtocol);
    expect(useSafehomeStore.getState().safehomes[15].lat).toBeCloseTo(13.01, 4);
  });
});

describe("useGeozoneStore - 10-vertex polygon boundary", () => {
  beforeEach(() => {
    useGeozoneStore.getState().clear();
  });

  it("accepts exactly 10 vertices for a polygon zone", async () => {
    useGeozoneStore.getState().addZone({ shape: GEOZONE_SHAPE.POLYGON });
    const id = useGeozoneStore.getState().zones[0].number;
    for (let i = 0; i < 10; i++) {
      useGeozoneStore.getState().addVertex(id, { lat: i * 0.01, lon: i * 0.01 });
    }
    expect(useGeozoneStore.getState().vertices.get(id)).toHaveLength(10);
    expect(useGeozoneStore.getState().error).toBeNull();

    const proto = makeFakeGeozoneProtocol();
    await useGeozoneStore.getState().uploadToFc(proto as DroneProtocol);
    expect(proto.uploadGeozones).toHaveBeenCalledOnce();
  });

  it("rejects an 11th vertex with an error", () => {
    useGeozoneStore.getState().addZone({ shape: GEOZONE_SHAPE.POLYGON });
    const id = useGeozoneStore.getState().zones[0].number;
    for (let i = 0; i < 10; i++) {
      useGeozoneStore.getState().addVertex(id, { lat: i * 0.01, lon: i * 0.01 });
    }
    useGeozoneStore.getState().clear();
    // error was set on the rejected 11th attempt in a fresh addVertex test
    // verify the store itself enforces the limit
    useGeozoneStore.getState().addZone({ shape: GEOZONE_SHAPE.POLYGON });
    const id2 = useGeozoneStore.getState().zones[0].number;
    for (let i = 0; i < 10; i++) {
      useGeozoneStore.getState().addVertex(id2, { lat: i * 0.01, lon: i * 0.01 });
    }
    useGeozoneStore.getState().addVertex(id2, { lat: 99, lon: 99 });
    expect(useGeozoneStore.getState().vertices.get(id2)).toHaveLength(10);
    expect(useGeozoneStore.getState().error).toBeTruthy();
  });
});

describe("useSafehomeStore - concurrent loadFromFc guard", () => {
  beforeEach(() => {
    useSafehomeStore.getState().clear();
  });

  it("second concurrent loadFromFc returns early without double-calling download", async () => {
    let resolveFirst!: () => void;
    const firstCall = new Promise<INavSafehome[]>((resolve) => {
      resolveFirst = () => resolve([]);
    });

    const downloadFn = vi.fn()
      .mockReturnValueOnce(firstCall)
      .mockResolvedValue([]);

    const proto = { downloadSafehomes: downloadFn } as unknown as DroneProtocol;

    const p1 = useSafehomeStore.getState().loadFromFc(proto);
    const p2 = useSafehomeStore.getState().loadFromFc(proto);

    resolveFirst();
    await Promise.all([p1, p2]);

    expect(downloadFn).toHaveBeenCalledTimes(1);
  });
});
