/**
 * Cloud sync of the flight history: permanent deletes, refused records,
 * demo mode, the toolbar badge and re-imports.
 *
 * - A flight deleted for good is removed from the cloud and is never merged
 *   back from a cloud page, including after a reload.
 * - One record the cloud refuses does not stop the others from syncing, and
 *   it is not retried until it changes.
 * - Demo mode syncs nothing, and demo seed records never go up.
 * - The badge never claims "Synced" before a push has succeeded, nor while
 *   records are still waiting.
 * - Importing a flight that history already holds leaves the stored one alone.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, waitFor, cleanup, screen } from "@testing-library/react";
import { renderWithIntl } from "../helpers/intl-wrapper";
import type { FlightRecord } from "@/lib/types";

const idb = vi.hoisted(() => ({ store: new Map<string, unknown>() }));
const convex = vi.hoisted(() => ({
  upsert: vi.fn<(args: { record: { clientId: string } }) => Promise<unknown>>(),
  remove: vi.fn<(args: { clientId: string }) => Promise<unknown>>(),
}));

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

vi.mock("@/app/ConvexClientProvider", () => ({ useConvexAvailable: () => true }));

vi.mock("@/lib/cmd-flight-logs-api", () => ({
  cmdFlightLogsApi: { listPaginated: "list", upsert: "upsert", remove: "remove" },
}));

vi.mock("convex/react", () => ({
  usePaginatedQuery: () => ({ results: [], status: "Exhausted", loadMore: () => {} }),
  useMutation: (ref: string) => (ref === "upsert" ? convex.upsert : convex.remove),
}));

import { useHistoryStore } from "@/stores/history-store";
import { useAuthStore } from "@/stores/auth-store";
import { useSettingsStore } from "@/stores/settings-store";
import { CloudSyncBridge } from "@/components/history/CloudSyncBridge";
import { CloudSyncBadge } from "@/components/history/CloudSyncBadge";

function flight(id: string, overrides: Partial<FlightRecord> = {}): FlightRecord {
  const start = 1_760_000_000_000;
  return {
    id,
    droneId: "drone-1",
    droneName: "Alpha",
    date: start,
    startTime: start,
    endTime: start + 600_000,
    duration: 600,
    distance: 900,
    maxAlt: 35,
    maxSpeed: 9,
    waypointCount: 3,
    status: "completed",
    updatedAt: start + 600_000,
    ...overrides,
  };
}

const ids = () => useHistoryStore.getState().records.map((r) => r.id).sort();

beforeEach(() => {
  cleanup();
  idb.store.clear();
  convex.upsert.mockReset();
  convex.remove.mockReset();
  useHistoryStore.setState({
    records: [],
    pendingSyncIds: new Set(),
    syncErrors: new Map(),
    tombstoneIds: new Set(),
    pendingDeleteIds: new Set(),
    syncStatus: "idle",
    lastSyncAt: null,
    lastSyncError: null,
    _seeded: false,
  });
  useAuthStore.setState({ isAuthenticated: true });
  useSettingsStore.setState({ demoMode: false });
});

describe("permanent delete", () => {
  it("never merges a deleted flight back from a cloud page", () => {
    const store = useHistoryStore.getState();
    store.addRecord(flight("f1"));
    store.removeRecord("f1");
    store.emptyTrash();
    expect(ids()).toEqual([]);

    // A cloud page still carrying the row (its delete not yet applied).
    useHistoryStore.getState().mergeCloudRecords([flight("f1", { deleted: true, updatedAt: Date.now() + 1 })]);
    expect(ids()).toEqual([]);
  });

  it("keeps the tombstone across a reload", async () => {
    const store = useHistoryStore.getState();
    await store.ensureLoaded();
    store.addRecord(flight("f1"));
    store.permanentlyDelete("f1");
    await store.persistToIDB();

    vi.resetModules();
    const fresh = (await import("@/stores/history-store")).useHistoryStore;
    await fresh.getState().ensureLoaded();
    fresh.getState().mergeCloudRecords([flight("f1")]);
    expect(fresh.getState().records.map((r) => r.id)).toEqual([]);
    expect(Array.from(fresh.getState().pendingDeleteIds)).toEqual(["f1"]);
  });

  it("drops the flight's stored media blobs", async () => {
    idb.store.set("media:f1:m1", new Blob(["x"]));
    useHistoryStore.getState().addRecord(
      flight("f1", { media: [{ id: "m1", name: "a.jpg", type: "image/jpeg", size: 1, capturedAt: 1, blobKey: "media:f1:m1" }] }),
    );
    useHistoryStore.getState().permanentlyDelete("f1");
    await waitFor(() => expect(idb.store.has("media:f1:m1")).toBe(false));
  });

  it("removes the cloud row", async () => {
    convex.remove.mockResolvedValue({ status: "deleted" });
    useHistoryStore.getState().addRecord(flight("f1"));
    useHistoryStore.getState().markSynced(["f1"]);
    useHistoryStore.getState().permanentlyDelete("f1");

    render(<CloudSyncBridge />);
    await waitFor(() => expect(convex.remove).toHaveBeenCalledWith({ clientId: "f1" }));
    await waitFor(() => expect(useHistoryStore.getState().pendingDeleteIds.size).toBe(0));
  });
});

describe("push of dirty records", () => {
  it("syncs the other records when the cloud refuses one", async () => {
    convex.upsert.mockImplementation(async ({ record }) => {
      if (record.clientId === "sealed") throw new Error("Cannot mutate a sealed flight log. Unseal first.");
      return {};
    });
    const store = useHistoryStore.getState();
    // Records are newest first: the refused one is pushed before the other.
    store.addRecord(flight("next"));
    store.addRecord(flight("sealed"));

    render(<CloudSyncBridge />);
    await waitFor(() => expect(useHistoryStore.getState().pendingSyncIds.has("next")).toBe(false));

    const s = useHistoryStore.getState();
    expect(s.records.find((r) => r.id === "next")?.cloudSynced).toBe(true);
    expect(s.syncErrors.get("sealed")).toMatch(/sealed/);
    expect(s.syncStatus).toBe("error");
  });

  it("retries a refused record only after it changes", async () => {
    convex.upsert.mockRejectedValueOnce(new Error("refused")).mockResolvedValue({});
    useHistoryStore.getState().addRecord(flight("f1"));

    render(<CloudSyncBridge />);
    await waitFor(() => expect(useHistoryStore.getState().syncErrors.has("f1")).toBe(true));
    expect(convex.upsert).toHaveBeenCalledTimes(1);

    useHistoryStore.getState().updateRecord("f1", { notes: "fixed" });
    await waitFor(() => expect(useHistoryStore.getState().pendingSyncIds.has("f1")).toBe(false), { timeout: 3000 });
    expect(useHistoryStore.getState().syncErrors.size).toBe(0);
  });
});

describe("demo mode", () => {
  it("pushes nothing while demo mode is on", async () => {
    convex.upsert.mockResolvedValue({});
    useSettingsStore.setState({ demoMode: true });
    useHistoryStore.getState().addRecord(flight("f1"));

    // The mount pass calls upsert synchronously when it has anything to push.
    render(<CloudSyncBridge />);
    expect(convex.upsert).not.toHaveBeenCalled();
  });

  it("never pushes a demo seed record", async () => {
    convex.upsert.mockResolvedValue({});
    useHistoryStore.getState().addRecord(flight("demo-flight-1"));
    useHistoryStore.getState().addRecord(flight("f1"));

    render(<CloudSyncBridge />);
    await waitFor(() => expect(useHistoryStore.getState().pendingSyncIds.has("f1")).toBe(false));
    expect(convex.upsert.mock.calls.map(([args]) => args.record.clientId)).toEqual(["f1"]);
  });
});

describe("sync badge", () => {
  it("says nothing has synced yet before the first successful push", () => {
    renderWithIntl(<CloudSyncBadge />);
    expect(screen.getByText("Not synced yet")).toBeTruthy();
    expect(screen.queryByText(/^Synced/)).toBeNull();
  });

  it("counts records still waiting instead of claiming synced", () => {
    useHistoryStore.setState({ lastSyncAt: 1_760_000_000_000 });
    useHistoryStore.getState().addRecord(flight("f1"));
    renderWithIntl(<CloudSyncBadge />);
    expect(screen.getByText("1 to sync")).toBeTruthy();
  });

  it("reads local-only in demo mode", () => {
    useSettingsStore.setState({ demoMode: true });
    renderWithIntl(<CloudSyncBadge />);
    expect(screen.getByText("Local only")).toBeTruthy();
  });
});

describe("re-import", () => {
  it("leaves a stored flight alone when the same id is added again", () => {
    const store = useHistoryStore.getState();
    expect(store.addRecord(flight("f1", { notes: "mine" }))).toBe(true);
    expect(useHistoryStore.getState().addRecord(flight("f1"))).toBe(false);
    expect(useHistoryStore.getState().records).toHaveLength(1);
    expect(useHistoryStore.getState().records[0].notes).toBe("mine");
  });
});
