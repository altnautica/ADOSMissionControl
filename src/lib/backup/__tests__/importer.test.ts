/**
 * Restoring a backup merges into what is already on this device: it must not
 * bring back flights deleted here, drop pending cloud deletes, orphan local
 * recordings, or leave restored flights claiming telemetry they do not have.
 *
 * @license GPL-3.0-only
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";

const store = new Map<string, unknown>();
vi.mock("idb-keyval", () => ({
  get: async (k: string) => store.get(k),
  set: async (k: string, v: unknown) => {
    store.set(k, v);
  },
}));

import { importBackup } from "../importer";

async function backupFile(stores: Record<string, unknown>, recordings: Record<string, unknown> = {}): Promise<File> {
  const zip = new JSZip();
  zip.file("manifest.json", JSON.stringify({ version: 1 }));
  for (const [name, data] of Object.entries(stores)) zip.file(`stores/${name}.json`, JSON.stringify(data));
  for (const [key, data] of Object.entries(recordings)) zip.file(`recordings/${key}.json`, JSON.stringify(data));
  const bytes = await zip.generateAsync({ type: "arraybuffer" });
  return new File([bytes], "backup.zip", { type: "application/zip" });
}

function flight(id: string, extra: Record<string, unknown> = {}) {
  return { id, droneName: "Alpha", date: 1, startTime: 1, updatedAt: 1, ...extra };
}

beforeEach(() => store.clear());

describe("importBackup", () => {
  it("never brings back a flight permanently deleted on this device", async () => {
    store.set("altcmd:flight-history", [flight("kept")]);
    store.set("altcmd:flight-history-tombstones", { ids: ["gone"], pending: ["gone"] });

    const result = await importBackup(
      await backupFile({ "flight-history": [flight("gone"), flight("new")] }),
    );

    const ids = (store.get("altcmd:flight-history") as { id: string }[]).map((r) => r.id).sort();
    expect(ids).toEqual(["kept", "new"]);
    expect(result.recordsMerged).toBe(1);
  });

  it("unions tombstones so pending cloud deletes survive an older backup", async () => {
    store.set("altcmd:flight-history-tombstones", { ids: ["a", "b"], pending: ["b"] });

    await importBackup(
      await backupFile({ "flight-history-tombstones": { ids: ["a", "c"], pending: ["c"] } }),
    );

    expect(store.get("altcmd:flight-history-tombstones")).toEqual({ ids: ["a", "b", "c"], pending: ["b", "c"] });
  });

  it("merges the recordings index instead of replacing it", async () => {
    store.set("altcmd:recordings-index", [{ id: "rec-local", chunkCount: 1 }]);

    const result = await importBackup(
      await backupFile(
        { "recordings-index": [{ id: "rec-backup", chunkCount: 2 }] },
        { "rec-backup": [{ offsetMs: 0 }], "rec-backup:1": [{ offsetMs: 1 }] },
      ),
    );

    const ids = (store.get("altcmd:recordings-index") as { id: string }[]).map((r) => r.id);
    expect(ids).toEqual(["rec-local", "rec-backup"]);
    expect(store.get("altcmd:recording:rec-backup:1")).toEqual([{ offsetMs: 1 }]);
    expect(result.recordingsRestored).toBe(1);
  });

  it("restored flights whose telemetry is not here stop claiming it", async () => {
    store.set("altcmd:recordings-index", [{ id: "rec-local", chunkCount: 1 }]);

    await importBackup(
      await backupFile({
        "flight-history": [
          flight("has-local", { recordingId: "rec-local", hasTelemetry: true }),
          flight("missing", { recordingId: "rec-elsewhere", hasTelemetry: true }),
        ],
      }),
    );

    const byId = new Map(
      (store.get("altcmd:flight-history") as { id: string; recordingId?: string; hasTelemetry?: boolean }[]).map(
        (r) => [r.id, r],
      ),
    );
    expect(byId.get("has-local")).toMatchObject({ recordingId: "rec-local", hasTelemetry: true });
    expect(byId.get("missing")?.recordingId).toBeUndefined();
    expect(byId.get("missing")?.hasTelemetry).toBe(false);
  });

  it("does not index a recording whose chunks are missing from the backup", async () => {
    const result = await importBackup(
      await backupFile(
        { "recordings-index": [{ id: "rec-partial", chunkCount: 2 }] },
        { "rec-partial": [{ offsetMs: 0 }] },
      ),
    );

    expect(store.get("altcmd:recordings-index")).toEqual([]);
    expect(result.errors).toHaveLength(1);
  });
});
