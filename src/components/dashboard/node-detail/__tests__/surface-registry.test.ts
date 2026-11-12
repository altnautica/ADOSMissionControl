/**
 * @license GPL-3.0-only
 */
import { describe, expect, it } from "vitest";

import { resolveSurfaces } from "@/components/dashboard/node-detail/surfaces";
import type {
  ProfileSurfaceContribution,
  SurfaceContext,
} from "@/components/dashboard/node-detail/surface-types";
import { DEVICE_GROUP, STATUS_GROUP } from "@/components/dashboard/node-detail/surface-groups";
import type { NodeProfile } from "@/lib/nodes/node-profile";

/** A minimal SurfaceContext; overrides tune the profile / gate inputs. */
function ctx(over: Partial<SurfaceContext>): SurfaceContext {
  return {
    droneId: "node:d1",
    drone: { profile: "drone" } as SurfaceContext["drone"],
    displayName: "d1",
    isConnected: true,
    firmwareType: null,
    agentDeviceId: "dev-1",
    agentIdentityKnown: true,
    relayReach: null,
    fcLinking: false,
    radioPresent: "absent",
    visionPresent: "absent",
    crsfPresent: "absent",
    gnssPresent: "absent",
    loraPresent: "absent",
    role: "drone" as SurfaceContext["role"],
    capabilitiesKnown: true,
    showLockedTabs: false,
    pluginAgentPages: [],
    ...over,
  };
}

function forProfile(profile: NodeProfile): SurfaceContext {
  return ctx({ drone: { profile } as SurfaceContext["drone"], role: null });
}

