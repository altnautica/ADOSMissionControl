/**
 * @module mock-vision-nav.test
 * @description The demo Vision Nav tab: the health snapshot carries the
 * published vision-nav release's `navigation` block key for key with a pre-arm report the
 * gate would produce from the same readings, the tab body is keyed to the
 * install row its header reads, and the inline module renders the panel's
 * cards, Pre-arm included.
 * @license GPL-3.0-only
 */

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { InlineHostApi } from "@/lib/plugins/inline-host-types";
import { slotToCapability } from "@/lib/plugins/types";
import { getDemoDronePluginContributions } from "@/mock/mock-plugins";
import {
  DEMO_VISION_NAV_MODULE,
  getDemoVisionNavContribution,
  getMockVisionNavHealth,
  VISION_NAV_HEALTH_KEYS,
  VISION_NAV_PANEL_ID,
  VISION_NAV_PLUGIN_ID,
  VISION_NAV_VERSION,
  VISION_NAV_REFRESH_MS,
} from "@/mock/mock-vision-nav";
import { TOUR_PERSIST_KEY } from "@/mock/vision-nav-demo-tour";

describe("getMockVisionNavHealth", () => {
  it("emits exactly the navigation block keys, in agent order", () => {
    expect(Object.keys(getMockVisionNavHealth())).toEqual([...VISION_NAV_HEALTH_KEYS]);
  });

  it("advertises the estimators the release runs and a converged optical-flow run", () => {
    const h = getMockVisionNavHealth();
    expect(h.opticalFlowSupported).toBe(true);
    expect(h.availableEstimators).toEqual(["external_nav", "off", "optical_flow", "optical_flow_degraded"]);
    expect(h.poseAgeMs).toBeNull();
    expect(h).toMatchObject({
      mode: "optical_flow",
      companionState: "active",
      estimatorState: "converged",
      rangefinderTopology: "companion",
      flowScaleSource: "rangefinder",
      imuSource: "mavlink-raw-imu",
      cameraIntrinsicsLoaded: true,
      emitErrors: 0,
      rangefinderError: null,
      degradedReasons: [],
      fcParams: [],
    });
  });

  it("reports the gate's checks, computed from the same readings", () => {
    const h = getMockVisionNavHealth();
    const report = h.preArmReport!;
    expect(report.mode).toBe(h.mode);
    expect(report.checks.map((c) => c.id)).toEqual(["companion_active", "flow_quality", "rangefinder"]);
    expect(h.flowQuality!).toBeGreaterThanOrEqual(50);
    expect(report.checks[1].detail).toBe(`Quality ${h.flowQuality}/255.`);
    expect(report.checks[2].detail).toBe(`Topology: companion, ${h.flowDistanceM!.toFixed(2)} m`);
    expect(report.armable).toBe(report.checks.every((c) => c.severity === "ok"));
    expect(report.armable).toBe(true);
  });
});

describe("getDemoVisionNavContribution", () => {
  it("mounts under the tab header the demo drone's install row produces", () => {
    const header = getDemoDronePluginContributions("alpha-1").find(
      (c) => c.pluginId === VISION_NAV_PLUGIN_ID,
    )!;
    const demo = getDemoVisionNavContribution("alpha-1")!;
    expect(header.version).toBe(VISION_NAV_VERSION);
    expect(VISION_NAV_VERSION).toBe("0.6.7");
    expect(demo.contribution.pluginInstallId).toBe(header.installId);
    expect(demo.contribution.panelId).toBe(header.panelId);
    expect(demo.contribution.panelId).toBe(VISION_NAV_PANEL_ID);
    expect(demo.contribution.isolation).toBe("inline");
    expect(demo.contribution.grantedCapabilities.has(slotToCapability("node.detail.tab"))).toBe(
      true,
    );
    expect(demo.entry.profile).toEqual(["drone"]);
    // Identity-stable, so a re-render does not remount the panel.
    expect(getDemoVisionNavContribution("alpha-1")).toBe(demo);
  });

  it("is absent on a demo drone without the extension", () => {
    expect(getDemoVisionNavContribution("charlie-3")).toBeNull();
  });
});

describe("DEMO_VISION_NAV_MODULE", () => {
  let root: HTMLElement | null = null;
  afterEach(() => {
    root?.remove();
    root = null;
  });

  it("renders the panel cards, Navigation feed and parameters included", async () => {
    root = document.createElement("div");
    document.body.append(root);
    const host = {
      ctx: {
        theme: { onChange: () => () => {} },
        i18n: { t: (key: string) => key },
      },
    } as unknown as InlineHostApi;
    let dispose: (() => void) | null = null;
    await act(async () => {
      dispose = await DEMO_VISION_NAV_MODULE.mount(root!, host);
    });
    const text = root.textContent ?? "";
    for (const label of [
      "Vision Nav",
      "Companion: Active",
      "Mode",
      "Sensors",
      "Estimator",
      "Flow health",
      "Pre-arm",
      "Ready",
      "Companion process active",
      "Rangefinder healthy",
      "Lucas-Kanade",
      "External Navigation",
      "Navigation feed",
      "EKF source set",
      "Pose age",
      "No GPS",
      "ArduPilot vision parameters",
      "EK3_SRC2_POSXY",
    ]) {
      expect(text).toContain(label);
    }
    // A converged estimator shows no fallback banner.
    expect(root.querySelector("[role=alert]")).toBeNull();
    await act(async () => {
      dispose?.();
      await Promise.resolve();
    });
    expect(root.textContent).toBe("");
  });
});

