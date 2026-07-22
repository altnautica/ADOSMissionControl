/**
 * The RF-link reading must prefer the radio's own transmit-proof verdict over
 * the inference this app makes from the transmit flag and the channel lock.
 * The two answer different questions and can disagree, so a test that only
 * covered the agreeing case would not pin the preference at all.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";
import {
  resolveRfLink,
  type RfLinkInputs,
} from "@/components/command/system/rf-link-reading";

/** Inputs whose inference would read UNVERIFIED: transmitting, never locked. */
const INFERS_UNVERIFIED: RfLinkInputs = {
  reported: null,
  txActive: true,
  acquireState: "searching",
  channelLocked: false,
  eventUnverified: false,
};

/** Inputs whose inference would read PROVEN: transmitting and locked. */
const INFERS_PROVEN: RfLinkInputs = {
  reported: null,
  txActive: true,
  acquireState: "locked",
  channelLocked: true,
  eventUnverified: false,
};

describe("resolveRfLink prefers the reported verdict", () => {
  it("takes a reported true even when the inference would read proven", () => {
    const r = resolveRfLink({ ...INFERS_PROVEN, reported: true });
    expect(r).toEqual({ unverified: true, source: "reported" });
  });

  it("takes a reported false even when the inference would read unverified", () => {
    const r = resolveRfLink({ ...INFERS_UNVERIFIED, reported: false });
    expect(r).toEqual({ unverified: false, source: "reported" });
  });

  it("takes a reported false over a stale unverified episode in the feed", () => {
    const r = resolveRfLink({
      ...INFERS_UNVERIFIED,
      reported: false,
      eventUnverified: true,
    });
    expect(r).toEqual({ unverified: false, source: "reported" });
  });
});

describe("resolveRfLink falls back only when there is no verdict", () => {
  it("infers unverified from a transmitting, unlocked link", () => {
    expect(resolveRfLink(INFERS_UNVERIFIED)).toEqual({
      unverified: true,
      source: "inferred",
    });
  });

  it("infers proven from a transmitting, locked link", () => {
    expect(resolveRfLink(INFERS_PROVEN)).toEqual({
      unverified: false,
      source: "inferred",
    });
  });

  it("infers proven when the link is not transmitting at all", () => {
    expect(
      resolveRfLink({ ...INFERS_UNVERIFIED, txActive: false }),
    ).toEqual({ unverified: false, source: "inferred" });
  });

  it("reinforces the inference from the newest unverified episode", () => {
    const r = resolveRfLink({ ...INFERS_PROVEN, eventUnverified: true });
    expect(r).toEqual({ unverified: true, source: "inferred" });
  });

  it("treats an undefined verdict the same as an explicit null", () => {
    const withNull = resolveRfLink({ ...INFERS_UNVERIFIED, reported: null });
    const withUndefined = resolveRfLink({
      ...INFERS_UNVERIFIED,
      reported: undefined,
    });
    expect(withUndefined).toEqual(withNull);
    expect(withUndefined.source).toBe("inferred");
  });

  it("does not read an absent lock reading as a lock", () => {
    const r = resolveRfLink({
      ...INFERS_UNVERIFIED,
      acquireState: null,
      channelLocked: null,
    });
    expect(r).toEqual({ unverified: true, source: "inferred" });
  });
});
