/**
 * @module command/swarm-view/swarm-bulk-actions.test
 * @description What the fleet action bar is allowed to offer.
 *
 * Arming is the one action whose blast radius GROWS with the selection: every
 * other bulk verb makes a fleet safer the wider it reaches, and arm makes it
 * more dangerous. The nodes board wrote that law into its own bulk bar and it
 * holds harder at twenty-four slots than at three, so it is pinned rather than
 * left to whoever next edits the list.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";

import { SWARM_BULK_SKILL_IDS } from "../SwarmActionBar";

describe("SWARM_BULK_SKILL_IDS", () => {
  it("never offers arm, disarm or the kill switch in bulk", () => {
    for (const forbidden of ["arm", "disarm", "kill"]) {
      expect(SWARM_BULK_SKILL_IDS).not.toContain(forbidden);
    }
  });
});