describe("DEMO_VISION_NAV_MODULE trends and tour", () => {
  let root: HTMLElement | null = null;
  let dispose: (() => void) | null = null;
  const host = {
    ctx: {
      theme: { onChange: () => () => {} },
      i18n: { t: (key: string) => key },
    },
  } as unknown as InlineHostApi;

  async function mount(): Promise<HTMLElement> {
    root = document.createElement("div");
    document.body.append(root);
    await act(async () => {
      dispose = await DEMO_VISION_NAV_MODULE.mount(root!, host);
    });
    return root;
  }

  const click = async (el: Element | null) => {
    expect(el).not.toBeNull();
    await act(async () => {
      (el as HTMLElement).click();
    });
  };

  beforeEach(() => window.localStorage.clear());
  afterEach(async () => {
    await act(async () => {
      dispose?.();
      await Promise.resolve();
    });
    dispose = null;
    root?.remove();
    root = null;
    vi.useRealTimers();
  });

  it("charts a rolling history of flow quality and sync offset, one sample per refresh", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const el = await mount();
    const charts = el.querySelector("[data-testid=vn-telemetry-charts]")!;
    expect(charts.textContent).toContain("Telemetry trends");
    const quality = () => el.querySelector("[data-testid=vn-sparkline-flow-quality]")!;
    const sync = () => el.querySelector("[data-testid=vn-sparkline-sync-offset]")!;
    // One sample is not a trend yet.
    expect(quality().textContent).toContain("no data");
    const refresh = async (n: number) => {
      for (let i = 0; i < n; i++) {
        await act(async () => {
          vi.advanceTimersByTime(VISION_NAV_REFRESH_MS);
        });
      }
    };
    await refresh(3);
    expect(quality().textContent).toMatch(/\d+ \/255$/);
    expect(sync().textContent).toMatch(/\d+\.\d{2} ms$/);
    expect(quality().querySelector("polyline")!.getAttribute("points")!.split(" ")).toHaveLength(4);
    // The window caps at a minute of history.
    await refresh(90);
    expect(quality().querySelector("polyline")!.getAttribute("points")!.split(" ")).toHaveLength(60);
    // The cards keep the extension's order: Estimator, trends, Flow health.
    const order = [...el.querySelectorAll("section[data-testid]")].map((s) => s.getAttribute("data-testid"));
    expect(order.indexOf("vn-telemetry-charts")).toBe(order.indexOf("vn-estimator-card") + 1);
    expect(order.indexOf("vn-flow-health")).toBe(order.indexOf("vn-telemetry-charts") + 1);
  });

  it("opens the five-step tour on the first visit and remembers it was finished", async () => {
    const el = await mount();
    const steps = ["mode-card", "sensors-card", "estimator-card", "telemetry-charts", "pre-arm"];
    for (const [i, id] of steps.entries()) {
      const step = el.querySelector(`[data-testid=vn-tour-step-${id}]`);
      expect(step?.textContent).toContain(`Step ${i + 1}/5`);
      // Every step points at a card the tab renders.
      expect(el.querySelector(`[data-testid=vn-${id}]`)).not.toBeNull();
      if (i < steps.length - 1) await click(el.querySelector("[data-testid=vn-tour-next]"));
    }
    expect(el.textContent).toContain("Pre-arm checklist");
    await click(el.querySelector("[data-testid=vn-tour-finish]"));
    expect(el.querySelector("[data-testid=vn-tour-overlay]")).toBeNull();
    expect(window.localStorage.getItem(TOUR_PERSIST_KEY)).toBe("true");
  });

  it("stays closed once seen, and Replay tour reopens it at step one", async () => {
    window.localStorage.setItem(TOUR_PERSIST_KEY, "true");
    const el = await mount();
    expect(el.querySelector("[data-testid=vn-tour-overlay]")).toBeNull();
    const replay = el.querySelector("[data-testid=vn-tour-replay]");
    expect(replay?.textContent).toBe("Replay tour");
    await click(replay);
    expect(el.querySelector("[data-testid=vn-tour-step-mode-card]")?.textContent).toContain("Navigation mode");
    await click(el.querySelector("[data-testid=vn-tour-skip]"));
    expect(el.querySelector("[data-testid=vn-tour-overlay]")).toBeNull();
  });
});
