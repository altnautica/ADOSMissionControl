/**
 * The capability-token root secret is reused while live and rotated once it is
 * past its period, with the rotate-or-reuse decision made inside one mutation.
 * Two mints racing at a rotation boundary must agree on one secret, and the
 * retained previous secret must be the one that was actually current.
 */
import { describe, expect, it } from "vitest";

import * as secrets from "../../convex/operatorHmacSecrets";
import { invoke, makeCtx } from "./fakeConvexCtx";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("operatorHmacSecrets.currentOrRotate", () => {
  it("lets a second concurrent first mint reuse the secret the first installed", async () => {
    const ctx = makeCtx();
    const first = await invoke(secrets.currentOrRotate, ctx, {
      userId: "u1",
      candidateSecretBase64: "A",
    });
    const second = await invoke(secrets.currentOrRotate, ctx, {
      userId: "u1",
      candidateSecretBase64: "B",
    });
    expect([first, second]).toEqual(["A", "A"]);
    expect(ctx.db.rows("operator_hmac_secrets")).toHaveLength(1);
  });

  it("rotates a stale secret once and keeps the real current one as previous", async () => {
    const ctx = makeCtx();
    ctx.db.seed("operator_hmac_secrets", [
      { userId: "u1", secretBase64: "OLD", rotatedAt: Date.now() - 31 * DAY_MS },
    ]);
    await invoke(secrets.currentOrRotate, ctx, { userId: "u1", candidateSecretBase64: "NEW1" });
    const racer = await invoke(secrets.currentOrRotate, ctx, {
      userId: "u1",
      candidateSecretBase64: "NEW2",
    });
    const row = ctx.db.rows("operator_hmac_secrets")[0];
    expect(racer).toBe("NEW1");
    expect(row.secretBase64).toBe("NEW1");
    expect(row.previousSecretBase64).toBe("OLD");
  });
});
