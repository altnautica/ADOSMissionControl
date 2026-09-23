/**
 * @module agent/local-pair/claim
 * @description The credential-claim half of the pair flow. POSTs the
 * agent's ``/api/pairing/claim`` route with the browser-local UUID as
 * the owner id and returns the durable API key the GCS uses for every
 * subsequent call.
 * @license GPL-3.0-only
 */

import { getBrowserId } from "@/stores/browser-identity-store";
import type { ClaimResult } from "./types";
import { AgentAlreadyPairedError } from "./errors";
import { withTimeoutSignal } from "../agent-client/timeout";
import { FETCH_TIMEOUT_MS, normaliseHost, safeJson, shouldUseProxy } from "./transport";
import { pairFailureFromResponse } from "./failure-copy";

/** POST ``/api/pairing/claim`` with the browser-local UUID as ``user_id``.
 * The browser UUID acts as the pair owner id — the agent treats it
 * as the credential for unpair on subsequent requests.
 */
export async function pairLocally(
  rawHost: string,
  signal?: AbortSignal,
): Promise<ClaimResult> {
  const host = normaliseHost(rawHost);
  const userId = getBrowserId();
  let resp: Response;
  try {
    resp = shouldUseProxy()
      ? await fetch(`/api/lan-pair/claim`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ host, userId }),
          signal: withTimeoutSignal(FETCH_TIMEOUT_MS, signal ?? null),
        })
      : await fetch(`${host}/api/pairing/claim`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ user_id: userId }),
          signal: withTimeoutSignal(FETCH_TIMEOUT_MS, signal ?? null),
        });
  } catch (e) {
    // Nothing answered (DNS failure, refused connection, the 8 s timeout).
    // An operator-triggered abort is not a failure and is re-thrown untouched.
    if (signal?.aborted) throw e;
    throw pairFailureFromResponse("claim", host, { status: 0 }, null);
  }
  if (resp.status === 409) {
    throw new AgentAlreadyPairedError();
  }
  if (!resp.ok) {
    // The agent distinguishes "wrong credential" (401) from "PIN not set"
    // (403) from "out of entropy" / "disk full" (500 with a detail sentence).
    // Every one of those used to render as "Pair failed: 500 Internal Server
    // Error"; the matrix turns each into a message with its own next action.
    throw pairFailureFromResponse("claim", host, resp, await safeJson(resp));
  }
  const body = (await resp.json()) as Record<string, unknown>;
  return {
    apiKey: String(body.api_key ?? ""),
    deviceId: String(body.device_id ?? ""),
    name: String(body.name ?? "ADOS Agent"),
    mdnsHost: String(body.mdns_host ?? ""),
    hostname: host,
  };
}
