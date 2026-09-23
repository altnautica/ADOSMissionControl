/**
 * @module agent/local-pair/unpair
 * @description The unpair half of the pair flow. POSTs the agent's
 * ``/api/pairing/unpair`` route with the stored API key in the
 * ``X-ADOS-Key`` header and treats already-unpaired / key-drift
 * responses as a soft success so a card can always be forgotten.
 * @license GPL-3.0-only
 */

import { combineSignals, normaliseHost, safeJson, shouldUseProxy } from "./transport";
import { pairFailureFromResponse } from "./failure-copy";

/** POST ``/api/pairing/unpair`` with the stored API key in the header.
 * Bounded by the pair-flow deadline; a request nothing answered maps onto
 * the unreachable copy. An operator-triggered abort is re-thrown untouched. */
export async function unpairLocal(
  hostname: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<void> {
  const host = normaliseHost(hostname);
  let resp: Response;
  try {
    resp = shouldUseProxy()
      ? await fetch(`/api/lan-pair/unpair`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ host, apiKey }),
          signal: combineSignals(signal),
        })
      : await fetch(`${host}/api/pairing/unpair`, {
          method: "POST",
          headers: {
            // The agent's auth middleware reads X-ADOS-Key; every other
            // agent surface uses the same header name.
            "X-ADOS-Key": apiKey,
            Accept: "application/json",
          },
          signal: combineSignals(signal),
        });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw pairFailureFromResponse("unpair", host, { status: 0 }, null);
  }
  // 409 means the agent is already unpaired — the desired end state, so it
  // is a success. 401 means the stored key no longer matches the agent's
  // current credential (key drift after a re-pair on the device, or a
  // stale browser record); the browser is dropping the credential anyway,
  // so treat it as a soft success and warn rather than blocking forget and
  // leaving the operator with a card it can never remove.
  if (resp.status === 401) {
    console.warn(
      "[local-pair] unpair returned 401 (key drift); forgetting the node anyway",
    );
    return;
  }
  if (!resp.ok && resp.status !== 409) {
    throw pairFailureFromResponse("unpair", host, resp, await safeJson(resp));
  }
}
