/**
 * @module cmdPairing
 * @description Convex functions for the ADOS drone pairing system.
 * Supports two flows:
 * 1. Agent-initiated: agent generates code → user enters code in GCS
 * 2. User-initiated: user pre-generates code → agent uses it during install
 *
 * EXPOSURE RULES for this file, because every function here sits on the
 * boundary between an unauthenticated caller and an agent credential:
 *
 *   - `registerAgent` and `getPairingStatus` are INTERNAL. They are the
 *     agent-facing half of the flow and are reached only through their HTTP
 *     routes in `http.ts`, which supply the source-address bucket key and the
 *     device's own API key respectively. As public mutations they let any
 *     browser holding a `ConvexReactClient` write an attacker-chosen `apiKey`
 *     keyed by `deviceId`, and read a claim oracle for any guessed device id.
 *   - `claimPairingCodeAnon` never returns an agent API key. The browser gets
 *     the agent's network address and pairs LAN-direct, taking the key from the
 *     agent itself over `/api/pairing/claim`. A six-character code is a weak
 *     enough bearer that it must not be exchangeable for a credential.
 *   - The anonymous owner is DERIVED from a server-minted browser session, not
 *     read out of an argument. See `issueBrowserSession`.
 *   - Every anonymous entry point consumes a rate-limit attempt before it does
 *     any work. See `convex/lib/rateLimit.ts`.
 *
 * @license GPL-3.0-only
 */

