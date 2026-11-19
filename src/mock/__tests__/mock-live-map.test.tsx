/**
 * @module mock-live-map.test
 * @description The demo drone's live map in 3D: the synthetic point cloud of
 * its room, served as Navigation's sweep reply (whole on a first request, an
 * empty delta once held), and the demo Navigation and Capture pages appearing
 * only in demo mode, on their profiles.
 * @license GPL-3.0-only
 */

import { renderHook } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import en from "../../../locales/en.json";

const { demo } = vi.hoisted(() => ({ demo: { value: true } }));

vi.mock("@/lib/utils", async (orig) => {
  const actual = await orig<typeof import("@/lib/utils")>();
  return { ...actual, isDemoMode: () => demo.value };
});
vi.mock("@/stores/auth-store", () => ({
  useAuthStore: (sel: (s: { isAuthenticated: boolean }) => unknown) => sel({ isAuthenticated: false }),
}));
vi.mock("@/hooks/use-convex-skip-query", () => ({ useConvexSkipQuery: () => undefined }));
vi.mock("convex/react", () => {
  const convex = { query: () => Promise.resolve(null) };
  return { useConvex: () => convex };
});

import { applySweep, emptySweepCloud, parseSweep } from "@/components/drone-detail/map/sweep-cloud";
import { usePluginContributions } from "@/hooks/use-plugin-contributions";
import { CLOUD_HEIGHT_M, demoPointCloud, demoSweepReply } from "@/mock/mock-live-map";
import { PILLARS, ROOM_HALF_M } from "@/mock/mock-nav-world";

describe("demoPointCloud", () => {
  const cloud = demoPointCloud();

  it("samples the room's walls, pillars and floor within its bounds", () => {
    expect(cloud.length).toBeGreaterThan(3000);
    for (const p of cloud) {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(ROOM_HALF_M + 0.05);
      expect(Math.abs(p.y)).toBeLessThanOrEqual(ROOM_HALF_M + 0.05);
      expect(p.z).toBeGreaterThanOrEqual(0);
      expect(p.z).toBeLessThanOrEqual(CLOUD_HEIGHT_M + 1e-9);
    }
    const pillar = PILLARS[0];
    expect(cloud.some((p) => Math.abs(Math.hypot(p.x - pillar.x, p.y - pillar.y) - pillar.r) < 0.05 && p.z > 2)).toBe(true);
  });

  it("is deterministic", () => {
    expect(demoPointCloud()).toEqual(cloud);
  });
});

describe("demoSweepReply", () => {
  it("sends the whole room once in map_ned, then an empty delta", () => {
    const first = parseSweep(demoSweepReply(null))!;
    expect(first.reset).toBe(true);
    expect(first.count).toBe(demoPointCloud().length);
    // z down: every point sits at or below the floor's z = 0.
    for (let i = 0; i < first.count; i++) expect(first.points[i * 3 + 2]).toBeLessThanOrEqual(0);
    const held = applySweep(emptySweepCloud(), first);
    const next = parseSweep(demoSweepReply(held.seq))!;
    expect(next).toMatchObject({ reset: false, count: 0, seq: first.seq });
  });
});

describe("demo extension pages", () => {
  function pages(slot: "node.agent.page" | "node.surface", profile: "drone" | "visor" | "workstation") {
    const { result } = renderHook(() => usePluginContributions("alpha-1", slot, profile), {
      wrapper: ({ children }) => (
        <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
          {children}
        </NextIntlClientProvider>
      ),
    });
    return result.current.map((c) => [c.pluginId, c.panelId]);
  }

  afterEach(() => {
    demo.value = true;
  });

  it("mounts each extension's pages on its profiles", () => {
    expect(pages("node.agent.page", "drone")).toEqual(
      expect.arrayContaining([
        ["com.altnautica.capture", "capture-setup"],
        ["com.altnautica.reconstruct", "offload"],
        ["com.altnautica.navigation", "navigation"],
      ]),
    );
    expect(pages("node.surface", "visor")).toContainEqual(["com.altnautica.capture", "capture"]);
    expect(pages("node.surface", "workstation")).toContainEqual(["com.altnautica.reconstruct", "reconstruct"]);
    expect(pages("node.agent.page", "workstation")).not.toContainEqual(["com.altnautica.reconstruct", "offload"]);
  });

  it("never appears outside demo mode", () => {
    demo.value = false;
    expect(pages("node.agent.page", "drone")).toHaveLength(0);
  });
});
