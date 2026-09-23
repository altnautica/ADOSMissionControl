/**
 * A sealed flight log keeps its seal across cloud upserts: sealed content is
 * immutable, the signature cannot be swapped, and a signature released by an
 * unseal cannot be put back over content that changed after it was released.
 * Exercised against the real `upsert` handler through the in-memory ctx.
 *
 * @license GPL-3.0-only
 */
import { describe, expect, it } from "vitest";

import * as flightLogs from "../../convex/cmdFlightLogs";
import { invoke, makeCtx, type FakeCtx } from "./fakeConvexCtx";

const T0 = 1_700_000_000_000;

function record(overrides: Record<string, unknown> = {}) {
  return {
    clientId: "flight-1",
    droneId: "drone-a",
    droneName: "Drone A",
    startTime: T0,
    endTime: T0 + 600_000,
    duration: 600,
    distance: 1200,
    maxAlt: 40,
    maxSpeed: 12,
    batteryUsed: 30,
    status: "completed",
    updatedAt: T0,
    ...overrides,
  };
}

async function upsert(ctx: FakeCtx, rec: Record<string, unknown>) {
  return await invoke(flightLogs.upsert, ctx, { record: rec });
}

describe("flight-log seal", () => {
  const sealedCtx = async () => {
    const ctx = makeCtx({ subject: "user-1|session-1" });
    await upsert(ctx, record({ pilotSignatureHash: "hash-A", pilotSignedAt: T0, updatedAt: T0 + 1 }));
    return ctx;
  };

  it("refuses an edit to sealed content", async () => {
    const ctx = await sealedCtx();
    await expect(
      upsert(ctx, record({ distance: 9999, pilotSignatureHash: "hash-A", pilotSignedAt: T0, updatedAt: T0 + 2 })),
    ).rejects.toThrow(/sealed record/);
  });

  it("refuses restoring the released signature over content edited after the unseal", async () => {
    const ctx = await sealedCtx();
    // Unseal: the signature is dropped, content unchanged.
    await upsert(ctx, record({ updatedAt: T0 + 2 }));
    // Edit while unsealed.
    await upsert(ctx, record({ distance: 9999, updatedAt: T0 + 3 }));
    // Put the old signature back over the edited content.
    await expect(
      upsert(ctx, record({ distance: 9999, pilotSignatureHash: "hash-A", pilotSignedAt: T0, updatedAt: T0 + 4 })),
    ).rejects.toThrow(/released signature/);
    expect(ctx.db.rows("cmd_flightLogs")[0].pilotSignatureHash).toBeUndefined();
  });

  it("lets the released signature return over the content it covered", async () => {
    const ctx = await sealedCtx();
    await upsert(ctx, record({ updatedAt: T0 + 2 }));
    await upsert(ctx, record({ pilotSignatureHash: "hash-A", pilotSignedAt: T0, updatedAt: T0 + 3 }));
    expect(ctx.db.rows("cmd_flightLogs")[0].pilotSignatureHash).toBe("hash-A");
  });

  it("accepts a fresh signature over edited content", async () => {
    const ctx = await sealedCtx();
    await upsert(ctx, record({ updatedAt: T0 + 2 }));
    await upsert(ctx, record({ distance: 9999, updatedAt: T0 + 3 }));
    await upsert(ctx, record({ distance: 9999, pilotSignatureHash: "hash-B", pilotSignedAt: T0 + 3, updatedAt: T0 + 4 }));
    expect(ctx.db.rows("cmd_flightLogs")[0].pilotSignatureHash).toBe("hash-B");
  });

  it("refuses swapping one signature for another on a sealed row", async () => {
    const ctx = await sealedCtx();
    await expect(
      upsert(ctx, record({ pilotSignatureHash: "hash-B", pilotSignedAt: T0, updatedAt: T0 + 2 })),
    ).rejects.toThrow(/cannot be replaced/);
  });
});
