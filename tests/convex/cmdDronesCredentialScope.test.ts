/**
 * Who can read a device credential off the paired-drone reads.
 *
 * The invariant these tests defend is "a credential reaches only a caller
 * entitled to it", not "a credential never crosses the wire". The device
 * `apiKey` authenticates the agent's own REST surface and is that device's
 * MQTT broker principal, and for a cloud-paired node the `cmd_drones` row is
 * the only place the browser can obtain it — so the owner legitimately reads
 * it, and nobody else may.
 *
 * Exercised against the REAL exported handlers through `._handler`, so a
 * future change to the projection, the index, or the ownership comparison is
 * caught here rather than in a source-text assertion that a rename defeats.
 *
 * The last test is the one that survives a schema change: a column added to
 * `cmd_drones` must NOT appear in the owner projection until it is named
 * there deliberately. That is what makes the explicit field list load-bearing
 * instead of decorative.
 *
 * @license GPL-3.0-only
 */
import { describe, expect, it } from "vitest";

import * as drones from "../../convex/cmdDrones";
import { invoke, makeCtx, type FakeCtx } from "./fakeConvexCtx";

const NOW = Date.now();
const OWNER_KEY = "ados_live_owner_key_value";

function seedDrone(ctx: FakeCtx, overrides: Record<string, unknown> = {}) {
  return ctx.db.seed("cmd_drones", [
    {
      userId: "owner-a",
      deviceId: "dev-1",
      name: "Owned drone",
      apiKey: OWNER_KEY,
      lastSeen: NOW,
      fcConnected: false,
      pairedAt: NOW,
      ...overrides,
    },
  ])[0];
}

/** Deep scan for the credential anywhere in a response, at any nesting depth. */
function leaksKey(value: unknown): boolean {
  if (typeof value === "string") return value.includes(OWNER_KEY);
  if (Array.isArray(value)) return value.some(leaksKey);
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some(leaksKey);
  }
  return false;
}

describe("listMyDrones", () => {
  it("returns nothing to an anonymous caller", async () => {
    const ctx = makeCtx();
    seedDrone(ctx);
    const rows = await invoke(drones.listMyDrones, ctx, {});
    expect(rows).toEqual([]);
    expect(leaksKey(rows)).toBe(false);
  });

  it("returns nothing to a signed-in caller who owns no drone", async () => {
    const ctx = makeCtx({ subject: "owner-b|session_1" });
    seedDrone(ctx);
    const rows = await invoke(drones.listMyDrones, ctx, {});
    expect(rows).toEqual([]);
    expect(leaksKey(rows)).toBe(false);
  });

  it("returns the owner's own row, key included, and no other account's row", async () => {
    const ctx = makeCtx({ subject: "owner-a|session_1" });
    seedDrone(ctx);
    seedDrone(ctx, {
      userId: "owner-b",
      deviceId: "dev-2",
      name: "Someone else's drone",
      apiKey: "ados_live_other_account_key",
    });

    const rows = (await invoke(drones.listMyDrones, ctx, {})) as Array<
      Record<string, unknown>
    >;

    expect(rows).toHaveLength(1);
    expect(rows[0].deviceId).toBe("dev-1");
    expect(rows[0].apiKey).toBe(OWNER_KEY);
    expect(JSON.stringify(rows)).not.toContain("ados_live_other_account_key");
  });
});

describe("getDrone", () => {
  it("returns null to an anonymous caller", async () => {
    const ctx = makeCtx();
    const row = seedDrone(ctx);
    const result = await invoke(drones.getDrone, ctx, { droneId: row._id });
    expect(result).toBeNull();
  });

  it("returns null to a signed-in caller who does not own the row", async () => {
    const ctx = makeCtx({ subject: "owner-b|session_1" });
    const row = seedDrone(ctx);
    const result = await invoke(drones.getDrone, ctx, { droneId: row._id });
    expect(result).toBeNull();
    expect(leaksKey(result)).toBe(false);
  });

  it("returns the row to its owner", async () => {
    const ctx = makeCtx({ subject: "owner-a|session_1" });
    const row = seedDrone(ctx);
    const result = (await invoke(drones.getDrone, ctx, {
      droneId: row._id,
    })) as Record<string, unknown>;
    expect(result.deviceId).toBe("dev-1");
    expect(result.apiKey).toBe(OWNER_KEY);
  });
});

describe("getAgentKey", () => {
  it("returns null to an anonymous caller", async () => {
    const ctx = makeCtx();
    seedDrone(ctx);
    const result = await invoke(drones.getAgentKey, ctx, { deviceId: "dev-1" });
    expect(result).toBeNull();
  });

  it("returns null to a signed-in caller who does not own the device", async () => {
    const ctx = makeCtx({ subject: "owner-b|session_1" });
    seedDrone(ctx);
    const result = await invoke(drones.getAgentKey, ctx, { deviceId: "dev-1" });
    expect(result).toBeNull();
    expect(leaksKey(result)).toBe(false);
  });

  it("returns null for a device that does not exist", async () => {
    const ctx = makeCtx({ subject: "owner-a|session_1" });
    seedDrone(ctx);
    expect(
      await invoke(drones.getAgentKey, ctx, { deviceId: "dev-absent" }),
    ).toBeNull();
  });

  it("returns null for a row paired before the agent supplied a key", async () => {
    // An empty `apiKey` means "paired, no agent key yet". Handing that back
    // would let a caller authenticate with an empty string against any check
    // that compares the two values directly.
    const ctx = makeCtx({ subject: "owner-a|session_1" });
    seedDrone(ctx, { apiKey: "" });
    expect(
      await invoke(drones.getAgentKey, ctx, { deviceId: "dev-1" }),
    ).toBeNull();
  });

  it("returns the key to the device's owner", async () => {
    const ctx = makeCtx({ subject: "owner-a|session_1" });
    seedDrone(ctx);
    expect(await invoke(drones.getAgentKey, ctx, { deviceId: "dev-1" })).toEqual(
      { apiKey: OWNER_KEY },
    );
  });
});

describe("owner projection", () => {
  it("omits a column the projection does not name, even from the owner", async () => {
    // The guard against the next leak: a credential-shaped column added to
    // `cmd_drones` must be published deliberately. The previous reads
    // `.collect()`ed the raw document, so a new column shipped to the browser
    // the moment it was written.
    const ctx = makeCtx({ subject: "owner-a|session_1" });
    seedDrone(ctx, { relayJoinSecret: "ados_live_future_column_secret" });

    const rows = (await invoke(drones.listMyDrones, ctx, {})) as Array<
      Record<string, unknown>
    >;

    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toHaveProperty("relayJoinSecret");
    expect(JSON.stringify(rows)).not.toContain("ados_live_future_column_secret");
  });
});
