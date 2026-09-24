/**
 * @module node-detail/plugin-pages.test
 * @description Plugin Agent pages and node surfaces are placed by rules a
 * manifest author relies on: `after` anchors below a page in the same section,
 * an unresolved anchor falls back to `order`, an unknown section lands in
 * Software, `setupFor` becomes the host page's Setup segment, and a page only
 * reaches a node whose profile it names.
 * @license GPL-3.0-only
 */

import { describe, expect, it } from "vitest";

import { resolveAgentNav } from "@/components/dashboard/node-detail/agent/agent-nav-sections";
import { resolveSurfaces } from "@/components/dashboard/node-detail/surfaces";
import { STATUS_GROUP } from "@/components/dashboard/node-detail/surface-groups";
import {
  pluginPageId,
  type AgentNavContribution,
  type NodeProfile,
  type ProfileSurfaceContribution,
  type SurfaceContext,
} from "@/components/dashboard/node-detail/surface-types";
import type { SettingsPageContext } from "@/components/command/settings/settings-nav";
import { projectNodePluginPages } from "@/hooks/use-node-plugin-pages";

const PLUGIN = "com.example.world";

function ctxFor(profile: NodeProfile): SurfaceContext {
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
    radioPresent: "present",
    visionPresent: "present",
    crsfPresent: "present",
    role: null,
    capabilitiesKnown: true,
    showLockedTabs: false,
    isFeatureEnabled: () => false,
    atlasCapturing: false,
    pluginAgentPages: [],
  };
}

function settingsCtxFor(profile: NodeProfile): SettingsPageContext {
  return {
    droneId: "node:d1",
    nodeDeviceId: "d1",
    relayReach: null,
    profile,
    config: {},
    readOnly: false,
    setValue: async () => {},
  };
}

function page(
  panelId: string,
  over: Partial<AgentNavContribution> = {},
): AgentNavContribution {
  return {
    id: pluginPageId(over.pluginId ?? PLUGIN, panelId),
    pluginId: PLUGIN,
    installId: "install-1",
    panelId,
    label: `Page ${panelId}`,
    icon: null,
    section: "videoVision",
    order: 60,
    render: () => null,
    ...over,
  };
}

function sectionIds(pages: AgentNavContribution[], key: string): string[] {
  const nav = resolveAgentNav(ctxFor("drone"), settingsCtxFor("drone"), pages);
  return nav.sections.find((s) => s.key === key)?.items.map((e) => e.id) ?? [];
}

const id = (panelId: string) => pluginPageId(PLUGIN, panelId);

describe("plugin Agent page placement", () => {
  it("anchors a page directly below a built-in page named by `after`", () => {
    const ids = sectionIds([page("offload", { after: "vision" })], "videoVision");
    expect(ids[ids.indexOf("vision") + 1]).toBe(id("offload"));
  });

  it("anchors below a page of the same plugin whatever the manifest order", () => {
    const ids = sectionIds(
      [page("live", { after: "world" }), page("world", { order: 10 })],
      "videoVision",
    );
    expect(ids.slice(-2)).toEqual([id("world"), id("live")]);
  });

  it("falls back to `order` when the `after` page is absent", () => {
    const ids = sectionIds(
      [
        page("late", { section: "software", order: 20, after: "no-such-page" }),
        page("early", { section: "software", order: 10 }),
      ],
      "software",
    );
    expect(ids).toEqual(["plugins", id("early"), id("late")]);
  });

  it("puts a page naming an unknown section into Software", () => {
    const nav = resolveAgentNav(ctxFor("drone"), settingsCtxFor("drone"), [
      page("x", { section: "notASection" }),
    ]);
    const software = nav.sections.find((s) => s.key === "software");
    expect(software?.items.map((e) => e.id)).toContain(id("x"));
    expect(nav.sections.map((s) => s.key)).not.toContain("notASection");
  });

  it("renders the manifest title verbatim as the sidebar label", () => {
    const nav = resolveAgentNav(ctxFor("drone"), settingsCtxFor("drone"), [
      page("x", { section: "software", label: "World Model" }),
    ]);
    expect(nav.entries.find((e) => e.id === id("x"))?.label).toBe("World Model");
  });

  it("turns a `setupFor` page into the host page's Setup segment", () => {
    const nav = resolveAgentNav(ctxFor("drone"), settingsCtxFor("drone"), [
      page("world"),
      page("world-setup", { setupFor: "world", label: "World setup" }),
    ]);
    const host = nav.entries.find((e) => e.id === id("world"));
    expect(host?.setup?.label).toBe("World setup");
    expect(nav.entries.map((e) => e.id)).not.toContain(id("world-setup"));
  });

  it("keeps a `setupFor` page as its own row when the host page is absent", () => {
    const nav = resolveAgentNav(ctxFor("drone"), settingsCtxFor("drone"), [
      page("world-setup", { setupFor: "world" }),
    ]);
    expect(nav.entries.map((e) => e.id)).toContain(id("world-setup"));
  });
});

