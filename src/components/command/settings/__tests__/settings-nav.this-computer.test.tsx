/**
 * @module command/settings/__tests__/settings-nav.this-computer
 * @description A ground station on somebody's own computer runs a smaller
 * service set than one on a dedicated box: no access point, no HDMI kiosk, no
 * status panel, no uplink router. Those pages must not be offered there (they
 * would present settings the node never applies), and the "This computer" page
 * must appear in their place — only on a personal ground station, never on an
 * appliance and never on another profile.
 * @license GPL-3.0-only
 */

import { describe, expect, it } from "vitest";

import type { NodeProfile } from "@/lib/nodes/node-profile";
import {
  SETTINGS_NAV_ITEMS,
  type SettingsPageContext,
} from "../settings-nav";

function ctx(
  profile: NodeProfile,
  hostKind: SettingsPageContext["hostKind"],
): SettingsPageContext {
  return {
    droneId: "node:gs-1",
    nodeDeviceId: "gs-1",
    relayReach: null,
    profile,
    hostKind,
    config: { ground_station: { display: { type: "auto" } } },
    readOnly: false,
    setValue: async () => {},
    demoMode: false,
  };
}

function visibleIds(c: SettingsPageContext): string[] {
  return SETTINGS_NAV_ITEMS.filter((i) => i.when?.(c) ?? true).map((i) => i.id);
}

describe("settings pages on a personal ground station", () => {
  it("hides the access point, uplink and display pages", () => {
    const ids = visibleIds(ctx("ground-station", "personal"));
    expect(ids).not.toContain("network");
    expect(ids).not.toContain("display");
  });

  it("offers This computer instead", () => {
    expect(visibleIds(ctx("ground-station", "personal"))).toContain(
      "this-computer",
    );
  });

  it("keeps every page on an appliance", () => {
    const ids = visibleIds(ctx("ground-station", "appliance"));
    expect(ids).toContain("network");
    expect(ids).toContain("display");
    expect(ids).not.toContain("this-computer");
  });

  it("shows This computer on no other profile", () => {
    for (const profile of [
      "drone",
      "workstation",
      "compute",
      "visor",
    ] as NodeProfile[]) {
      expect(visibleIds(ctx(profile, "personal"))).not.toContain(
        "this-computer",
      );
    }
  });
});
