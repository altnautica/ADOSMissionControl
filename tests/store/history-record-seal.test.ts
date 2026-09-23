/**
 * History-store lifecycle of a sealed flight record and of the demo dataset.
 *
 * A seal certifies what the flight was, so the bookkeeping the store and the
 * cloud sync do afterwards (the dirty flag, the sync flag, linked media, the
 * cloud round trip) must not turn it INVALID. And the demo reset that runs on
 * every Flight Logs visit in demo mode must only ever drop demo records.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { FlightRecord } from "@/lib/types";
import type { Doc } from "../../convex/_generated/dataModel";

const idb = vi.hoisted(() => ({ store: new Map<string, unknown>() }));

vi.mock("idb-keyval", () => ({
  get: vi.fn(async (key: string) => idb.store.get(key)),
  set: vi.fn(async (key: string, value: unknown) => {
    idb.store.set(key, value);
  }),
  del: vi.fn(async (key: string) => {
    idb.store.delete(key);
  }),
  keys: vi.fn(async () => Array.from(idb.store.keys())),
}));

import { useHistoryStore } from "@/stores/history-store";
import { signRecord, verifyRecord } from "@/lib/compliance/sign";
import { toCloudShape, fromCloudShape } from "@/components/history/cloud-sync-shape";

const HISTORY_KEY = "altcmd:flight-history";

function flight(id: string, overrides: Partial<FlightRecord> = {}): FlightRecord {
  const start = 1_760_000_000_000;
  return {
    id,
    droneId: "drone-1",
    droneName: "Alpha",
    // An importer that stamps `date` separately from `startTime`.
    date: start + 3,
    startTime: start,
    endTime: start + 600_000,
    duration: 600,
    distance: 900,
    maxAlt: 35,
    maxSpeed: 9,
    batteryUsed: 25,
    waypointCount: 3,
    status: "completed",
    updatedAt: start + 600_000,
    phases: [{ type: "cruise", startMs: 0, endMs: 1000, maxAlt: 30 }],
    windEstimate: { speedMs: 3, fromDirDeg: 270, sampleCount: 12, method: "vfr_diff" },
    ...overrides,
  };
}

/** The record as the store holds it now. */
function stored(id: string): FlightRecord {
  const r = useHistoryStore.getState().records.find((x) => x.id === id);
  if (!r) throw new Error(`record ${id} missing`);
  return r;
}

/** Rebuild every object with its keys in reverse order, as a storage round trip may. */
function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value === null || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value).reverse()) out[k] = reverseKeys(v);
  return out;
}

beforeEach(() => {
  idb.store.clear();
  useHistoryStore.setState({ records: [], pendingSyncIds: new Set(), _seeded: false });
});

describe("sealed flight record", () => {
  it("still verifies after the store marks it dirty and the sync marks it synced", async () => {
    useHistoryStore.setState({ records: [flight("f1", { cloudSynced: true })] });
    // As the detail panel signs: over the stored record, then patch it in.
    const patch = await signRecord(stored("f1"));
    useHistoryStore.getState().updateRecord("f1", patch);
    expect(await verifyRecord(stored("f1"))).toBe(true);
    useHistoryStore.getState().markSynced(["f1"]);
    expect(await verifyRecord(stored("f1"))).toBe(true);
  });

  it("still verifies after media evidence is linked to it", async () => {
    useHistoryStore.setState({ records: [flight("f1")] });
    useHistoryStore.getState().updateRecord("f1", await signRecord(stored("f1")));
    useHistoryStore.getState().updateRecord("f1", {
      media: [{ id: "m1", name: "a.jpg", type: "image/jpeg", size: 10, capturedAt: 1, blobKey: "media:f1:m1" }],
    });
    expect(await verifyRecord(stored("f1"))).toBe(true);
  });

  it("still verifies on another device after a cloud round trip", async () => {
    useHistoryStore.setState({ records: [flight("f1")] });
    useHistoryStore.getState().updateRecord("f1", await signRecord(stored("f1")));
    const row = reverseKeys({ ...toCloudShape(stored("f1")), _id: "x", _creationTime: 1, userId: "u" });
    const pulled = fromCloudShape(row as Doc<"cmd_flightLogs">);
    expect(await verifyRecord(pulled)).toBe(true);
  });

  it("fails to verify once the flight data itself changes", async () => {
    useHistoryStore.setState({ records: [flight("f1")] });
    useHistoryStore.getState().updateRecord("f1", await signRecord(stored("f1")));
    useHistoryStore.getState().updateRecord("f1", { maxAlt: 36 });
    expect(await verifyRecord(stored("f1"))).toBe(false);
  });
});

describe("demo reset", () => {
  it("drops demo records and keeps every real flight in storage and in memory", async () => {
    idb.store.set(HISTORY_KEY, [flight("live-1"), flight("demo-1"), flight("import-1")]);
    await useHistoryStore.getState().ensureLoaded();
    await useHistoryStore.getState().resetDemoData();

    const kept = (idb.store.get(HISTORY_KEY) as FlightRecord[]).map((r) => r.id).sort();
    expect(kept).toEqual(["import-1", "live-1"]);
    expect(useHistoryStore.getState().records.map((r) => r.id).sort()).toEqual(["import-1", "live-1"]);
  });
});
