/**
 * @module agent/local-pair/failure-copy
 * @description The single operator-facing failure matrix for the pair flow.
 *
 * Every probe / claim / unpair failure lands here and leaves as a
 * `PairClientError` carrying an i18n key under `command.addNode.*`. Four rules
 * the matrix exists to enforce:
 *
 *  1. **No raw transport status reaches the operator.** `"Pair failed: 500
 *     Internal Server Error"` told an operator nothing and could not be acted
 *     on. The status and the agent's own status text are logged to the console
 *     for a developer and never interpolated into copy. The one exception is
 *     the agent's `detail` string on a 5xx, which names the actual fault
 *     ("no space left on device") and is the whole point of that branch.
 *  2. **Every message names a next action.** The operator always leaves with
 *     something to press, type, or run.
 *  3. **Answered-and-refused is not unreachable.** A 401 and a 403 mean the
 *     agent is up, on the network, and talking — it declined. Those read
 *     completely differently from "nothing answered", and the recovery is
 *     completely different too: a 401 is a stale claim held by another browser
 *     (`ados unpair`), a 403 is an unset dashboard PIN.
 *  4. **No cloud-relay advice on a LAN path.** An agent on the operator's own
 *     network is reached over the LAN; suggesting cloud relay there sends them
 *     through a sign-in flow to solve a local problem. Cloud relay is named in
 *     exactly one branch — a Mission Control hosted off the operator's network,
 *     where the LAN hop provably cannot exist — and even there the local
 *     options come first.
 *
 * @license GPL-3.0-only
 */

import { PairClientError } from "./errors";

/** Which half of the pair flow failed. Selects the unpair-specific copy; probe
 * and claim share the matrix because the operator-visible condition (and the
 * recovery) is identical for both. */
export type PairOperation = "probe" | "claim" | "unpair";

export interface PairFailureInput {
  operation: PairOperation;
  /** The base URL the call was made against, as `normaliseHost` produced it
   * (e.g. `http://skynode.local:8080`). */
  host: string;
  /** HTTP status the agent answered with, or 0 when nothing answered at all
   * (DNS failure, connection refused, timeout, the proxy's own 502). */
  status: number;
  /** The agent's `statusText`. Logged, never shown. */
  statusText?: string;
  /** `detail` / `message` / `error` from the agent's JSON error body. Shown
   * only on a 5xx, where it names the fault the operator has to clear. */
  detail?: string | null;
  /** The Mission Control proxy's own error code when the proxy failed before
   * reaching the agent (`upstream_unreachable`, `host_not_private`, …). */
  proxyError?: string | null;
  /** True when this Mission Control is served from off the operator's network
   * (https from a non-loopback host), so its server-side proxy hop can never
   * reach a LAN agent. The only branch where cloud relay is honest advice. */
  servedRemotely?: boolean;
}

/**
 * True when this Mission Control's own origin cannot see the operator's LAN:
 * served over https from something that is not loopback. A desktop build, a
 * localhost dev server and a LAN-hosted deployment all read false.
 *
 * Exported as the one definition of "the proxy hop cannot reach a LAN agent"
 * so the probe, claim and unpair paths cannot drift on it.
 */
export function isServedRemotely(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.location.protocol === "https:" &&
    !/^(localhost|127\.|\[?::1\]?)/.test(window.location.hostname)
  );
}

/**
 * Map one transport condition onto the operator-facing failure. Pure.
 *
 * The matrix, in evaluation order:
 *
 * | condition                              | key                        |
 * |----------------------------------------|----------------------------|
 * | proxy refused the host as non-private  | `hostNotPrivateError`      |
 * | releasing a node failed, any cause     | `unpairFailedError`        |
 * | nothing answered, GCS hosted off-LAN   | `pairHostedRemotelyError`  |
 * | nothing answered, GCS on the LAN       | `pairUnreachableError`     |
 * | 401 — answered, key refused            | `pairKeyRejectedError`     |
 * | 403 — answered, dashboard PIN unset    | `pairPinRequiredError`     |
 * | 404 — answered, no pairing endpoint    | `pairRouteMissingError`    |
 * | 408 / 504 — answered, did not finish   | `pairTimedOutError`        |
 * | 502 / 503 — answered, still starting   | `pairAgentNotReadyError`   |
 * | other 5xx — answered, internal fault   | `pairAgentFaultError`      |
 * | other 4xx — answered and refused       | `pairRefusedError`         |
 */