import { v } from "convex/values";
import {
  mutation,
  query,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";
import { agentKeyMatches } from "./lib/credentials";
import {
  CLAIM_GLOBAL_POLICY,
  CLAIM_POLICY,
  REGISTER_POLICY,
  SESSION_MINT_POLICY,
  clearAttempts,
  consumeAttempt,
  mintSecret,
  sha256Hex,
} from "./lib/rateLimit";

const SAFE_CHARSET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;
const CODE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const PAIRING_CODE_RE = new RegExp(
  `^[${SAFE_CHARSET}]{${CODE_LENGTH}}$`,
);
const MAX_DEVICE_ID_LENGTH = 96;
const MAX_LABEL_LENGTH = 128;
const MAX_API_KEY_LENGTH = 256;
const MAX_SECRET_LENGTH = 128;
/** A browser session is a long-lived local identity; 180 days of idle is dead. */
const BROWSER_SESSION_TTL_MS = 180 * 24 * 60 * 60 * 1000;
/** Cap on the rows `getMyPendingCodes` returns; a UI list, not a bulk export. */
const MAX_PENDING_CODES = 50;
/** Cap on the broker sync payload. Bounds an unbounded double `.collect()`. */
const MAX_MQTT_AUTH_ENTRIES = 2000;

function normalizePairingCode(code: string): string {
  const normalized = code.trim().toUpperCase();
  if (!PAIRING_CODE_RE.test(normalized)) {
    throw new Error("Pairing code must be six safe uppercase characters");
  }
  return normalized;
}

function generatePairingCode(): string {
  // The pairing code is a bearer credential — presenting it claims the agent —
  // so it must be unpredictable. Draw from a CSPRNG and rejection-sample to
  // avoid modulo bias across the 31-character charset.
  const limit = Math.floor(256 / SAFE_CHARSET.length) * SAFE_CHARSET.length;
  let pairingCode = "";
  while (pairingCode.length < CODE_LENGTH) {
    const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
    for (let i = 0; i < bytes.length && pairingCode.length < CODE_LENGTH; i++) {
      if (bytes[i] < limit) {
        pairingCode += SAFE_CHARSET[bytes[i] % SAFE_CHARSET.length];
      }
    }
  }
  return pairingCode;
}

function requireBoundedString(value: string, name: string, max: number): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${name} required`);
  if (trimmed.length > max) throw new Error(`${name} too long`);
  return trimmed;
}

function optionalBoundedString(
  value: string | undefined,
  name: string,
  max: number,
): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > max) throw new Error(`${name} too long`);
  return trimmed;
}

/**
 * Mint an anonymous browser session and return its secret exactly once.
 *
 * This exists because the anonymous pair path used to take a `browserUserId`
 * straight from the caller and write it into `cmd_drones.userId` as the owner.
 * A caller can choose any argument value, so knowing another browser's UUID was
 * enough to assert ownership of that browser's nodes and to consume its pending
 * pairing claims. Ownership is now derived from a secret this server generated:
 * the table stores only the SHA-256, the plaintext lives in the mint response
 * and the operator's browser, and the owner marker is `browser:<row id>` —
 * a value the caller never supplies.
 *
 * Same posture as `cmdMqttControlGrants.mint`: verifier-only storage, plaintext
 * exactly once. Anonymous by design (the whole point of the path is that no
 * account is required), so it is rate limited rather than authenticated.
 */
export const issueBrowserSession = mutation({
  args: {},
  handler: async (ctx): Promise<{ browserSessionSecret: string }> => {
    const now = Date.now();
    // No caller identity to bucket by, so the bound is global. Minting is a
    // once-per-browser event; a legitimate deployment never approaches this.
    await consumeAttempt(ctx, "session:mint:global", SESSION_MINT_POLICY, now);

    const secret = mintSecret();
    await ctx.db.insert("cmd_browserSessions", {
      secretHash: await sha256Hex(secret),
      createdAt: now,
      lastSeenAt: now,
    });
    return { browserSessionSecret: secret };
  },
});

/**
 * Resolve a presented browser-session secret to its owner marker, touching
 * `lastSeenAt` so an active browser is never swept. Returns null when the
 * secret is unknown or the session has gone stale.
 */
async function resolveBrowserOwner(
  ctx: MutationCtx,
  secret: string,
  now: number,
): Promise<string | null> {
  const row = await ctx.db
    .query("cmd_browserSessions")
    .withIndex("by_secretHash", (q) => q.eq("secretHash", secret))
    .first();
  if (!row) return null;
  if (now - row.lastSeenAt > BROWSER_SESSION_TTL_MS) return null;
  await ctx.db.patch(row._id, { lastSeenAt: now });
  return `browser:${row._id}`;
}

/** Anonymous code-pair: the browser proves which anonymous session it is with
 *  a secret this server minted (`issueBrowserSession`), and gets back the
 *  agent's ADDRESS — never its API key. The browser then pairs LAN-direct
 *  against the agent's own `/api/pairing/claim`, which is where the durable
 *  key comes from, exactly as the hostname-typed path already does.
 *
 *  Trade-off vs the signed-in `claimPairingCode`: this path writes a
 *  `cmd_drones` row owned by `browser:<session>`, not by a Convex account. The
 *  drone is LAN-only for this browser until the operator signs in and migrates
 *  (out of scope today). In return, the "no account required" promise extends
 *  to the short-code path, not just the hostname path.
 */
export const claimPairingCodeAnon = mutation({
  args: { code: v.string(), browserSessionSecret: v.string() },
  handler: async (ctx, { code, browserSessionSecret }) => {
    const now = Date.now();
    const pairingCode = normalizePairingCode(code);
    const secret = requireBoundedString(
      browserSessionSecret,
      "browserSessionSecret",
      MAX_SECRET_LENGTH,
    );
    const secretHash = await sha256Hex(secret);

    // Two buckets, both consumed before any lookup. Per-session bounds one
    // browser guessing codes; the global bucket is the backstop against the
    // same guess spread across many freshly-minted sessions. A successful
    // claim clears both, so a real operator never ladders.
    const sessionBucket = `claim:session:${secretHash}`;
    await consumeAttempt(ctx, sessionBucket, CLAIM_POLICY, now);
    await consumeAttempt(ctx, "claim:global", CLAIM_GLOBAL_POLICY, now);

    const browserMarker = await resolveBrowserOwner(ctx, secretHash, now);
    if (!browserMarker) return { error: "invalid_browser_session" as const };

    const request = await ctx.db
      .query("cmd_pairingRequests")
      .withIndex("by_pairingCode", (q) => q.eq("pairingCode", pairingCode))
      .first();

    if (!request) return { error: "invalid_pairing_code" as const };
    if (request.expiresAt < now) {
      await ctx.db.delete(request._id);
      return { error: "pairing_code_expired" as const };
    }
    if (request.claimedBy && request.claimedBy !== browserMarker) {
      return { error: "code_already_claimed" as const };
    }

    // Anon-paired drones still need a cmd_drones row so the agent's
    // /agent/status heartbeat can validate its apiKey. Without this the
    // heartbeat handler 401s every 5 s and cloud relay never delivers
    // telemetry — fine for LAN-direct on HTTP origins but a dead end on
    // HTTPS (mixed-content blocks the LAN path). The browser:<sessionId>
    // marker stays out of the way of real Convex auth user ids; the
    // listMyDrones query filters on getAuthUserId() which never returns
    // a "browser:" prefix, so signed-in users don't see anon drones.
    const deviceId = request.deviceId || `device-${pairingCode}`;
    const existingDrone = await ctx.db
      .query("cmd_drones")
      .withIndex("by_deviceId", (q) => q.eq("deviceId", deviceId))
      .first();

    // Single-owner guard: an anon claim may re-pair a device this same
    // session already owns, but must not reassign one owned by another
    // account or a different session. Checked before the claim patch so a
    // rejected attempt never consumes the code. A genuine owner who lost
    // their session recovers by unpairing on the device and re-pairing.
    if (existingDrone && existingDrone.userId !== browserMarker) {
      return { error: "device_owned_by_other" as const };
    }

    await ctx.db.patch(request._id, {
      claimedBy: browserMarker,
      claimedAt: now,
    });

    if (existingDrone) {
      await ctx.db.patch(existingDrone._id, {
        userId: browserMarker,
        apiKey: request.apiKey || existingDrone.apiKey,
        agentVersion: request.agentVersion ?? existingDrone.agentVersion,
        board: request.board ?? existingDrone.board,
        tier: request.tier ?? existingDrone.tier,
        os: request.os ?? existingDrone.os,
        mdnsHost: request.mdnsHost ?? existingDrone.mdnsHost,
        lastIp: request.localIp ?? existingDrone.lastIp,
        lastSeen: now,
        pairedAt: now,
      });
    } else {
      await ctx.db.insert("cmd_drones", {
        userId: browserMarker,
        deviceId,
        name: request.agentName || `Drone ${pairingCode}`,
        apiKey: request.apiKey || "",
        agentVersion: request.agentVersion,
        board: request.board,
        tier: request.tier,
        os: request.os,
        mdnsHost: request.mdnsHost,
        lastIp: request.localIp,
        lastSeen: now,
        fcConnected: false,
        pairedAt: now,
      });
    }

    await clearAttempts(ctx, sessionBucket);
    await clearAttempts(ctx, "claim:global");

    // NO apiKey. The browser resolves the agent's address here and takes the
    // durable credential from the agent itself over the LAN pair, which is the
    // only path where the key is handed to a party that proved LAN reach.
    return {
      error: null,
      deviceId,
      name: request.agentName || `Drone ${pairingCode}`,
      mdnsHost: request.mdnsHost,
      localIp: request.localIp,
      board: request.board,
      agentVersion: request.agentVersion,
    };
  },
});

/** User claims a pairing code (enters code displayed on agent terminal). */
export const claimPairingCode = mutation({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const now = Date.now();
    const pairingCode = normalizePairingCode(code);

    // Signed in, but still a bearer-code guess: bucket by the account so one
    // compromised session cannot walk the code space.
    const bucket = `claim:user:${userId}`;
    await consumeAttempt(ctx, bucket, CLAIM_POLICY, now);

    const request = await ctx.db
      .query("cmd_pairingRequests")
      .withIndex("by_pairingCode", (q) =>
        q.eq("pairingCode", pairingCode)
      )
      .first();

    if (!request) return { error: "invalid_pairing_code" as const };
    if (request.expiresAt < now) {
      await ctx.db.delete(request._id);
      return { error: "pairing_code_expired" as const };
    }
    if (request.claimedBy) return { error: "code_already_claimed" as const };

    // Single-owner guard: refuse to claim a device another account already
    // owns instead of silently creating a second owner row (with its own
    // API key) for the same hardware. The legitimate re-pair-to-a-new-
    // account path is for the current owner to release it first
    // (wipePairStateForOwnedDevice). Checked before the claim patch so a
    // rejected attempt never marks the code consumed.
    const deviceId = request.deviceId || `device-${pairingCode}`;
    const deviceRows = await ctx.db
      .query("cmd_drones")
      .withIndex("by_deviceId", (q) => q.eq("deviceId", deviceId))
      .collect();
    if (deviceRows.some((d) => d.userId !== userId)) {
      return { error: "device_owned_by_other" as const };
    }

    // Mark as claimed
    await ctx.db.patch(request._id, {
      claimedBy: userId,
      claimedAt: now,
    });

    // Upsert: update existing drone record if same user + device
    const existingDrone = await ctx.db
      .query("cmd_drones")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("deviceId"), deviceId))
      .first();

    let droneId;
    if (existingDrone) {
      await ctx.db.patch(existingDrone._id, {
        apiKey: request.apiKey || "",
        agentVersion: request.agentVersion,
        board: request.board,
        tier: request.tier,
        os: request.os,
        mdnsHost: request.mdnsHost,
        lastIp: request.localIp,
        lastSeen: now,
        pairedAt: now,
      });
      droneId = existingDrone._id;
    } else {
      droneId = await ctx.db.insert("cmd_drones", {
        userId,
        deviceId,
        name: request.agentName || `Drone ${pairingCode}`,
        apiKey: request.apiKey || "",
        agentVersion: request.agentVersion,
        board: request.board,
        tier: request.tier,
        os: request.os,
        mdnsHost: request.mdnsHost,
        lastIp: request.localIp,
        lastSeen: now,
        fcConnected: false,
        pairedAt: now,
      });
    }

    await clearAttempts(ctx, bucket);

    // The apiKey goes to the authenticated owner of the device that just
    // claimed it — the one caller entitled to it.
    return {
      error: null,
      droneId,
      apiKey: request.apiKey || "",
      mdnsHost: request.mdnsHost,
      localIp: request.localIp,
      deviceId,
      name: existingDrone?.name || request.agentName,
    };
  },
});

/** User pre-generates a pairing code (for zero-touch install). */
export const preGenerateCode = mutation({
  args: { code: v.optional(v.string()) },
  handler: async (ctx, { code }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    let pairingCode = code ? normalizePairingCode(code) : "";
    for (let attempt = 0; attempt < 8; attempt++) {
      if (!pairingCode) pairingCode = generatePairingCode();
      const existing = await ctx.db
        .query("cmd_pairingRequests")
        .withIndex("by_pairingCode", (q) => q.eq("pairingCode", pairingCode))
        .first();
      if (!existing) break;
      if (existing.expiresAt < Date.now() && !existing.claimedBy) {
        await ctx.db.delete(existing._id);
        break;
      }
      if (code) throw new Error("Pairing code already exists");
      pairingCode = "";
    }

    if (!pairingCode) {
      throw new Error("Could not allocate pairing code");
    }

    const requestId = await ctx.db.insert("cmd_pairingRequests", {
      pairingCode,
      expiresAt: Date.now() + CODE_TTL_MS,
      createdBy: userId,
    });

    return { requestId, code: pairingCode };
  },
});

/**
 * Agent polls to check if its code was claimed.
 *
 * INTERNAL, and it authorizes the caller itself rather than trusting its route:
 * the presented key must match the one this device registered with. As a public
 * `query({ deviceId })` this was a claim oracle — anyone who guessed or scraped
 * a device id learned whether it was registered, whether it had been claimed,
 * and (in the production twin) the claiming account's user id.
 */
export const getPairingStatus = internalQuery({
  args: { deviceId: v.string(), apiKey: v.string() },
  handler: async (ctx, { deviceId, apiKey }) => {
    const request = await ctx.db
      .query("cmd_pairingRequests")
      .withIndex("by_deviceId", (q) => q.eq("deviceId", deviceId))
      .first();

    // One answer for "no such device" and "wrong key", so the route cannot be
    // walked to enumerate device ids.
    if (!request || !agentKeyMatches(request.apiKey, apiKey)) {
      return { authorized: false as const };
    }

    return {
      authorized: true as const,
      registered: true,
      claimed: !!request.claimedBy,
      claimedBy: request.claimedBy,
      claimedAt: request.claimedAt,
    };
  },
});

/** User sees their pre-generated (unclaimed) codes. */
export const getMyPendingCodes = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const rows = await ctx.db
      .query("cmd_pairingRequests")
      .withIndex("by_createdBy", (q) => q.eq("createdBy", userId))
      .filter((q) => q.eq(q.field("claimedBy"), undefined))
      .take(MAX_PENDING_CODES);
    // Projected, not the raw row: a pairing request carries the agent's apiKey
    // once a device has registered against it, and a pending-codes list has no
    // business carrying a credential.
    return rows.map((r) => ({
      _id: r._id,
      _creationTime: r._creationTime,
      pairingCode: r.pairingCode,
      expiresAt: r.expiresAt,
      pairingCodeExpiresAt: r.pairingCodeExpiresAt,
      deviceId: r.deviceId,
      agentName: r.agentName,
    }));
  },
});

/**
 * Called by the `/pairing/register` HTTP route when an agent beacons its
 * pairing code. Handles upsert and auto-matching with pre-generated codes.
 *
 * INTERNAL. As a public mutation any browser could write an attacker-chosen
 * `apiKey` keyed by any `deviceId`, and could drive the pre-generated
 * auto-match branch — which inserts a `cmd_drones` row into the code
 * generator's fleet — as fast as it could guess codes.
 *
 * `clientKey` is a salted digest of the source address, stamped by the route
 * (never by the caller) and used only as a rate-limit bucket. It bounds the one
 * axis a code-guessing attack can travel: a second attempt reusing a device id
 * is refused by the binding below, so an attacker must vary the device id, and
 * only the source address stays constant.
 */
export const registerAgent = internalMutation({
  args: {
    clientKey: v.string(),
    deviceId: v.string(),
    pairingCode: v.string(),
    apiKey: v.string(),
    name: v.optional(v.string()),
    version: v.optional(v.string()),
    board: v.optional(v.string()),
    tier: v.optional(v.number()),
    os: v.optional(v.string()),
    mdnsHost: v.optional(v.string()),
    localIp: v.optional(v.string()),
    // Agent-authoritative pairing-code expiry (epoch seconds). Mirrors
    // the timer the agent's local wizard is showing the operator so
    // the cloud-side UI countdown matches the physical device.
    pairingCodeExpiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const deviceId = requireBoundedString(
      args.deviceId,
      "deviceId",
      MAX_DEVICE_ID_LENGTH,
    );
    const pairingCode = normalizePairingCode(args.pairingCode);
    const name = optionalBoundedString(args.name, "name", MAX_LABEL_LENGTH);
    const version = optionalBoundedString(
      args.version,
      "version",
      MAX_LABEL_LENGTH,
    );
    const board = optionalBoundedString(args.board, "board", MAX_LABEL_LENGTH);
    const os = optionalBoundedString(args.os, "os", MAX_LABEL_LENGTH);
    // Required, not optional. A blank key persisted `apiKey: ""`, which the
    // binding below cannot anchor to and which `agentKeyMatches` correctly
    // refuses to authenticate — a row that can never be authenticated is worse
    // than no row.
    const apiKey = requireBoundedString(args.apiKey, "apiKey", MAX_API_KEY_LENGTH);
    const mdnsHost = optionalBoundedString(
      args.mdnsHost,
      "mdnsHost",
      MAX_LABEL_LENGTH,
    );
    const localIp = optionalBoundedString(args.localIp, "localIp", MAX_LABEL_LENGTH);
    const clientBucket = `register:${requireBoundedString(
      args.clientKey,
      "clientKey",
      MAX_LABEL_LENGTH,
    )}`;
    if (
      args.tier !== undefined &&
      (!Number.isInteger(args.tier) || args.tier < 0 || args.tier > 10)
    ) {
      throw new Error("tier out of range");
    }
    // Validate the agent-side expiry. Reject negatives or absurd values
    // so a malformed beacon can never poison the row. Epoch seconds
    // beyond year 2100 are obvious noise.
    let pairingCodeExpiresAt: number | undefined = args.pairingCodeExpiresAt;
    if (pairingCodeExpiresAt !== undefined) {
      if (
        !Number.isFinite(pairingCodeExpiresAt) ||
        pairingCodeExpiresAt < 0 ||
        pairingCodeExpiresAt > 4_102_444_800
      ) {
        pairingCodeExpiresAt = undefined;
      }
    }

    // Paired-device credential binding. Once a device holds a cloud row with a
    // key, only the holder of that key may re-register it. Without this a
    // beacon from anyone could rotate a live drone's cloud credential to a
    // value they chose, and every subsequent heartbeat and relay command would
    // authenticate the attacker instead of the aircraft.
    const droneRow = await ctx.db
      .query("cmd_drones")
      .withIndex("by_deviceId", (q) => q.eq("deviceId", deviceId))
      .first();
    if (droneRow?.apiKey && !agentKeyMatches(droneRow.apiKey, apiKey)) {
      return { error: "device_registration_conflict" };
    }

    // Re-register the same device without letting a mismatched public request
    // delete an active pending pairing window.
    const existing = await ctx.db
      .query("cmd_pairingRequests")
      .withIndex("by_deviceId", (q) => q.eq("deviceId", deviceId))
      .first();
    if (existing) {
      if (existing.claimedBy) {
        // Surface the owner so the agent's beacon-claim handler can
        // record the real claimant (signed-in user id, or "browser:<session>"
        // for anon claims) instead of defaulting to the literal "cloud".
        return { alreadyClaimed: true, userId: existing.claimedBy };
      }
      // A beacon re-presenting the key it registered with is free — that is the
      // steady state and it must never ladder toward a lockout. Replacing the
      // key on a pending row is allowed (the agent's accept-code action mints a
      // fresh one per invocation) but is charged as a novel registration, so
      // rotating keys is not a way around the bound.
      if (!agentKeyMatches(existing.apiKey, apiKey)) {
        await consumeAttempt(ctx, clientBucket, REGISTER_POLICY, now);
      }
      await ctx.db.patch(existing._id, {
        pairingCode,
        agentName: name,
        agentVersion: version,
        board,
        tier: args.tier,
        os,
        apiKey,
        mdnsHost,
        localIp,
        expiresAt: now + CODE_TTL_MS,
        ...(pairingCodeExpiresAt !== undefined ? { pairingCodeExpiresAt } : {}),
      });
      return { registered: true };
    }

    // First contact for this device id, from this source address.
    await consumeAttempt(ctx, clientBucket, REGISTER_POLICY, now);

    // Check if a pre-generated code matches (zero-touch flow)
    const preGenerated = await ctx.db
      .query("cmd_pairingRequests")
      .withIndex("by_pairingCode", (q) =>
        q.eq("pairingCode", pairingCode)
      )
      .first();
    if (preGenerated && preGenerated.createdBy && !preGenerated.claimedBy) {
      if (preGenerated.expiresAt < now) {
        await ctx.db.delete(preGenerated._id);
        return { error: "pairing_code_expired" };
      }
      // Auto-match: pre-generated code found, auto-claim it
      await ctx.db.patch(preGenerated._id, {
        deviceId,
        agentName: name,
        agentVersion: version,
        board,
        tier: args.tier,
        os,
        apiKey,
        mdnsHost,
        localIp,
        claimedBy: preGenerated.createdBy!,
        claimedAt: now,
      });
      // Upsert drone record
      const ownerId = preGenerated.createdBy!;
      const existingDrone = await ctx.db
        .query("cmd_drones")
        .withIndex("by_userId", (q) => q.eq("userId", ownerId))
        .filter((q) => q.eq(q.field("deviceId"), deviceId))
        .first();

      if (existingDrone) {
        await ctx.db.patch(existingDrone._id, {
          apiKey,
          agentVersion: version,
          board,
          tier: args.tier,
          os,
          mdnsHost,
          lastIp: localIp,
          lastSeen: now,
          pairedAt: now,
        });
      } else {
        await ctx.db.insert("cmd_drones", {
          userId: ownerId,
          deviceId,
          name: name || `Drone ${pairingCode}`,
          apiKey,
          agentVersion: version,
          board,
          tier: args.tier,
          os,
          mdnsHost,
          lastIp: localIp,
          lastSeen: now,
          fcConnected: false,
          pairedAt: now,
        });
      }
      return { autoMatched: true, userId: ownerId };
    }

    // Insert new pairing request
    await ctx.db.insert("cmd_pairingRequests", {
      deviceId,
      pairingCode,
      agentName: name,
      agentVersion: version,
      board,
      tier: args.tier,
      os,
      apiKey,
      mdnsHost,
      localIp,
      expiresAt: now + CODE_TTL_MS,
      ...(pairingCodeExpiresAt !== undefined ? { pairingCodeExpiresAt } : {}),
    });

    return { registered: true };
  },
});

// Upper bound on rows deleted per sweep so one cron tick stays within
// transaction limits even if a large backlog accrued. A 15-minute cron drains
// the rest on the next ticks.
const CLEAN_EXPIRED_BATCH = 256;

/**
 * Cron job: clean expired pairing requests.
 *
 * Internal (cron-only): a public no-auth mutation let any client trigger the
 * scan on demand. The query walks the `by_expiresAt` index range below `now`
 * instead of a full-table `.filter().collect()`, and the batch is bounded so
 * a backlog cannot blow the per-call limits.
 */
export const cleanExpiredRequests = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const expired = await ctx.db
      .query("cmd_pairingRequests")
      .withIndex("by_expiresAt", (q) => q.lt("expiresAt", now))
      .take(CLEAN_EXPIRED_BATCH);
    for (const req of expired) {
      await ctx.db.delete(req._id);
    }
    return { deleted: expired.length };
  },
});

/**
 * Cron job: retire settled rate-limit buckets and dead browser sessions.
 *
 * Both tables are written by anonymous callers, so both grow without a sweep.
 * A bucket is settled once its window has elapsed AND its lockout has expired —
 * deleting a bucket that is still locked would hand an attacker a reset, so the
 * range is walked by `lastAttemptAt` and the lockout is re-checked per row.
 */
export const cleanExpiredSecurityState = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    // One day of idle is far past every policy window and every lockout ceiling.
    const settledBefore = now - 24 * 60 * 60 * 1000;
    const buckets = await ctx.db
      .query("cmd_authAttempts")
      .withIndex("by_lastAttemptAt", (q) => q.lt("lastAttemptAt", settledBefore))
      .take(CLEAN_EXPIRED_BATCH);
    let deletedBuckets = 0;
    for (const bucket of buckets) {
      if (bucket.lockedUntil > now) continue;
      await ctx.db.delete(bucket._id);
      deletedBuckets++;
    }

    const sessions = await ctx.db
      .query("cmd_browserSessions")
      .withIndex("by_lastSeenAt", (q) =>
        q.lt("lastSeenAt", now - BROWSER_SESSION_TTL_MS),
      )
      .take(CLEAN_EXPIRED_BATCH);
    for (const session of sessions) {
      await ctx.db.delete(session._id);
    }

    return { deletedBuckets, deletedSessions: sessions.length };
  },
});

/**
 * Operator-driven recovery: wipe pair state for a single device the
 * signed-in user owns (or no owner at all, see below). Delegates the
 * actual delete sweep to the internal mutation so the wipe surface
 * stays one code path.
 *
 * Ownership rules: if a cmd_drones row exists for this deviceId, the
 * caller must be its owner. If no row exists (the device was paired
 * to a different account, the row never existed, or the pairing
 * request is stale and orphan), the wipe is ALSO allowed. This lets
 * the operator clean up local-only broken state where the cloud row
 * was already gone but the pairing request lingered, or where the
 * device was previously claimed by another browser the operator no
 * longer controls.
 */
export const wipePairStateForOwnedDevice = mutation({
  args: { deviceId: v.string() },
  // Explicit handler return type breaks the self-referential typing
  // loop introduced by the `internal.cmdPairing.wipeByDeviceIds` call
  // below — Convex's generated `internal` API depends on the type of
  // every export in this file, including ours.
  handler: async (
    ctx,
    { deviceId },
  ): Promise<{
    removedRequests: number;
    removedDrones: number;
    removedStatus: number;
  }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const existingDrone = await ctx.db
      .query("cmd_drones")
      .withIndex("by_deviceId", (q) => q.eq("deviceId", deviceId))
      .first();
    if (existingDrone && existingDrone.userId !== userId) {
      throw new Error("Device is owned by a different account");
    }

    return await ctx.runMutation(internal.cmdPairing.wipeByDeviceIds, {
      deviceIds: [deviceId],
    });
  },
});

/**
 * List paired drones suitable for mosquitto passwd generation. Returns
 * { username, apiKey } pairs where username == deviceId. Only includes
 * drones with a non-empty apiKey (unpaired skeleton rows are skipped).
 *
 * Internal — gated by the /admin/mqtt-auth-entries httpAction which
 * checks the MQTT_AUTH_RELAY_SECRET bearer token. NEVER expose this
 * directly via a public query.
 *
 * BOUNDED. This is the highest-value read in either tree — every device's
 * plaintext key plus every live grant's broker line — and it ran as an
 * unbounded double `.collect()`. `truncated` is reported rather than silently
 * capped so a fleet that outgrows the bound produces a visible signal instead
 * of a broker file that quietly stops authenticating the tail of the estate.
 */
export const listMqttAuthEntries = internalQuery({
  args: {},
  handler: async (ctx) => {
    const drones = await ctx.db
      .query("cmd_drones")
      .take(MAX_MQTT_AUTH_ENTRIES + 1);
    const truncatedDrones = drones.length > MAX_MQTT_AUTH_ENTRIES;
    const entries = drones
      .slice(0, MAX_MQTT_AUTH_ENTRIES)
      .filter((d) => typeof d.apiKey === "string" && d.apiKey.length > 0)
      .map((d) => ({ username: d.deviceId, apiKey: d.apiKey }));

    // Operator write grants, alongside the device entries.
    //
    // The shared `gcs-viewer` principal is read-only by design ("do NOT grant
    // write access here" in the generated ACL), so a browser has never been
    // able to publish a command -- flight frames and video signalling were
    // discarded by the broker. These grants are what gives an operator write
    // access, scoped to the devices they owned when the grant was minted.
    //
    // `passwdEntry` is already a broker password line (PBKDF2 verifier, never
    // the secret), so the regeneration script appends it verbatim instead of
    // re-hashing. Expired and revoked grants are dropped here rather than on
    // the host: the broker file should never contain a credential that is no
    // longer valid, whatever the sync cadence happens to be. Walked by
    // `by_expiresAt` from now forward so the read touches only live grants.
    const now = Date.now();
    const liveGrants = await ctx.db
      .query("cmd_mqttControlGrants")
      .withIndex("by_expiresAt", (q) => q.gt("expiresAt", now))
      .take(MAX_MQTT_AUTH_ENTRIES + 1);
    const truncatedGrants = liveGrants.length > MAX_MQTT_AUTH_ENTRIES;
    const grants = liveGrants
      .slice(0, MAX_MQTT_AUTH_ENTRIES)
      .filter((g) => !g.revokedAt)
      .map((g) => ({
        principal: g.principal,
        passwdEntry: g.passwdEntry,
        deviceIds: g.deviceIds,
      }));

    // `entries` keeps its original shape so an older copy of the script that
    // does not know about grants still regenerates devices correctly.
    return { entries, grants, truncated: truncatedDrones || truncatedGrants };
  },
});

/** Admin recovery: wipe pair state for specific device IDs across all relevant tables. */
export const wipeByDeviceIds = internalMutation({
  args: { deviceIds: v.array(v.string()) },
  handler: async (ctx, { deviceIds }) => {
    let removedRequests = 0;
    let removedDrones = 0;
    let removedStatus = 0;
    for (const deviceId of deviceIds) {
      const reqs = await ctx.db
        .query("cmd_pairingRequests")
        .withIndex("by_deviceId", (q) => q.eq("deviceId", deviceId))
        .collect();
      for (const r of reqs) {
        await ctx.db.delete(r._id);
        removedRequests++;
      }
      const drones = await ctx.db
        .query("cmd_drones")
        .withIndex("by_deviceId", (q) => q.eq("deviceId", deviceId))
        .collect();
      for (const d of drones) {
        await ctx.db.delete(d._id);
        removedDrones++;
      }
      const statuses = await ctx.db
        .query("cmd_droneStatus")
        .withIndex("by_deviceId", (q) => q.eq("deviceId", deviceId))
        .collect();
      for (const s of statuses) {
        await ctx.db.delete(s._id);
        removedStatus++;
      }
    }
    return { removedRequests, removedDrones, removedStatus };
  },
});
