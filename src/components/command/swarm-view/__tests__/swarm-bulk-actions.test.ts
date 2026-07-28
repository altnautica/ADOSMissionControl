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

import { SWARM_FORMATIONS } from "@/lib/swarm/config-keys";
import { SWARM_BULK_SKILL_IDS } from "../SwarmActionBar";

describe("SWARM_BULK_SKILL_IDS", () => {
  it("offers hold, return-to-launch and land", () => {
    expect([...SWARM_BULK_SKILL_IDS]).toEqual(["pause", "rth", "land"]);
  });

  it("never offers arm, disarm or the kill switch in bulk", () => {
    for (const forbidden of ["arm", "disarm", "kill"]) {
      expect(SWARM_BULK_SKILL_IDS).not.toContain(forbidden);
    }
  });
});

describe("fleet formation options", () => {
  it("offers exactly the agent's closed built-in set", () => {
    // A formation outside this set is rejected by the agent's config model, so
    // offering one would be a control that cannot work.
    expect([...SWARM_FORMATIONS]).toEqual([
      "line",
      "column",
      "wedge",
      "grid",
      "circle",
    ]);
  });
});
