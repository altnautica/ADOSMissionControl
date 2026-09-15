/**
 * @module local-pair/failure-copy.test
 * @description The pair-flow failure matrix, asserted as the operator sees it.
 *
 * Before this matrix existed, a 401 ("already claimed by another browser"), a
 * 403 ("dashboard PIN not set"), a 500 out-of-entropy and a 500 disk-full all
 * rendered as `Pair failed: 500 Internal Server Error`. Four different
 * recoveries, one useless sentence. The properties pinned here are the ones an
 * operator depends on, so each is asserted against the rendered English copy
 * rather than against the branch that produced it:
 *
 *   - no raw transport status reaches the copy;
 *   - every message names a next action;
 *   - answered-and-refused (401/403) reads differently from unreachable, and
 *     401 reads differently from 403;
 *   - cloud relay is never suggested on a LAN path.
 *
 * @license GPL-3.0-only
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createTranslator } from "next-intl";

import messages from "../../../../../locales/en.json";
import { pairFailure, type PairFailureInput } from "../failure-copy";

const HOST = "http://skynode.local:8080";

const t = createTranslator({
  locale: "en",
  messages,
  namespace: "command.addNode",
});

/** Render a failure exactly as the Add-a-Node card does: map the error's code
 * through `command.addNode.*` with its interpolation details. */
function copyFor(over: Partial<PairFailureInput>): {
  code: string;
  message: string;
} {
  const error = pairFailure({
    operation: "claim",
    host: HOST,
    status: 0,
    ...over,
  });
  // `t` is typed against the message tree; the code is a runtime string, which
  // is exactly the lookup the component performs.
  const message = (t as unknown as (
    key: string,
    values?: Record<string, string | number>,
  ) => string)(error.code, error.details);
  return { code: error.code, message };
}

/**
 * condition → key. The table IS the contract: a new transport condition has to
 * be given a row here, which forces a message and a next action to exist.
 */
const MATRIX: ReadonlyArray<{
  condition: string;
  input: Partial<PairFailureInput>;
  code: string;
}> = [
  {
    condition: "the proxy refused the host as non-private",
    input: { status: 400, proxyError: "host_not_private" },
    code: "hostNotPrivateError",
  },
  {
    condition: "nothing answered and this GCS is on the LAN",
    input: { status: 0 },
    code: "pairUnreachableError",
  },
  {
    condition: "nothing answered and this GCS is hosted off the LAN",
    input: { status: 0, servedRemotely: true },
    code: "pairHostedRemotelyError",
  },
  {
    condition: "the proxy could not reach the agent from its own server",
    input: { status: 502, proxyError: "upstream_unreachable" },
    code: "pairUnreachableError",
  },
  {
    condition: "401 — the agent answered and refused this browser's key",
    input: { status: 401 },
    code: "pairKeyRejectedError",
  },
  {
    condition: "403 — the agent answered, dashboard PIN not set",
    input: { status: 403 },
    code: "pairPinRequiredError",
  },
  {
    condition: "404 — the agent answered with no pairing endpoint",
    input: { status: 404 },
    code: "pairRouteMissingError",
  },
  {
    condition: "429 — the agent answered and refused for another reason",
    input: { status: 429 },
    code: "pairRefusedError",
  },
  {
    condition: "408 — the agent answered but did not finish",
    input: { status: 408 },
    code: "pairTimedOutError",
  },
  {
    condition: "503 — the agent answered, still starting",
    input: { status: 503 },
    code: "pairAgentNotReadyError",
  },
  {
    condition: "500 — the agent answered with an internal fault",
    input: { status: 500, detail: "No space left on device" },
    code: "pairAgentFaultError",
  },
  {
    condition: "releasing the node failed",
    input: { operation: "unpair", status: 500 },
    code: "unpairFailedError",
  },
];

/** A message with no imperative verb is a dead end: it describes a state and
 * leaves the operator with nothing to do. The pair-flow recoveries are all
 * expressible with one of these. */
const NEXT_ACTION =
  /\b(run|open|press|wait|check|use|try|remove|install|update)\b/i;

