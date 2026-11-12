/**
 * @module mock-live-world.test
 * @description The demo stand-in for the world-engine `live-world` viewer:
 * the synthetic point cloud, the orbit projection, the inline module
 * rendering its demo-labelled occupancy and point-cloud surfaces, and the
 * contribution appearing only in demo mode.
 * @license GPL-3.0-only
 */

import { act } from "react";
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

import { usePluginContributions } from "@/hooks/use-plugin-contributions";
import type { InlineHostApi } from "@/lib/plugins/inline-host-types";
import { CLOUD_HEIGHT_M, DEMO_LIVE_WORLD_MODULE, demoPointCloud } from "@/mock/mock-live-world";
import { projectPoint } from "@/mock/live-world-demo-panel";
import { mockDetectionStream } from "@/mock/mock-detections";
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
    expect(new Set(cloud.map((p) => p.band)).size).toBeGreaterThan(8);
  });

  it("is deterministic", () => {
    expect(demoPointCloud()).toEqual(cloud);
  });
});

describe("projectPoint", () => {
  it("puts the scene centre at the screen centre and east to the right from the south", () => {
    const centre = projectPoint(0, 0, CLOUD_HEIGHT_M / 2, { az: 0, el: 0 });
    expect(centre.u).toBeCloseTo(0);
    expect(centre.v).toBeCloseTo(0);
    expect(projectPoint(0, 2, CLOUD_HEIGHT_M / 2, { az: 0, el: 0 }).u).toBeGreaterThan(0);
  });
});

describe("DEMO_LIVE_WORLD_MODULE", () => {
  let root: HTMLElement | null = null;
  afterEach(() => {
    mockDetectionStream.stop();
    root?.remove();
    root = null;
  });

  it("renders the world-model page's demo-labelled occupancy and point-cloud surfaces, and unmounts", async () => {
    root = document.createElement("div");
    document.body.append(root);
    const host = {
      ctx: { i18n: { t: (key: string) => key } },
      node: { deviceId: "alpha-1", profile: "drone" },
      plugin: { panelId: "world-model" },
    } as unknown as InlineHostApi;
    let dispose: (() => void) | null = null;
    await act(async () => {
      dispose = await DEMO_LIVE_WORLD_MODULE.mount(root!, host);
    });
    const text = root.textContent ?? "";
    expect(text).toContain("World Model");
    expect(text).toContain("Demo data");
    expect(text).toContain("Occupancy (demo)");
    expect(text).toContain("Point cloud (demo)");
    expect(root.querySelector("[data-testid='live-world-occupancy']")).not.toBeNull();
    expect(root.querySelector("[data-testid='live-world-cloud']")).not.toBeNull();
    expect(mockDetectionStream.isRunning()).toBe(true);
    await act(async () => {
      dispose?.();
      await Promise.resolve();
    });
    expect(root.textContent).toBe("");
    expect(mockDetectionStream.isRunning()).toBe(false);
  });
});

describe("live-world demo contribution", () => {
  function livePages(profile: "drone" | "visor") {
    const { result } = renderHook(() => usePluginContributions("alpha-1", "node.agent.page", profile), {
      wrapper: ({ children }) => (
        <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
          {children}
        </NextIntlClientProvider>
      ),
    });
    return result.current.filter((c) => c.panelId === "live-world");
  }

  afterEach(() => {
    demo.value = true;
  });

  it("mounts the viewer body on a demo drone", () => {
    const pages = livePages("drone");
    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({ slot: "node.agent.page", pluginId: "com.altnautica.world-engine", isolation: "inline" });
  });

  it("is not offered on another profile", () => {
    expect(livePages("visor")).toHaveLength(0);
  });

  it("never appears outside demo mode", () => {
    demo.value = false;
    expect(livePages("drone")).toHaveLength(0);
  });
});
