/**
 * `POST /agent/plugin-records` files a record under the poster's owner and a
 * subject `deviceId`. These tests pin that a poster proves its key, can only
 * name nodes its own owner holds, and that every stored field is bounded.
 *
 * @license GPL-3.0-only
 */

import { describe, expect, it } from "vitest";

import {
  MAX_RECORD_BYTES,
  resolvePluginRecordPost,
  type PluginRecordDevice,
} from "../../convex/lib/pluginRecordsIngest";

const KEY = "k".repeat(32);
const DEVICES: Record<string, PluginRecordDevice> = {
  "ws-1": { apiKey: KEY, userId: "user-a" },
  "drone-a": { apiKey: "a".repeat(32), userId: "user-a" },
  "drone-b": { apiKey: "b".repeat(32), userId: "user-b" },
};
const lookup = async (deviceId: string) => DEVICES[deviceId] ?? null;

const BASE = {
  posterDeviceId: "ws-1",
  pluginId: "com.example.world",
  collection: "jobs",
  key: "job-1",
  data: { status: "done" },
};

async function status(body: Record<string, unknown>, key = KEY): Promise<number> {
  const res = await resolvePluginRecordPost(body, key, lookup);
  return res instanceof Response ? res.status : 200;
}

describe("resolvePluginRecordPost", () => {
  it("files a record about a node in the poster's own fleet under the poster's owner", async () => {
    const post = await resolvePluginRecordPost({ ...BASE, deviceId: "drone-a" }, KEY, lookup);
    expect(post).toMatchObject({
      userId: "user-a",
      posterDeviceId: "ws-1",
      deviceId: "drone-a",
      pluginId: "com.example.world",
      data: { status: "done" },
    });
  });

  it("defaults the subject to the poster", async () => {
    const post = await resolvePluginRecordPost(BASE, KEY, lookup);
    expect(post).toMatchObject({ deviceId: "ws-1" });
  });

  it("refuses a wrong or missing poster key with 401", async () => {
    expect(await status(BASE, "z".repeat(32))).toBe(401);
    expect(await status({ ...BASE, posterDeviceId: "ws-unknown" })).toBe(401);
  });

  it("refuses a subject node another owner holds, or no one holds, with 403", async () => {
    expect(await status({ ...BASE, deviceId: "drone-b" })).toBe(403);
    expect(await status({ ...BASE, deviceId: "drone-x" })).toBe(403);
  });

  it("refuses malformed addresses with 400", async () => {
    for (const bad of [
      { pluginId: "not-reverse-dns" },
      { pluginId: `com.${"a".repeat(130)}` },
      { collection: "Jobs" },
      { collection: "a".repeat(65) },
      { collection: "jobs/../x" },
      { key: "" },
      { key: "k".repeat(257) },
    ]) {
      expect(await status({ ...BASE, ...bad }), JSON.stringify(bad)).toBe(400);
    }
    const noData: Record<string, unknown> = { ...BASE };
    delete noData.data;
    expect(await status(noData)).toBe(400);
  });

  it("caps the record body at 64 KiB of JSON with 413", async () => {
    // A JSON string encodes as its characters plus two quotes.
    expect(await status({ ...BASE, data: "x".repeat(MAX_RECORD_BYTES - 2) })).toBe(200);
    expect(await status({ ...BASE, data: "x".repeat(MAX_RECORD_BYTES - 1) })).toBe(413);
  });
});
