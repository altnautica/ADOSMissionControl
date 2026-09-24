/**
 * Plugin-owned cloud records, exercised against the REAL handlers with the
 * in-memory ctx. They pin the grant gate on both write paths, the per-plugin
 * cap, the size cap, and that an uninstall drops the records it leaves behind
 * while a re-install keeps them.
 *
 * @license GPL-3.0-only
 */
import { describe, expect, it } from "vitest";

import * as records from "../../convex/pluginRecords";
import * as plugins from "../../convex/cmdPlugins";
import { MAX_RECORD_BYTES, MAX_RECORDS_PER_PLUGIN } from "../../convex/lib/pluginRecordsIngest";
import { invoke, makeCtx, type FakeCtx } from "./fakeConvexCtx";

const PLUGIN = "com.example.world";

/** An install of PLUGIN for user-1, optionally on a node, with its grants. */
function install(
  ctx: FakeCtx,
  opts: { droneId?: string; status?: string; granted?: boolean } = {},
): string {
  const [row] = ctx.db.seed("cmd_pluginInstalls", [
    {
      userId: "user-1",
      droneId: opts.droneId,
      pluginId: PLUGIN,
      version: "1.0.0",
      name: "World",
      source: "registry",
      manifestHash: "h",
      status: opts.status ?? "enabled",
      halves: ["agent", "gcs"],
      installedAt: 1,
    },
  ]);
  ctx.db.seed("cmd_pluginPermissions", [
    {
      userId: "user-1",
      pluginInstallId: row._id,
      pluginId: PLUGIN,
      permissionId: "cloud.records",
      granted: opts.granted ?? true,
      required: true,
    },
  ]);
  return row._id;
}

const AGENT_POST = {
  userId: "user-1",
  posterDeviceId: "ws-1",
  pluginId: PLUGIN,
  collection: "jobs",
  key: "job-1",
  deviceId: "drone-1",
  data: { status: "done" },
  sizeBytes: 17,
};

describe("ingestFromAgent", () => {
  it("refuses a node with no install, a disabled install, or no cloud.records grant", async () => {
    for (const setup of [
      () => {},
      (ctx: FakeCtx) => install(ctx, { droneId: "ws-1", status: "disabled" }),
      (ctx: FakeCtx) => install(ctx, { droneId: "ws-1", granted: false }),
      // An install on a DIFFERENT node does not speak for the poster.
      (ctx: FakeCtx) => install(ctx, { droneId: "ws-2" }),
    ]) {
      const ctx = makeCtx();
      setup(ctx);
      expect(await invoke(records.ingestFromAgent, ctx, AGENT_POST)).toBe("not_permitted");
      expect(ctx.db.rows("plugin_records")).toHaveLength(0);
    }
  });

  it("files the record as agent-written and replaces it on the same key", async () => {
    const ctx = makeCtx();
    install(ctx, { droneId: "ws-1" });
    expect(await invoke(records.ingestFromAgent, ctx, AGENT_POST)).toBe("ok");
    expect(
      await invoke(records.ingestFromAgent, ctx, { ...AGENT_POST, data: { status: "failed" } }),
    ).toBe("ok");
    const rows = ctx.db.rows("plugin_records");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: "user-1",
      deviceId: "drone-1",
      writtenBy: "agent",
      data: { status: "failed" },
    });
    expect(ctx.db.rows("plugin_record_counts")[0]).toMatchObject({ count: 1 });
  });

  it("refuses a new key past the per-plugin cap, but still replaces an existing one", async () => {
    const ctx = makeCtx();
    install(ctx, { droneId: "ws-1" });
    expect(await invoke(records.ingestFromAgent, ctx, AGENT_POST)).toBe("ok");
    const [counter] = ctx.db.rows("plugin_record_counts");
    await ctx.db.patch(counter._id, { count: MAX_RECORDS_PER_PLUGIN });

    expect(
      await invoke(records.ingestFromAgent, ctx, { ...AGENT_POST, key: "job-2" }),
    ).toBe("limit_reached");
    expect(await invoke(records.ingestFromAgent, ctx, AGENT_POST)).toBe("ok");
    expect(ctx.db.rows("plugin_records")).toHaveLength(1);
  });
});

