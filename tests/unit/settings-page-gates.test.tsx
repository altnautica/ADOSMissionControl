/**
 * The availability gates on the node configuration pages, which now sit directly
 * in the Agent page's single sidebar. A gate is what stops the sidebar offering a
 * page that would render blank, so each one is pinned against the two inputs it
 * reads: the node's profile, and whether the node's own config surface
 * advertises the feature block.
 *
 * One of these ids was renamed when the pages were hoisted (`radio` ->
 * `radio-config`) because the live Link surface owns the original in the same
 * sidebar.
 *
 * @license GPL-3.0-only
 */

import { describe, expect, it } from "vitest";

import {
  SETTINGS_NAV_ITEMS,
  type SettingsPageContext,
} from "@/components/command/settings/settings-nav";

function ctxWith(overrides: Partial<SettingsPageContext>): SettingsPageContext {
  return {
    droneId: "node:dev-1",
    nodeDeviceId: "dev-1",
    relayReach: null,
    profile: "drone",
    config: null,
    readOnly: false,
    setValue: async () => {},
    ...overrides,
  };
}

function gate(id: string) {
  const item = SETTINGS_NAV_ITEMS.find((i) => i.id === id);
  if (!item) throw new Error(`no nav item ${id}`);
  return item.when ?? (() => true);
}

describe("settings page availability gates", () => {
  it("hides the feature pages a node does not advertise", () => {
    const bare = ctxWith({ config: {} });
    expect(gate("swarm")(bare)).toBe(false);

    const advertised = ctxWith({ config: { swarm: {} } });
    expect(gate("swarm")(advertised)).toBe(true);
  });

  it("keeps the profile fits the pages already enforce", () => {
    const ws = ctxWith({ profile: "workstation", config: {} });
    expect(gate("video")(ws)).toBe(false);
    // The detector model is a drone page; serving belongs to an extension.
    expect(gate("vision-perception")(ws)).toBe(false);
    // A workstation carries no radio, so neither fleet-radio page appears.
    expect(gate("radio-config")(ws)).toBe(false);

    const gs = ctxWith({ profile: "ground-station" });
    // Video is the camera + encode page of a node that actually encodes. A
    // ground station relays video it never encodes, and every `video.wfb.*`
    // field it does own moved to the Radio page — so Video is drone-only and
    // Radio is what a ground station is offered instead.
    expect(gate("video")(gs)).toBe(false);
    expect(gate("radio-config")(gs)).toBe(true);
    expect(gate("vision-perception")(gs)).toBe(false);
  });
});
