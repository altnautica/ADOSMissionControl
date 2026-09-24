/**
 * @module command/settings/settings-nav.radio-page.test
 * @description The radio half of the node config moved off the Video page onto
 * its own page, and then merged INTO the live air-side Link page as its Setup
 * segment — one sidebar row per subsystem rather than two whose labels differ
 * by a suffix. Two things must hold: the pair still resolves in the Radio &
 * link section (a drone gets one row, a ground station whose live radio is a
 * top-level tab gets the config page on its own), and the page is offered only
 * to a node that actually carries a radio. A workstation seeing it is the
 * regression.
 *
 * Its id is `radio-config`: the live Link page owns `radio`.
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
    nodeDeviceId: "drone-1",
    relayReach: null,
    profile,
    // Advertise the blocks the swarm gate checks so the only variable
    // under test is the profile.
    config: { swarm: {}, video: { wfb: {} } },
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
  it("places the radio config with the live Link surface it merges into", () => {
    const section = NAV_SECTIONS.find((s) => s.key === "radioLink");
    if (!section) throw new Error("no Radio & link section");
    const link = section.items.indexOf("radio");
    expect(link).toBeGreaterThanOrEqual(0);
    expect(section.items[link + 1]).toBe("radio-config");
  });

  it("declares the radio config as the Setup half of the live Link page", () => {
    const item = SETTINGS_NAV_ITEMS.find((i) => i.id === "radio-config");
    expect(item?.mergeInto).toBe("radio");
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