function surface(
  panelId: string,
  profile: NodeProfile[],
  over: Partial<ProfileSurfaceContribution> = {},
): ProfileSurfaceContribution {
  return {
    spec: {
      id: pluginPageId(PLUGIN, panelId),
      labelKey: "dronePanel.pluginPage",
      label: panelId,
      render: () => null,
    },
    profile,
    order: 60,
    ...over,
  };
}

describe("plugin node surface placement", () => {
  it("joins the end of its group's run, else sits just before the Agent surface", () => {
    const ids = resolveSurfaces(ctxFor("workstation"), [
      surface("jobs", ["workstation"]),
      surface("overview", ["workstation"], { group: STATUS_GROUP }),
    ]).map((s) => s.id);
    const statusRun = resolveSurfaces(ctxFor("workstation"), [])
      .filter((s) => s.group === STATUS_GROUP)
      .map((s) => s.id);
    expect(ids.indexOf(id("overview"))).toBe(
      ids.indexOf(statusRun[statusRun.length - 1]) + 1,
    );
    expect(ids.slice(-2)).toEqual([id("jobs"), "agent"]);
  });

  it("offers a surface only on the profiles it names", () => {
    const plugins = [surface("jobs", ["workstation", "compute"])];
    expect(resolveSurfaces(ctxFor("drone"), plugins).map((s) => s.id)).not.toContain(id("jobs"));
    expect(resolveSurfaces(ctxFor("compute"), plugins).map((s) => s.id)).toContain(id("jobs"));
  });
});

describe("projectNodePluginPages", () => {
  const rows = [
    {
      installId: "install-1",
      pluginId: PLUGIN,
      version: "1.0.0",
      name: "World",
      gcsContributes: [
        { slot: "node.agent.page", panelId: "drone-only", title: "Drone only", profile: ["drone" as const] },
        { slot: "node.agent.page", panelId: "anywhere", title: "Anywhere" },
        {
          slot: "node.surface",
          panelId: "compute",
          title: "Compute",
          profile: ["workstation" as const, "compute" as const],
          group: "status" as const,
        },
        { slot: "node.surface", panelId: "unscoped", title: "No profile" },
        { slot: "node.detail.tab", panelId: "tab" },
      ],
    },
  ];

  it("narrows pages and surfaces to the node profile", () => {
    const drone = projectNodePluginPages(rows, "drone");
    expect(drone.agentPages.map((p) => p.panelId)).toEqual(["drone-only", "anywhere"]);
    expect(drone.surfaces).toEqual([]);

    const compute = projectNodePluginPages(rows, "compute");
    expect(compute.agentPages.map((p) => p.panelId)).toEqual(["anywhere"]);
    expect(compute.surfaces.map((s) => s.spec.id)).toEqual([id("compute")]);
    expect(compute.surfaces[0].group).toBe(STATUS_GROUP);
  });

  it("defaults an Agent page with no section to Software", () => {
    const [anywhere] = projectNodePluginPages(rows, "compute").agentPages;
    expect(anywhere.section).toBe("software");
    expect(anywhere.label).toBe("Anywhere");
  });
});