describe("GCS access", () => {
  const PUT = { pluginId: PLUGIN, collection: "jobs", key: "job-1", data: { n: 1 } };

  it("refuses a signed-out caller and a plugin without an enabled grant", async () => {
    const anon = makeCtx();
    install(anon);
    await expect(invoke(records.put, anon, PUT)).rejects.toMatchObject({
      data: { code: "unauthenticated" },
    });

    const ungranted = makeCtx({ subject: "user-1|s" });
    install(ungranted, { granted: false });
    await expect(invoke(records.list, ungranted, { pluginId: PLUGIN, collection: "jobs" }))
      .rejects.toMatchObject({ data: { code: "not_permitted" } });

    // Another user's grant for the same plugin does not count.
    const other = makeCtx({ subject: "user-2|s" });
    install(other);
    await expect(invoke(records.put, other, PUT)).rejects.toMatchObject({
      data: { code: "not_permitted" },
    });
  });

  it("round-trips a record through put, list, get and remove", async () => {
    const ctx = makeCtx({ subject: "user-1|s" });
    install(ctx);
    expect(await invoke(records.put, ctx, PUT)).toBeNull();
    const listed = await invoke(records.list, ctx, { pluginId: PLUGIN, collection: "jobs" });
    expect(listed).toEqual([
      expect.objectContaining({ key: "job-1", data: { n: 1 }, deviceId: null, writtenBy: "gcs" }),
    ]);
    await invoke(records.remove, ctx, { pluginId: PLUGIN, collection: "jobs", key: "job-1" });
    expect(
      await invoke(records.get, ctx, { pluginId: PLUGIN, collection: "jobs", key: "job-1" }),
    ).toBeNull();
    expect(ctx.db.rows("plugin_record_counts")).toHaveLength(0);
  });

  it("refuses an oversize body and a node the caller does not own", async () => {
    const ctx = makeCtx({ subject: "user-1|s" });
    install(ctx);
    ctx.db.seed("cmd_drones", [{ userId: "user-2", deviceId: "drone-b" }]);
    await expect(
      invoke(records.put, ctx, { ...PUT, data: "x".repeat(MAX_RECORD_BYTES) }),
    ).rejects.toMatchObject({ data: { code: "too_large" } });
    await expect(invoke(records.put, ctx, { ...PUT, deviceId: "drone-b" })).rejects.toMatchObject({
      data: { code: "not_permitted" },
    });
    expect(ctx.db.rows("plugin_records")).toHaveLength(0);
  });
});

describe("uninstall", () => {
  function seedRecords(ctx: FakeCtx) {
    ctx.db.seed("plugin_records", [
      { userId: "user-1", pluginId: PLUGIN, deviceId: "drone-1", collection: "jobs", key: "a" },
      { userId: "user-1", pluginId: PLUGIN, deviceId: "drone-2", collection: "jobs", key: "b" },
    ]);
    ctx.db.seed("plugin_record_counts", [{ userId: "user-1", pluginId: PLUGIN, count: 2 }]);
  }

  it("drops only the removed node's records while another install remains", async () => {
    const ctx = makeCtx({ subject: "user-1|s" });
    const first = install(ctx, { droneId: "drone-1" });
    install(ctx, { droneId: "drone-2" });
    seedRecords(ctx);
    await invoke(plugins.removeInstall, ctx, { installId: first });
    expect(ctx.db.rows("plugin_records").map((r) => r.key)).toEqual(["b"]);
  });

  it("drops every record of the plugin with the last install", async () => {
    const ctx = makeCtx({ subject: "user-1|s" });
    const only = install(ctx, { droneId: "drone-1" });
    seedRecords(ctx);
    await invoke(plugins.removeInstall, ctx, { installId: only });
    expect(ctx.db.rows("plugin_records")).toHaveLength(0);
    expect(ctx.db.rows("plugin_record_counts")).toHaveLength(0);
  });

  it("keeps the plugin's records when the same node's install is replaced", async () => {
    const ctx = makeCtx({ subject: "user-1|s" });
    install(ctx, { droneId: "drone-1" });
    seedRecords(ctx);
    await invoke(plugins.recordInstall, ctx, {
      droneId: "drone-1",
      pluginId: PLUGIN,
      version: "1.1.0",
      name: "World",
      source: "registry",
      manifestHash: "h2",
      halves: ["agent", "gcs"],
      declaredPermissions: [{ id: "cloud.records", required: true }],
    });
    expect(ctx.db.rows("cmd_pluginInstalls").map((r) => r.version)).toEqual(["1.1.0"]);
    expect(ctx.db.rows("plugin_records")).toHaveLength(2);
  });
});
