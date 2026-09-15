/**
 * @module command/settings/settings-nav.display-page.test
 * @description `ground_station.display.type` decides which renderer a ground
 * station brings up at boot, and the display service gates its startup on it —
 * so a wrong value leaves the box with no local UI, which is the UI an operator
 * uses to recover a node whose network is down.
 *
 * It used to have no home in the node-configuration IA at all: no settings page
 * covered `ground_station.*`, so the only way to change it was a bespoke picker
 * on a hardware card. This pins that it now has a registered page, in the System
 * section, offered only to the profile that has a local display to configure.
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("next-intl", () => ({ useTranslations: () => (k: string) => k }));

import { NAV_SECTIONS } from "@/components/dashboard/node-detail/agent/agent-nav-sections";
import { SETTINGS_NAV_ITEMS, type SettingsPageContext } from "../settings-nav";
import type { NodeProfile } from "@/components/dashboard/node-detail/surface-types";

function ctxFor(profile: NodeProfile): SettingsPageContext {
  return {
    droneId: "gs-1",
    nodeDeviceId: "gs-1",
    relayReach: null,
    profile,
    config: { ground_station: { display: { type: "auto" }, kiosk: {} } },
    readOnly: false,
    setValue: async () => {},
  };
}

function visibleIds(profile: NodeProfile): string[] {
  return SETTINGS_NAV_ITEMS.filter((i) =>
    i.when ? i.when(ctxFor(profile)) : true,
  ).map((i) => i.id);
}

describe("settings-nav display page", () => {
  it("offers the display page to a ground station", () => {
    expect(visibleIds("ground-station")).toContain("display");
  });

  it("omits it on every profile with no local display to configure", () => {
    expect(visibleIds("drone")).not.toContain("display");
    expect(visibleIds("workstation")).not.toContain("display");
  });

  it("lives in the System section, ahead of the other system pages", () => {
    const system = NAV_SECTIONS.find((s) => s.key === "system");
    if (!system) throw new Error("no System section");
    expect(system.items).toContain("display");
    expect(system.items.indexOf("display")).toBeLessThan(
      system.items.indexOf("security"),
    );
  });

  it("reads the node configuration, so the config banners apply to it", () => {
    // It writes `ground_station.display.type` and the kiosk keys through
    // PUT /api/config, so a read failure is a real reason to warn the operator
    // before they touch a boot-critical value.
    const item = SETTINGS_NAV_ITEMS.find((i) => i.id === "display");
    expect(item?.readsConfig).toBe(true);
  });
});
