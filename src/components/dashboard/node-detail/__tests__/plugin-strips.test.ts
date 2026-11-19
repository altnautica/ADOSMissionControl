/**
 * @module node-detail/plugin-strips.test
 * @description The node tab strips and the Agent sidebar that the Capture,
 * Reconstruct and Navigation manifests produce on each profile: their pages
 * land where an operator expects them, between the built-in surfaces, read
 * from the manifests themselves (the demo install rows).
 * @license GPL-3.0-only
 */

import { describe, expect, it } from "vitest";

import { resolveAgentNav } from "@/components/dashboard/node-detail/agent/agent-nav-sections";
import { resolveSurfaces } from "@/components/dashboard/node-detail/surfaces";
import type { SurfaceContext } from "@/components/dashboard/node-detail/surface-types";
import type { SettingsPageContext } from "@/components/command/settings/settings-nav";
import { projectNodePluginPages } from "@/hooks/use-node-plugin-pages";
import type { NodeProfile } from "@/lib/nodes/node-profile";
import { getDemoNodePageInstallRows } from "@/mock/mock-plugins";

const CAPTURE = "x:com.altnautica.capture/";
const RECONSTRUCT = "x:com.altnautica.reconstruct/";
const NAVIGATION = "x:com.altnautica.navigation/";

function ctxFor(profile: NodeProfile, over: Partial<SurfaceContext> = {}): SurfaceContext {
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
    radioPresent: "absent",
    visionPresent: "present",
    crsfPresent: "absent",
    gnssPresent: "absent",
    loraPresent: "absent",
    role: null,
    capabilitiesKnown: true,
    showLockedTabs: false,
    pluginAgentPages: [],
    liveMapFresh: true,
    ...over,
  };
}

function settingsCtxFor(profile: NodeProfile): SettingsPageContext {
  return {
    droneId: "node:d1",
    nodeDeviceId: "d1",
    relayReach: null,
    profile,
    hostKind: "appliance",
    config: {},
    readOnly: false,
    setValue: async () => {},
    demoMode: false,
  };
}

/** The strip's ids with each extension's pages collapsed to one marker. */
function strip(profile: NodeProfile, over: Partial<SurfaceContext> = {}): string[] {
  const { surfaces } = projectNodePluginPages(getDemoNodePageInstallRows(), profile);
  const ids = resolveSurfaces(ctxFor(profile, over), surfaces).map((s) => s.id);
  const out: string[] = [];
  for (const id of ids) {
    const marker = id.startsWith(CAPTURE)
      ? "plugin:capture"
      : id.startsWith(RECONSTRUCT)
        ? "plugin:reconstruct"
        : id.startsWith(NAVIGATION)
          ? "plugin:navigation"
          : id;
    if (out[out.length - 1] !== marker) out.push(marker);
  }
  return out;
}

describe("extension node strips", () => {
  it("puts Capture after the Map on a drone, before configuration", () => {
    expect(strip("drone")).toEqual([
      "overview",
      "cockpit",
      "map",
      "plugin:capture",
      "configure",
      "parameters",
      "logs",
      "agent",
    ]);
  });

  it("keeps the RC tab between Parameters and Logs on a drone with CRSF", () => {
    const ids = strip("drone", { crsfPresent: "present" });
    expect(ids.slice(ids.indexOf("parameters"), ids.indexOf("logs") + 1)).toEqual([
      "parameters",
      "rcElrs",
      "logs",
    ]);
    expect(ids.indexOf("plugin:capture")).toBe(ids.indexOf("map") + 1);
  });

  it("puts Capture first among a Visor's device tabs", () => {
    expect(strip("visor")).toEqual([
      "overview",
      "plugin:capture",
      "sensors",
      "display",
      "physicalUi",
      "peripherals",
      "logs",
      "agent",
    ]);
  });

  it("gives a workstation Reconstruct and nothing of Capture", () => {
    expect(strip("workstation")).toEqual(["overview", "plugin:reconstruct", "logs", "agent"]);
  });
});

describe("extension Agent pages", () => {
  it("orders Video and vision as cameras, capture setup, vision, offload, navigation on a drone", () => {
    const { agentPages } = projectNodePluginPages(getDemoNodePageInstallRows(), "drone");
    const nav = resolveAgentNav(ctxFor("drone"), settingsCtxFor("drone"), agentPages);
    const ids = nav.sections.find((s) => s.key === "videoVision")?.items.map((e) => e.id) ?? [];
    const named = ids.map((id) =>
      id.startsWith(CAPTURE)
        ? `capture:${id.slice(CAPTURE.length)}`
        : id.startsWith(RECONSTRUCT)
          ? `reconstruct:${id.slice(RECONSTRUCT.length)}`
          : id.startsWith(NAVIGATION)
            ? `navigation:${id.slice(NAVIGATION.length)}`
            : id,
    );
    expect(named).toEqual(["cameras", "capture:capture-setup", "vision", "reconstruct:offload", "navigation:navigation"]);
  });
});
