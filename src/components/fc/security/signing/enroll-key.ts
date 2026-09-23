/**
 * @module components/fc/security/signing/enroll-key
 * @description Generate a signing key, send it to the flight controller
 * through the agent, and store it in this browser.
 *
 * The one rule this enforces: once a key may be on the FC, this browser keeps
 * it. ArduPilot never acknowledges SETUP_SIGNING, so a request that failed
 * after the agent may have sent a frame (a partial send, a timeout, a dropped
 * connection) leaves the FC holding either the new key or the old one. The new
 * key is stored as "unconfirmed" with the old key retained beside it, and the
 * operator settles which one the FC holds. Only an answer from the agent that
 * proves nothing was sent (a 4xx, the link-unavailable 503, a pre-send 500)
 * discards the new key.
 *
 * @license GPL-3.0-only
 */

import { generateRandomKey, keyBytesToHex, zeroize } from "@/lib/protocol/mavlink-signer";
import { importAndStore } from "@/lib/protocol/signing-keystore";
import { SigningPartialEnrollError, type AgentClient, type SigningEnrollResult } from "@/lib/agent/client";
import { AgentHttpError } from "@/lib/agent/agent-client/transport";

export type EnrollOutcome =
  | {
      kind: "enrolled";
      keyId: string;
      enrolledAt: string;
      /** The raw key as hex, for the caller's one-shot export or cloud upload. */
      keyHex: string;
    }
  | {
      kind: "unconfirmed";
      keyId: string;
      enrolledAt: string;
      keyHex: string;
      /** The key kept beside the new one, if this browser had one. */
      previousKeyId: string | null;
      /** Why the FC's state is unknown. */
      reason: string;
    }
  | {
      kind: "failed";
      error: string;
    };

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function enrollNewKey(opts: {
  client: Pick<AgentClient, "enrollSigningKey">;
  droneId: string;
  linkId: number;
  userId: string | null;
}): Promise<EnrollOutcome> {
  const { client, droneId, linkId, userId } = opts;
  const rawBytes = generateRandomKey();
  const keyHex = keyBytesToHex(rawBytes);

  let result: SigningEnrollResult;
  try {
    result = await client.enrollSigningKey(keyHex, linkId);
  } catch (e) {
    if (e instanceof AgentHttpError) {
      // The agent answered and sent nothing: the FC still has its old key.
      zeroize(rawBytes);
      return { kind: "failed", error: message(e) };
    }
    // A partial send, or a request that may have landed before it failed.
    const reason = e instanceof SigningPartialEnrollError
      ? "The first key frame reached the flight controller but the repeat failed."
      : `The enrollment request did not complete (${message(e)}); it may have reached the flight controller.`;
    try {
      const record = await importAndStore({
        droneId, userId, keyBytes: rawBytes, linkId,
        enrollmentState: "unconfirmed", keepPrevious: true,
      });
      return {
        kind: "unconfirmed",
        keyId: record.keyId,
        enrolledAt: record.enrolledAt,
        keyHex,
        previousKeyId: record.previous?.keyId ?? null,
        reason,
      };
    } catch (storeErr) {
      zeroize(rawBytes);
      return { kind: "failed", error: `${reason} The new key could not be stored in this browser: ${message(storeErr)}` };
    }
  }

  try {
    await importAndStore({ droneId, userId, keyBytes: rawBytes, linkId });
  } catch (storeErr) {
    zeroize(rawBytes);
    return {
      kind: "failed",
      error: `The flight controller was sent the new key, but it could not be stored in this browser: ${message(storeErr)}`,
    };
  }
  return { kind: "enrolled", keyId: result.key_id, enrolledAt: result.enrolled_at, keyHex };
}