describe("node-detail surface registry (createContributionRegistry instance)", () => {
  it("resolves the built-in drone surfaces in authored order", () => {
    const ids = resolveSurfaces(forProfile("drone"), []).map((s) => s.id);
    expect(ids).toEqual([
      "overview",
      "cockpit",
      "map",
      "configure",
      "parameters",
      "logs",
      "agent",
    ]);
  });

  it("labels the embedded cockpit as the Flight tab", () => {
    const cockpit = resolveSurfaces(forProfile("drone"), []).find((s) => s.id === "cockpit");
    expect(cockpit?.labelKey).toBe("dronePanel.flight");
    const gs = resolveSurfaces(forProfile("ground-station"), []).find((s) => s.id === "cockpit");
    expect(gs?.labelKey).toBe("dronePanel.flight");
  });

  it("shows the drone Map tab only when the node has a companion agent", () => {
    const bare = resolveSurfaces(
      ctx({ agentDeviceId: null, agentIdentityKnown: false, role: null }),
      [],
    ).map((s) => s.id);
    expect(bare).not.toContain("map");
    expect(resolveSurfaces(forProfile("drone"), []).map((s) => s.id)).toContain("map");
  });

  it("appends the Agent surface to every profile", () => {
    for (const profile of [
      "drone",
      "ground-station",
      "workstation",
      "compute",
      "visor",
      "unknown",
    ] as const) {
      const ids = resolveSurfaces(forProfile(profile), []).map((s) => s.id);
      expect(ids[ids.length - 1]).toBe("agent");
    }
  });

  it("an unknown profile resolves to just the Agent page", () => {
    // The profile parser maps any profile this build does not know to
    // "unknown", which registers nothing, so only the Agent page remains.
    expect(resolveSurfaces(forProfile("unknown"), []).map((s) => s.id)).toEqual(["agent"]);
  });

  it("a Visor without its capture extension shows the core surfaces in order", () => {
    expect(resolveSurfaces(forProfile("visor"), []).map((s) => s.id)).toEqual([
      "overview",
      "sensors",
      "display",
      "physicalUi",
      "peripherals",
      "logs",
      "agent",
    ]);
  });

  it("merges a Visor's extension surfaces into the core list by group and order", () => {
    const spec = (id: string, group: string, order: number): ProfileSurfaceContribution => ({
      spec: { id, label: id, labelKey: id, render: () => null },
      profile: ["visor"],
      group,
      order,
    });
    const ids = resolveSurfaces(forProfile("visor"), [
      spec("sessions", STATUS_GROUP, 30),
      spec("capture", STATUS_GROUP, 20),
      spec("calibration", DEVICE_GROUP, 20),
    ]).map((s) => s.id);
    expect(ids).toEqual([
      "overview",
      "capture",
      "sessions",
      "sensors",
      "calibration",
      "display",
      "physicalUi",
      "peripherals",
      "logs",
      "agent",
    ]);
  });

  it("a ground station's device-group plugin lands after its peripherals, whatever its order", () => {
    const ids = resolveSurfaces(forProfile("ground-station"), [
      {
        spec: { id: "ext", label: "ext", labelKey: "ext", render: () => null },
        profile: ["ground-station"],
        group: DEVICE_GROUP,
        order: 5,
      },
    ]).map((s) => s.id);
    expect(ids.slice(ids.indexOf("display"), ids.indexOf("ext") + 1)).toEqual([
      "display",
      "physicalUi",
      "peripherals",
      "ext",
    ]);
  });

  it("a plugin surface joins the end of a group with no ordered surfaces", () => {
    const ids = resolveSurfaces(forProfile("ground-station"), [
      {
        spec: { id: "ext", label: "ext", labelKey: "ext", render: () => null },
        profile: ["ground-station"],
        group: STATUS_GROUP,
        order: 5,
      },
    ]).map((s) => s.id);
    expect(ids.slice(0, 4)).toEqual(["overview", "cockpit", "carriedDrones", "ext"]);
  });

  it("shows the ground station's GNSS and LoRa tabs only on a proven capability", () => {
    const gs = (gnss: SurfaceContext["gnssPresent"], lora: SurfaceContext["loraPresent"]) =>
      resolveSurfaces(
        ctx({
          drone: { profile: "ground-station" } as SurfaceContext["drone"],
          role: "direct",
          gnssPresent: gnss,
          loraPresent: lora,
        }),
        [],
      ).map((s) => s.id);
    expect(gs("unknown", "absent")).not.toContain("gnss");
    expect(gs("unknown", "absent")).not.toContain("lora");
    const both = gs("present", "present");
    expect(both.slice(both.indexOf("radio"), both.indexOf("mesh") + 1)).toEqual([
      "radio",
      "network",
      "gnss",
      "lora",
      "mesh",
    ]);
  });

  it("a compute node shows the workstation surfaces, not just the Agent page", () => {
    const compute = resolveSurfaces(forProfile("compute"), []).map((s) => s.id);
    expect(compute).toEqual(resolveSurfaces(forProfile("workstation"), []).map((s) => s.id));
    expect(compute).toContain("overview");
  });

  it("hides the RC / ELRS Link tab for a node with no crsf lane, shows it when advertised", () => {
    // A node with no CRSF lane never surfaces the tab, on either profile.
    for (const profile of ["drone", "ground-station"] as const) {
      const absent = resolveSurfaces(
        ctx({
          drone: { profile } as SurfaceContext["drone"],
          role: null,
          crsfPresent: "absent",
        }),
        [],
      ).map((s) => s.id);
      expect(absent).not.toContain("rcElrs");

      const present = resolveSurfaces(
        ctx({
          drone: { profile } as SurfaceContext["drone"],
          role: null,
          crsfPresent: "present",
        }),
        [],
      ).map((s) => s.id);
      expect(present).toContain("rcElrs");
    }
  });

  it("applies a surface `when` gate (a receiver ground station hides Radio)", () => {
    const receiverIds = resolveSurfaces(
      ctx({
        drone: { profile: "ground-station" } as SurfaceContext["drone"],
        role: "receiver",
      }),
      [],
    ).map((s) => s.id);
    expect(receiverIds).not.toContain("radio");

    const directIds = resolveSurfaces(
      ctx({
        drone: { profile: "ground-station" } as SurfaceContext["drone"],
        role: "direct",
      }),
      [],
    ).map((s) => s.id);
    expect(directIds).toContain("radio");
  });
});
