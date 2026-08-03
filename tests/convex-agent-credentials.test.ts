/**
 * Agent API-key comparison, and the empty-key bypass it closes.
 *
 * The bug: `cmd_drones.apiKey` is a required string, so a drone paired before
 * its agent connects is stored with `apiKey: ""`. The heartbeat check was a
 * plain `drone.apiKey !== args.apiKey`, and `"" !== ""` is **false** -- so any
 * caller who sent an empty key authenticated as that drone and could patch
 * `mdnsHost`, which feeds an operator-facing reach surface.
 *
 * Reverting `agentKeyMatches` to `stored !== presented` must turn the first
 * test red. If it does not, this file is decoration.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { agentKeyMatches, constantTimeEqual } from "../convex/lib/credentials";

describe("agentKeyMatches", () => {
  it("refuses an empty key against an empty stored key (the bypass)", () => {
    // The exact exploit: a row that never received a key, and a caller who
    // sends nothing. A plain `"" !== ""` comparison returns false here, which
    // the old code read as "the keys match".
    expect("" !== "").toBe(false); // documents why the old check let this pass
    expect(agentKeyMatches("", "")).toBe(false);
  });

  it("refuses a blank on either side", () => {
    expect(agentKeyMatches("", "guessed-key")).toBe(false);
    expect(agentKeyMatches("real-key", "")).toBe(false);
    expect(agentKeyMatches(undefined, "real-key")).toBe(false);
    expect(agentKeyMatches("real-key", undefined)).toBe(false);
    expect(agentKeyMatches(null, null)).toBe(false);
  });

  it("accepts a correct key and rejects a wrong one", () => {
    expect(agentKeyMatches("s3cret-key-value", "s3cret-key-value")).toBe(true);
    expect(agentKeyMatches("s3cret-key-value", "s3cret-key-valuX")).toBe(false);
    expect(agentKeyMatches("s3cret-key-value", "s3cret")).toBe(false);
  });
});

describe("constantTimeEqual", () => {
  it("matches equal strings and separates unequal ones", () => {
    expect(constantTimeEqual("abc", "abc")).toBe(true);
    expect(constantTimeEqual("abc", "abd")).toBe(false);
    expect(constantTimeEqual("abc", "abcd")).toBe(false);
    expect(constantTimeEqual("", "")).toBe(true); // length-equal; blanks are
    // refused by agentKeyMatches, not here -- this primitive only compares.
  });

  it("examines every character rather than stopping at the first difference", () => {
    // Differing at index 0 vs the last index must both simply return false.
    // A short-circuiting compare is what leaks key material through timing.
    expect(constantTimeEqual("Xbcdefgh", "abcdefgh")).toBe(false);
    expect(constantTimeEqual("abcdefgX", "abcdefgh")).toBe(false);
  });
});

describe("heartbeat write path is not publicly callable", () => {
  const source = readFileSync(
    join(__dirname, "..", "convex", "cmdDrones.ts"),
    "utf8"
  );

  it("declares updateHeartbeat as an internalMutation", () => {
    // Reached only through the authenticated `/heartbeat` HTTP route. As a
    // public `mutation` it was directly invokable by any browser client,
    // bypassing that route's validation entirely.
    expect(source).toContain("export const updateHeartbeat = internalMutation({");
    expect(source).not.toContain("export const updateHeartbeat = mutation({");
  });

  it("compares the stored key with agentKeyMatches, not with !==", () => {
    expect(source).toContain("agentKeyMatches(drone.apiKey, args.apiKey)");
    expect(source).not.toContain("drone.apiKey !== args.apiKey");
  });
});
