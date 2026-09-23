/**
 * The IndexedDB-backed local record stores write their whole in-memory value
 * on every persist. These tests pin the guarantee that a write issued before
 * the stored value has been read never replaces the records on disk: the
 * write waits for the load, and the load merges the stored value first.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { FlightRecord } from "@/lib/types";
import type { AircraftRecord, OperatorProfile } from "@/lib/types/operator";

const idb = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  /** When set, the next `get` waits on this promise before reading. */
  gate: null as Promise<void> | null,
  /** When > 0, `get` rejects and decrements. */
  failReads: 0,
}));

vi.mock("idb-keyval", () => ({
  get: vi.fn(async (key: string) => {
    if (idb.failReads > 0) {
      idb.failReads -= 1;
      throw new Error("read failed");
    }
    if (idb.gate) await idb.gate;
    return idb.store.get(key);
  }),
  set: vi.fn(async (key: string, value: unknown) => {
    idb.store.set(key, value);
  }),
  del: vi.fn(async (key: string) => {
    idb.store.delete(key);
  }),
  keys: vi.fn(async () => Array.from(idb.store.keys())),
}));

const HISTORY_KEY = "altcmd:flight-history";
const AIRCRAFT_KEY = "altcmd:aircraft-registry";
const OPERATOR_KEY = "altcmd:operator-profile";

function flight(id: string, startTime: number): FlightRecord {
  return {
    id,
    droneId: "drone-1",
    droneName: "Alpha",
    date: startTime,
    startTime,
    endTime: startTime,
    duration: 0,
    distance: 0,
    maxAlt: 0,
    maxSpeed: 0,
    batteryUsed: 0,
    waypointCount: 0,
    status: "completed",
    updatedAt: startTime,
  };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => {};
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Let every queued microtask and mocked IDB call settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

beforeEach(() => {
  idb.store.clear();
  idb.gate = null;
  idb.failReads = 0;
  // The stores keep their load state at module level, so each test resets the
  // module registry and imports the store under test dynamically to start
  // from an unloaded store.
  vi.resetModules();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("history store", () => {
  it("keeps stored flights when a new flight is persisted while the load is in flight", async () => {
    const stored = [flight("stored-1", 1_000), flight("stored-2", 2_000)];
    idb.store.set(HISTORY_KEY, stored);
    const read = deferred();
    idb.gate = read.promise;

    const { useHistoryStore } = await import("@/stores/history-store");
    const loading = useHistoryStore.getState().ensureLoaded();

    // Arm path: a draft is added and persisted before the read returns.
    const history = useHistoryStore.getState();
    history.addRecord(flight("draft", 3_000));
    const persisting = history.persistToIDB();

    read.resolve();
    await Promise.all([loading, persisting]);

    const written = idb.store.get(HISTORY_KEY) as FlightRecord[];
    expect(written.map((r) => r.id).sort()).toEqual(["draft", "stored-1", "stored-2"]);
    expect(useHistoryStore.getState().records.map((r) => r.id)).toEqual([
      "draft",
      "stored-2",
      "stored-1",
    ]);
  });

  it("does not write while the stored history cannot be read, and retries the read on the next write", async () => {
    idb.store.set(HISTORY_KEY, [flight("stored-1", 1_000)]);
    idb.failReads = 1;

    const { useHistoryStore } = await import("@/stores/history-store");
    useHistoryStore.getState().addRecord(flight("draft", 3_000));
    await useHistoryStore.getState().persistToIDB();

    expect((idb.store.get(HISTORY_KEY) as FlightRecord[]).map((r) => r.id)).toEqual(["stored-1"]);

    await useHistoryStore.getState().persistToIDB();
    expect((idb.store.get(HISTORY_KEY) as FlightRecord[]).map((r) => r.id).sort()).toEqual([
      "draft",
      "stored-1",
    ]);
  });
});

describe("aircraft registry store", () => {
  it("keeps the stored aircraft record when an unloaded registry seeds the same drone on arm", async () => {
    const stored: Record<string, AircraftRecord> = {
      "drone-1": {
        id: "drone-1",
        name: "Alpha",
        vehicleType: "copter",
        registrationNumber: "REG-001",
        totalFlightHours: 12.5,
        totalFlights: 40,
      },
      "drone-2": { id: "drone-2", name: "Bravo", vehicleType: "plane", totalFlightHours: 3, totalFlights: 9 },
    };
    idb.store.set(AIRCRAFT_KEY, stored);

    const { useAircraftRegistryStore } = await import("@/stores/aircraft-registry-store");
    useAircraftRegistryStore.getState().getOrCreate("drone-1", "Alpha");
    useAircraftRegistryStore.getState().getOrCreate("drone-3", "Charlie");
    await settle();

    const written = idb.store.get(AIRCRAFT_KEY) as Record<string, AircraftRecord>;
    expect(written["drone-1"]).toEqual(stored["drone-1"]);
    expect(written["drone-2"]).toEqual(stored["drone-2"]);
    expect(written["drone-3"]?.totalFlights).toBe(0);
  });
});

describe("operator profile store", () => {
  it("keeps stored pilot fields when a patch is persisted before the load", async () => {
    const stored: OperatorProfile = {
      units: "imperial",
      pilotFirstName: "Sam",
      pilotLicenseNumber: "LIC-42",
    };
    idb.store.set(OPERATOR_KEY, stored);
    const { useOperatorProfileStore } = await import("@/stores/operator-profile-store");
    useOperatorProfileStore.getState().updateProfile({ operatorName: "Example Aerial" });
    await settle();

    const written = idb.store.get(OPERATOR_KEY) as OperatorProfile;
    expect(written.pilotFirstName).toBe("Sam");
    expect(written.pilotLicenseNumber).toBe("LIC-42");
    expect(written.units).toBe("imperial");
    expect(written.operatorName).toBe("Example Aerial");
  });
});
