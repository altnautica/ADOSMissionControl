// @vitest-environment node
/**
 * @module videoRelayToken.test
 * @description The Convex minter and the video relay agree on the viewer
 * token, and the relay refuses expired, long-dated, tampered and
 * cross-device tokens.
 *
 * @license GPL-3.0-only
 */

import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it, expect } from "vitest";

import { mintVideoRelayToken, VIDEO_RELAY_TOKEN_TTL_S } from "../../convex/lib/videoRelayToken";
import {
  MAX_VIEWER_TOKEN_TTL_S,
  signViewerToken,
  verifyViewerToken,
} from "../../tools/video-relay/src/viewer-token";

const SECRET = "test-relay-secret";
const NOW_MS = 1_900_000_000_000;
const NOW_S = NOW_MS / 1000;

describe("video relay viewer token", () => {
  it("a token minted by Convex opens the device it was minted for", async () => {
    const { token, expiresAt } = await mintVideoRelayToken("drone-1", SECRET, NOW_MS);
    expect(expiresAt).toBe((NOW_S + VIDEO_RELAY_TOKEN_TTL_S) * 1000);
    expect(token).toBe(signViewerToken("drone-1", NOW_S + VIDEO_RELAY_TOKEN_TTL_S, SECRET));
    expect(verifyViewerToken(token, "drone-1", SECRET, NOW_S)).toBe(true);
    expect(verifyViewerToken(token, "drone-1", SECRET, NOW_S + VIDEO_RELAY_TOKEN_TTL_S - 1)).toBe(
      true,
    );
  });

  it("refuses the token for another device", async () => {
    const { token } = await mintVideoRelayToken("drone-1", SECRET, NOW_MS);
    expect(verifyViewerToken(token, "drone-2", SECRET, NOW_S)).toBe(false);
  });

  it("refuses the token once it has expired", async () => {
    const { token } = await mintVideoRelayToken("drone-1", SECRET, NOW_MS);
    expect(verifyViewerToken(token, "drone-1", SECRET, NOW_S + VIDEO_RELAY_TOKEN_TTL_S)).toBe(false);
  });

  it("refuses a correctly signed token dated beyond the accepted lifetime", () => {
    const token = signViewerToken("drone-1", NOW_S + MAX_VIEWER_TOKEN_TTL_S + 1, SECRET);
    expect(verifyViewerToken(token, "drone-1", SECRET, NOW_S)).toBe(false);
  });

  it("refuses a token whose expiry was edited", async () => {
    const { token } = await mintVideoRelayToken("drone-1", SECRET, NOW_MS);
    const [exp, mac] = token.split(".");
    const extended = `${Number(exp) + 60}.${mac}`;
    expect(verifyViewerToken(extended, "drone-1", SECRET, NOW_S)).toBe(false);
  });

  it("refuses a token signed with another secret, and everything when no secret is set", async () => {
    const { token } = await mintVideoRelayToken("drone-1", "other-secret", NOW_MS);
    expect(verifyViewerToken(token, "drone-1", SECRET, NOW_S)).toBe(false);
    const good = signViewerToken("drone-1", NOW_S + 60, SECRET);
    expect(verifyViewerToken(good, "drone-1", "", NOW_S)).toBe(false);
  });

  it("refuses the bare device HMAC with no expiry", () => {
    const bare = signViewerToken("drone-1", NOW_S + 60, SECRET).split(".")[1];
    expect(verifyViewerToken(bare, "drone-1", SECRET, NOW_S)).toBe(false);
  });
});

// The production deployment keeps its own copy of the Convex minter; it must
// run the exact code tested above. Skipped when that sibling is not checked out.
const MIRRORED = ["convex/lib/videoRelayToken.ts", "convex/cmdVideoRelayTokens.ts"];
const mirrorRoot = resolve(process.cwd(), "../website");
const mirrorPresent = MIRRORED.every((p) => existsSync(join(mirrorRoot, p)));

describe("video relay token minter mirror", () => {
  it.skipIf(!mirrorPresent)("the deployment copy is byte-identical", () => {
    for (const rel of MIRRORED) {
      const canonical = readFileSync(join(process.cwd(), rel), "utf-8");
      const mirror = readFileSync(join(mirrorRoot, rel), "utf-8");
      expect(mirror, `${rel} has drifted from its mirror`).toBe(canonical);
    }
  });
});