export function pairFailure(input: PairFailureInput): PairClientError {
  // Name the address the way the operator typed it: no scheme, and no port
  // unless it is one they had to choose themselves.
  let host: string;
  try {
    const u = new URL(input.host);
    host =
      u.port === "8080" || u.port === "" ? u.hostname : `${u.hostname}:${u.port}`;
  } catch {
    host = input.host.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  }
  // The agent's surviving web surface: the SPA is mounted at `/` with settings
  // inside it. The standalone wizard pages (`setup.html` and friends) were
  // removed, so no recovery copy may point at one.
  const details: Record<string, string> = {
    host,
    settingsUrl: `${input.host.replace(/\/+$/, "")}/settings`,
  };

  if (input.proxyError === "host_not_private") {
    return new PairClientError(
      "hostNotPrivateError",
      `"${host}" is not an address on your own network.`,
      details,
    );
  }

  // Releasing a node has one recovery regardless of which way it failed: run
  // the CLI release on the device. One message beats inventing five variants
  // of an operation the operator can always finish by hand.
  if (input.operation === "unpair") {
    return new PairClientError(
      "unpairFailedError",
      `Couldn't release ${host} from this browser.`,
      details,
    );
  }

  if (input.status === 0 || input.proxyError === "upstream_unreachable") {
    return input.servedRemotely
      ? new PairClientError(
          "pairHostedRemotelyError",
          `This Mission Control is hosted off your network and cannot reach ${host}.`,
          details,
        )
      : new PairClientError(
          "pairUnreachableError",
          `Nothing answered at ${host}.`,
          details,
        );
  }

  switch (input.status) {
    case 401:
      return new PairClientError(
        "pairKeyRejectedError",
        `${host} refused this browser's key.`,
        details,
      );
    case 403:
      return new PairClientError(
        "pairPinRequiredError",
        `${host} is not accepting pairing until its dashboard PIN is set.`,
        details,
      );
    case 404:
      return new PairClientError(
        "pairRouteMissingError",
        `${host} has no pairing endpoint.`,
        details,
      );
    case 408:
    case 504:
      return new PairClientError(
        "pairTimedOutError",
        `${host} did not finish the request in time.`,
        details,
      );
    case 502:
    case 503:
      return new PairClientError(
        "pairAgentNotReadyError",
        `${host} is still starting up.`,
        details,
      );
    default:
      break;
  }

  if (input.status >= 500) {
    const detail = (input.detail ?? "").trim();
    return new PairClientError(
      "pairAgentFaultError",
      `${host} could not complete the pairing.`,
      // The fault sentence is the agent's own. When it sent none, say so
      // rather than interpolating an empty string into the message.
      { ...details, detail: detail.length > 0 ? detail : "no reason given" },
    );
  }

  return new PairClientError(
    "pairRefusedError",
    `${host} refused the pairing request.`,
    details,
  );
}

/**
 * Build the failure from a response (or a `status: 0` stand-in when the fetch
 * itself threw) plus its already-parsed JSON body, logging the raw transport
 * facts for a developer on the way through. This is the only place the status
 * code is recorded, and it goes to the console — never into copy.
 */
export function pairFailureFromResponse(
  operation: PairOperation,
  host: string,
  resp: { status: number; statusText?: string },
  body: unknown,
): PairClientError {
  const parsed =
    body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  const pick = (key: string): string | null => {
    const value = parsed?.[key];
    return typeof value === "string" && value.length > 0 ? value : null;
  };
  const input: PairFailureInput = {
    operation,
    host,
    status: resp.status,
    statusText: resp.statusText,
    // The agent answers `{detail}`; the Mission Control proxy answers
    // `{error, message}`. Take whichever is present.
    detail: pick("detail") ?? pick("message"),
    proxyError: pick("error"),
    servedRemotely: isServedRemotely(),
  };
  console.warn(`[local-pair] ${operation} failed`, {
    host: input.host,
    status: input.status,
    statusText: input.statusText ?? "",
    proxyError: input.proxyError,
    detail: input.detail,
  });
  return pairFailure(input);
}
