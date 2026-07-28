/**
 * @module node-detail/agent-nav-sections.test
 * @description The Agent page ships ONE sidebar assembled from two registries,
 * so the merged table is what can silently break: a page named in no section
 * disappears from the product with nothing failing, an id claimed by both
 * registries shadows one of them (this is exactly why the settings Radio and
 * World model pages were renamed), and a section whose every page a profile
 * gates away must not render a bare header. These pin the shipped six-section
 * order and those three failure modes.
 * @license GPL-3.0-only
 */

import { describe, expect, it } from "vitest";

import {
  NAV_SECTIONS,
  resolveAgentNav,
} from "@/components/dashboard/node-detail/agent/agent-nav-sections";
import { AGENT_NAV_ITEMS } from "@/components/dashboard/node-detail/agent/agent-nav-items";
import {
  SETTINGS_NAV_ITEMS,
  type SettingsPageContext,
} from "@/components/command/settings/settings-nav";
import type {
  NodeProfile,
  SurfaceContext,
} from "@/components/dashboard/node-detail/surface-types";

/** A companion-backed node with every optional capability present, so every
 *  gate that CAN open is open and the resolved sidebar is the complete list. */
function ctxFor(
  profile: NodeProfile,
  over: Partial<SurfaceContext> = {},
): SurfaceContext {
  return {
    droneId: "node:d1",
    drone: { profile } as SurfaceContext["drone"],
    displayName: "d1",
    isConnected: true,
    firmwareType: null,
    agentDeviceId: "dev-1",
    agentIdentityKnown: true,
    relayReach: null,
    fcLinking: false,
    radioPresent: true,
    visionPresent: true,
    crsfPresent: true,
    role: "drone" as SurfaceContext["role"],
    showLockedTabs: false,
    isFeatureEnabled: () => true,
    atlasCapturing: true,
    ...over,
  };
}

/** A loaded config advertising every optional feature block. */
function settingsCtxFor(profile: NodeProfile): SettingsPageContext {
  return {
    droneId: "node:d1",
    profile,
    config: { swarm: {}, atlas: {}, video: { wfb: {} } },
    readOnly: false,
    setValue: async () => {},
  };
}

const nav = (profile: NodeProfile, over: Partial<SurfaceContext> = {}) =>
  resolveAgentNav(ctxFor(profile, over), settingsCtxFor(profile));

describe("the merged Agent sidebar table", () => {
  it("places every registry page in exactly one section, and names no page that does not exist", () => {
    const placed = NAV_SECTIONS.flatMap((s) => s.items);
    const registered = [
      ...AGENT_NAV_ITEMS.map((i) => i.id),
      ...SETTINGS_NAV_ITEMS.map((i) => i.id),
    ];
    expect([...placed].sort()).toEqual([...registered].sort());
  });

  it("lets no id be claimed by both registries", () => {
    const agentIds = AGENT_NAV_ITEMS.map((i) => i.id);
    const settingsIds = SETTINGS_NAV_ITEMS.map((i) => i.id);
    expect(settingsIds.filter((id) => agentIds.includes(id))).toEqual([]);

    // The two renames that made the flattening possible. The agent ids keep
    // their values because each matches a retired top-level surface id that a
    // persisted or deep-linked tab still resolves through.
    expect(agentIds).toContain("radio");
    expect(agentIds).toContain("world-model");
    expect(settingsIds).toContain("radio-config");
    expect(settingsIds).toContain("world-model-config");
  });
});

describe("resolveAgentNav", () => {
  it("puts each live surface beside the configuration for the same subsystem, in the shipped order", () => {
    const { sections } = nav("drone");
    expect(sections.map((s) => s.key)).toEqual([
      "overview",
      "network",
      "videoVision",
      "cloud",
      "system",
      "software",
    ]);
    expect(sections.map((s) => s.items.map((i) => i.id))).toEqual([
      ["system", "profile"],
      [
        "radio",
        "radio-config",
        "network",
        "wifi",
        "cellular",
        "mac-pin",
        "discovery",
        "mavlink",
        "swarm",
      ],
      [
        "cameras",
        "video",
        "vision",
        "vision-perception",
        "world-model",
        "world-model-config",
        "live-world",
      ],
      ["cloud"],
      ["region", "self-heal", "security", "advanced"],
      ["plugins", "logs"],
    ]);
  });

  it("omits a section outright when a profile's gates close every page in it", () => {
    // A ground station encodes no video and runs no perception, so every page
    // under Video & vision is gated away — the header must not render alone.
    const { sections } = nav("ground-station");
    expect(sections.map((s) => s.key)).not.toContain("videoVision");
    expect(sections.every((s) => s.items.length > 0)).toBe(true);
    // It still gets the radio config (its `video.wfb.*` fields live there).
    expect(nav("ground-station").entries.map((e) => e.id)).toContain(
      "radio-config",
    );
  });

  it("never offers two entries with the same id, on any profile", () => {
    for (const profile of [
      "drone",
      "ground-station",
      "workstation",
    ] as const) {
      const ids = nav(profile).entries.map((e) => e.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("marks only the pages that read the node config as config-backed", () => {
    const entries = nav("drone").entries;
    const byId = (id: string) => entries.find((e) => e.id === id);

    // A live surface is never rendered in the config chrome.
    expect(byId("system")?.isConfigPage).toBe(false);
    expect(byId("logs")?.readsConfig).toBe(false);

    // A config page that reads the config document: banners apply.
    expect(byId("advanced")?.isConfigPage).toBe(true);
    expect(byId("advanced")?.readsConfig).toBe(true);

    // A config page that talks to its own agent endpoint instead: chrome yes,
    // config banners no.
    expect(byId("wifi")?.isConfigPage).toBe(true);
    expect(byId("wifi")?.readsConfig).toBe(false);
    expect(byId("region")?.readsConfig).toBe(false);
  });

  it("offers no configuration page on an FC-only node, keeping what works without a companion", () => {
    // The gate the retired `settings` sub-page carried, inherited by the whole
    // configuration half: nothing to configure on a node with no agent.
    const ids = nav("ground-station", {
      agentDeviceId: null,
      agentIdentityKnown: false,
      showLockedTabs: true,
      radioPresent: false,
      isFeatureEnabled: () => false,
      atlasCapturing: false,
    }).entries.map((e) => e.id);
    expect(ids).toEqual(["logs"]);
  });
});