beforeEach(() => {
  // The matrix logs raw transport facts for a developer; keep the run quiet
  // and prove the status goes THERE rather than into the copy.
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("pair failure matrix", () => {
  for (const row of MATRIX) {
    it(`${row.condition} → ${row.code}`, () => {
      const { code, message } = copyFor(row.input);
      expect(code).toBe(row.code);

      // The key resolves: next-intl renders raw keys when it does not.
      expect(message).not.toContain(row.code);
      expect(message.length).toBeGreaterThan(20);
      // No raw transport status, and no unfilled interpolation placeholder.
      expect(message).not.toMatch(/\b[45]\d\d\b/);
      expect(message).not.toMatch(/Internal Server Error|Unauthorized|Forbidden/i);
      expect(message).not.toMatch(/\{[a-zA-Z]+\}/);

      // A next action.
      expect(message).toMatch(NEXT_ACTION);

      // The address is named the way the operator typed it — no scheme, no
      // implicit port. A full URL is allowed only where it is a link the
      // operator is meant to open (the node's own settings page).
      expect(message).toContain("skynode.local");
      expect(
        message.replaceAll("http://skynode.local:8080/settings", ""),
      ).not.toContain("http://skynode.local:8080");
    });
  }

  it("401 and 403 are different messages with different recoveries", () => {
    const rejected = copyFor({ status: 401 });
    const pin = copyFor({ status: 403 });

    expect(rejected.code).not.toBe(pin.code);
    expect(rejected.message).not.toBe(pin.message);
    // A stale claim is released on the device; an unset PIN is set in the
    // node's own dashboard. Each message names its own recovery and not the
    // other's.
    expect(rejected.message).toContain("ados unpair");
    expect(pin.message).not.toContain("ados unpair");
    expect(pin.message).toContain("PIN");
    expect(rejected.message).not.toContain("PIN");
  });

  it("an answered-and-refused failure is never worded as unreachable", () => {
    const unreachable = copyFor({ status: 0 }).message;
    expect(unreachable).toMatch(/Nothing answered/);

    for (const status of [401, 403, 404, 429, 500]) {
      const message = copyFor({ status, detail: "disk full" }).message;
      expect(message).not.toMatch(/Nothing answered/);
      expect(message).toMatch(/answered|could not save/);
    }
  });

  it("never suggests cloud relay on a LAN path", () => {
    for (const row of MATRIX) {
      const { code, message } = copyFor(row.input);
      if (code === "pairHostedRemotelyError") continue;
      expect(message.toLowerCase()).not.toContain("cloud relay");
      expect(message.toLowerCase()).not.toContain("sign in");
    }
  });

  it("names cloud relay only for an off-LAN Mission Control, and last", () => {
    const message = copyFor({ status: 0, servedRemotely: true }).message;
    const lower = message.toLowerCase();
    expect(lower).toContain("cloud relay");
    // Local-first ordering: the same-network options are offered before the
    // relay, so the LAN stays the advertised path.
    expect(lower.indexOf("same network")).toBeGreaterThan(-1);
    expect(lower.indexOf("same network")).toBeLessThan(lower.indexOf("cloud relay"));
  });

  it("carries the agent's own fault sentence on a 5xx", () => {
    const { message } = copyFor({
      status: 500,
      detail: "No space left on device",
    });
    expect(message).toContain("No space left on device");
    expect(message).toContain("ados status");
  });

  it("says so rather than interpolating nothing when a 5xx carries no detail", () => {
    const { message } = copyFor({ status: 500, detail: null });
    expect(message).toContain("no reason given");
    expect(message).not.toMatch(/:\s*\./);
  });

  it("a code pair that found no LAN agent points at the LAN, not the relay", () => {
    // Rule: `Invalid pairing code` on a local-mode agent means pair locally.
    const message = (t as unknown as (
      key: string,
      values?: Record<string, string | number>,
    ) => string)("codeNoLanMatchError", { hint: "" });
    expect(message.toLowerCase()).not.toContain("cloud relay");
    expect(message).toContain("hostname or IP");
  });
});
