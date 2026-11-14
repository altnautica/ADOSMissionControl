/**
 * @module cockpit/flight/follow-prompt-edge
 * @description Where the follow waiting prompt ends, so the critical alert
 * banners stack under it instead of painting over its title. The follow dock
 * writes the prompt's bottom edge (flight-screen pixels) while the prompt
 * shows and clears it when the prompt goes; the alert stack starts below it.
 *
 * @license GPL-3.0-only
 */

import { create } from "zustand";

interface FollowPromptEdge {
  /** The prompt's bottom edge, or null with no prompt up. */
  bottomPx: number | null;
}

export const useFollowPromptEdge = create<FollowPromptEdge>()(() => ({ bottomPx: null }));
