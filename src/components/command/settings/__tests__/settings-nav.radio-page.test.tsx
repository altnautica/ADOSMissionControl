/**
 * @module command/settings/settings-nav.radio-page.test
 * @description The radio half of the node config moved off the Video page onto
 * its own Radio page. Two things must hold for that split to be real: the Radio
 * page sits directly under the live air-side Link surface in the Agent sidebar's
 * Link & network section (so the page that configures the radio is one row below
 * the page that shows it), and it is offered only to a node that actually
 * carries a radio. A workstation seeing a Radio page — or Radio drifting away
 * from Link on the next insert — is the regression.
 *
 * Its id is `radio-config`: the live Link surface owns `radio`, and both now
 * live in one sidebar.
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("next-intl", () => ({ useTranslations: () => (k: string) => k }));

import { NAV_SECTIONS } from "@/components/dashboard/node-detail/agent/agent-nav-sections";
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
  it("places the radio config directly under the live Link surface", () => {
    const network = NAV_SECTIONS.find((s) => s.key === "network");
    if (!network) throw new Error("no Link & network section");
    const link = network.items.indexOf("radio");
    expect(link).toBeGreaterThanOrEqual(0);
    expect(network.items[link + 1]).toBe("radio-config");
  });

  it("offers the radio page to a drone and a ground station", () => {
    expect(visibleIds("drone")).toContain("radio-config");
    expect(visibleIds("ground-station")).toContain("radio-config");
  });

  it("omits the radio page on a workstation, which carries no radio", () => {
    expect(visibleIds("workstation")).not.toContain("radio-config");
  });

  it("stops offering the video page to a ground station now that the radio block left it", () => {
    // VideoSection renders camera + encode config only; a ground station
    // encodes nothing, so an offered page would be blank.
    expect(visibleIds("drone")).toContain("video");
    expect(visibleIds("ground-station")).not.toContain("video");
  });
});
