/**
 * @module command/settings/settings-nav.radio-page.test
 * @description The radio half of the node config moved off the Video page onto
 * its own Radio page. Two things must hold for that split to be real: the Radio
 * entry sits immediately before Swarm under Link & network (so the two
 * fleet-radio pages read as one pair), and it is offered only to a node that
 * actually carries a radio. A workstation seeing a Radio page — or Radio
 * drifting to the bottom of the group on the next insert — is the regression.
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("next-intl", () => ({ useTranslations: () => (k: string) => k }));

import {
  SETTINGS_NAV_ITEMS,
  type SettingsPageContext,
} from "../settings-nav";
import type { NodeProfile } from "@/components/dashboard/node-detail/surface-types";

function ctxFor(profile: NodeProfile): SettingsPageContext {
  return {
    droneId: "drone-1",
    profile,
    // Advertise the blocks the swarm/atlas gates check so the only variable
    // under test is the profile.
    config: { swarm: {}, atlas: {}, video: { wfb: {} } },
    readOnly: false,
    setValue: async () => {},
  };
}

function visibleIds(profile: NodeProfile): string[] {
  return SETTINGS_NAV_ITEMS.filter((i) =>
    i.when ? i.when(ctxFor(profile)) : true,
  ).map((i) => i.id);
}

describe("settings-nav radio page", () => {
  it("places radio immediately before swarm in the network group", () => {
    const network = SETTINGS_NAV_ITEMS.filter((i) => i.group === "network").map(
      (i) => i.id,
    );
    const radio = network.indexOf("radio");
    expect(radio).toBeGreaterThanOrEqual(0);
    expect(network[radio + 1]).toBe("swarm");
  });

  it("offers the radio page to a drone and a ground station", () => {
    expect(visibleIds("drone")).toContain("radio");
    expect(visibleIds("ground-station")).toContain("radio");
  });

  it("omits the radio page on a workstation, which carries no radio", () => {
    expect(visibleIds("workstation")).not.toContain("radio");
  });

  it("stops offering the video page to a ground station now that the radio block left it", () => {
    // VideoSection renders camera + encode config only; a ground station
    // encodes nothing, so an offered page would be blank.
    expect(visibleIds("drone")).toContain("video");
    expect(visibleIds("ground-station")).not.toContain("video");
  });
});
