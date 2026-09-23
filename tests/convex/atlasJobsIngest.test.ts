/**
 * `POST /agent/atlas-jobs` files a job under the body's `deviceId`, and reads
 * are authorized by ownership of that device. These tests pin that a poster
 * can only file jobs for drones its own owner holds, and that the viewer URL
 * is always a web URL.
 *
 * @license GPL-3.0-only
 */

import { describe, expect, it } from "vitest";

import { resolveAtlasJobPost, type AtlasJobDevice } from "../../convex/lib/atlasJobsIngest";

const KEY = "k".repeat(32);
const DEVICES: Record<string, AtlasJobDevice> = {
  "ws-1": { apiKey: KEY, userId: "user-a" },
  "drone-a": { apiKey: "a".repeat(32), userId: "user-a" },
  "drone-b": { apiKey: "b".repeat(32), userId: "user-b" },
};
const lookup = async (deviceId: string) => DEVICES[deviceId] ?? null;

const BASE = {
  posterDeviceId: "ws-1",
  deviceId: "drone-a",
  computeNodeId: "ws-1",
  kind: "splat",
  status: "done",
};

describe("resolveAtlasJobPost", () => {
  it("accepts a job for a drone in the poster's own fleet", async () => {
    const job = await resolveAtlasJobPost(
      { ...BASE, outputUrl: "https://example.com/out.rrd", metadata: { backend: "real" } },
      KEY,
      lookup,
    );
    expect(job).not.toBeInstanceOf(Response);
    expect(job).toMatchObject({
      deviceId: "drone-a",
      outputUrl: "https://example.com/out.rrd",
      metadata: { backend: "real" },
    });
  });

  it("refuses a job for another owner's drone with 403", async () => {
    const res = await resolveAtlasJobPost({ ...BASE, deviceId: "drone-b" }, KEY, lookup);
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(403);
  });

  it("refuses a job for an unknown drone with 403", async () => {
    const res = await resolveAtlasJobPost({ ...BASE, deviceId: "drone-x" }, KEY, lookup);
    expect((res as Response).status).toBe(403);
  });

  it("refuses a wrong poster key with 401", async () => {
    const res = await resolveAtlasJobPost(BASE, "z".repeat(32), lookup);
    expect((res as Response).status).toBe(401);
  });

  it("refuses an outputUrl that is not http(s)", async () => {
    for (const outputUrl of ["javascript:alert(1)", "file:///etc/passwd", "//example.com/x"]) {
      const res = await resolveAtlasJobPost({ ...BASE, outputUrl }, KEY, lookup);
      expect((res as Response).status, outputUrl).toBe(400);
    }
  });

  it("refuses over-long strings", async () => {
    const res = await resolveAtlasJobPost({ ...BASE, sessionId: "s".repeat(129) }, KEY, lookup);
    expect((res as Response).status).toBe(400);
  });
});
