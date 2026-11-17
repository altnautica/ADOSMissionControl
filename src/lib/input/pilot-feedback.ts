/**
 * @module input/pilot-feedback
 * @description One surface's controller rumble from its pilot-state stream,
 * by the shared rule table (`@/lib/hud/pilot-feedback`, `ds4.json`
 * `feedback`). Each pilot state (the raw snake_case wire object) is compared
 * with the previous one this surface saw; the first state seen, and the first
 * after the surface lost the pilot state, earns nothing. The class names the
 * rumble pattern (`ds4.json` `rumble`).
 *
 * @license GPL-3.0-only
 */

import { feedbackAlert, type FeedbackClass } from "@/lib/hud/pilot-feedback";

export class PilotFeedback {
  private prev: unknown = null;

  /** A new pilot state: the rumble pattern to play, or null. */
  update(state: unknown): FeedbackClass | null {
    const prev = this.prev;
    this.prev = state;
    return feedbackAlert(prev, state);
  }

  /** The surface lost the pilot state: the pattern to play once, or null. */
  lost(): FeedbackClass | null {
    const prev = this.prev;
    this.prev = null;
    return feedbackAlert(prev, null);
  }
}
