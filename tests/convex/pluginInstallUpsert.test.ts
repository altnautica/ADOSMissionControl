/**
 * Plugin installs are per drone, and an install row may only reference a GCS
 * bundle its own user stored.
 */
import { describe, expect, it } from "vitest";

import * as plugins from "../../convex/cmdPlugins";
import { invoke, makeCtx, type FakeCtx } from "./fakeConvexCtx";

const base = {
  pluginId: "com.example.tool",
  version: "1.0.0",
  name: "Tool",
  source: "local_file",
  manifestHash: "h",
  halves: ["gcs"],
  declaredPermissions: [{ id: "command.send", required: false }],
};

function ownBundle(ctx: FakeCtx, userId: string): string {
  return ctx.db.seed("cmd_pluginBundles", [{ userId, storageId: `blob-${userId}`, createdAt: 1 }])[0]
    .storageId as string;
}

describe("recordInstall", () => {
  it("keeps drone A's install and grants when the plugin is installed on drone B", async () => {
    const ctx = makeCtx({ subject: "u1" });
    const a = await invoke(plugins.recordInstall, ctx, { ...base, droneId: "drone-a" });
    await invoke(plugins.recordInstall, ctx, { ...base, droneId: "drone-b" });
    const installs = ctx.db.rows("cmd_pluginInstalls");
    expect(installs.map((r) => r.droneId).sort()).toEqual(["drone-a", "drone-b"]);
    expect(ctx.db.rows("cmd_pluginPermissions").some((p) => p.pluginInstallId === a)).toBe(true);
  });

  it("replacing a drone's install drops the old row's events and bundle", async () => {
    const ctx = makeCtx({ subject: "u1" });
    const first = ownBundle(ctx, "u1");
    const old = await invoke(plugins.recordInstall, ctx, {
      ...base,
      droneId: "drone-a",
      bundleStorageId: first,
    });
    ctx.db.seed("cmd_pluginBundles", [{ userId: "u1", storageId: "blob-2", createdAt: 2 }]);
    await invoke(plugins.recordInstall, ctx, {
      ...base,
      droneId: "drone-a",
      bundleStorageId: "blob-2",
    });
    expect(ctx.db.rows("cmd_pluginInstalls")).toHaveLength(1);
    expect(ctx.db.rows("cmd_pluginEvents").some((e) => e.pluginInstallId === old)).toBe(false);
    expect(ctx.deletedStorage).toEqual([first]);
  });

  it("refuses a bundle storage id the caller did not store", async () => {
    const ctx = makeCtx({ subject: "u1" });
    const foreign = ownBundle(ctx, "u2");
    await expect(
      invoke(plugins.recordInstall, ctx, { ...base, droneId: "drone-a", bundleStorageId: foreign }),
    ).rejects.toThrow(/not stored for this user/);
    await expect(
      invoke(plugins.recordInstall, ctx, { ...base, droneId: "drone-a", bundleStorageId: "blob-x" }),
    ).rejects.toThrow(/not stored for this user/);
    expect(ctx.db.rows("cmd_pluginInstalls")).toHaveLength(0);
  });
});
