/**
 * @module command/system/rf-link-reading
 * @description Resolves the RF-link reading shown on the radio health panel.
 *
 * Two things can answer "did this transmit path ever reach anyone": the radio's
 * own verdict, and a guess this app makes from the transmit flag and the
 * channel lock. They are not equal. The radio pairs its transmit counter with a
 * return signal over a grace window; the guess substitutes channel-acquisition
 * state, which describes a different question and can disagree even when both
 * are present.
 *
 * So the radio's verdict wins whenever it exists, and the guess runs only when
 * the radio reports no verdict at all. The resolved reading carries which of
 * the two it came from, so the panel can say so rather than presenting an
 * inference as a measurement.
 *
 * @license GPL-3.0-only
 */

/** Where a resolved reading came from. */
export type RfVerdictSource = "reported" | "inferred";

export interface RfLinkReading {
  /** True when the transmit path is transmitting with no reception proven. */
  unverified: boolean;
  source: RfVerdictSource;
}

export interface RfLinkInputs {
  /**
   * The radio's own verdict. Null or undefined means no verdict — the node
   * did not report one, or has no radio view to report from. It is NOT a
   * proven false.
   */
  reported: boolean | null | undefined;
  /** True when the transmit byte counter is advancing. */
  txActive: boolean;
  /** Ground-side channel-acquirer mode, null when not reported. */
  acquireState: string | null;
  /** Channel-acquirer lock flag, null when not reported. */
  channelLocked: boolean | null;
  /**
   * True when the newest transmit-proof episode in the durable event feed is
   * an entry rather than a clear. This is the radio's own signal too, but it
   * is history: it says an episode happened, not that one is happening now.
   */
  eventUnverified: boolean;
}

export function resolveRfLink(inputs: RfLinkInputs): RfLinkReading {
  if (typeof inputs.reported === "boolean") {
    return { unverified: inputs.reported, source: "reported" };
  }
  // No verdict from the radio. Fall back to the older inference: transmitting
  // while the channel acquirer has not locked. Reinforced by the newest
  // episode in the event feed so a node that reported an entry and then went
  // quiet does not read as healthy.
  const live =
    inputs.txActive &&
    inputs.acquireState !== "locked" &&
    inputs.channelLocked !== true;
  return { unverified: live || inputs.eventUnverified, source: "inferred" };
}
