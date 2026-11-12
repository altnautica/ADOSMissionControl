/**
 * @module mock-follow-me.test
 * @description The demo Follow-Me tab body: the `follow.state` read-back the
 * demo derives from its follow feed and pilot passes the extension's follow
 * gate in order, the tab body is keyed to the install row its header reads,
 * and the inline module renders the About and Live sections with the
 * extension's words.
 * @license GPL-3.0-only
 */

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { demoInlineContributions } from "@/hooks/plugin-contribution-mounts";
import { nodeIdForDevice } from "@/lib/agent/node-id";
import { parsePilotState, type PilotState } from "@/lib/hud/cockpit-frames";
import type { InlineHostApi } from "@/lib/plugins/inline-host-types";
import { usePluginConfigCache } from "@/lib/plugins/config-cache";
import { useNavStreamStore } from "@/stores/nav-stream-store";
import { mockDetectionStream } from "@/mock/mock-detections";
import {
  DEMO_FOLLOW_ME_MODULE,
  demoFollowReadback,
  FOLLOW_ME_PANEL_ID,
  getDemoFollowMeContribution,
} from "@/mock/mock-follow-me";
import { REACQUIRED_TRACK, scriptFollow, TARGET_TRACK, type FollowContext } from "@/mock/mock-hud-script";
import { demoPilotWire } from "@/mock/mock-pilot-wire";
import { getDemoDronePluginContributions } from "@/mock/mock-plugins";

const FOLLOW_ME_ID = "com.altnautica.follow-me";
const CTX: FollowContext = { cameraId: "cam-a", vehicleYawDeg: 90, reacquireMode: "smart", droneNed: [0, 0] };

function pilot(over: Record<string, unknown> = {}): PilotState {
  return parsePilotState(demoPilotWire({ armed: true, landed: false, owner: "skill", ...over }))!;
}

const flying = { state: pilot(), ageMs: 100 };
const settings = { distanceM: 8, heightM: 4 };

describe("demoFollowReadback", () => {
  it("reports follow off while the skill is not flying", () => {
    expect(demoFollowReadback({ follow: null, pilot: flying, ...settings })).toEqual({
      active: false,
      lock_state: null,
      target_id: null,
      range_m: null,
      distance_setpoint_m: null,
      height_setpoint_m: null,
      commanding: false,
      fc_armed: true,
      fc_guided: true,
      hold_reason: "inactive",
    });
  });

  it("commands while following a locked subject, with range and setpoints", () => {
    const follow = scriptFollow(12.5, CTX);
    const r = demoFollowReadback({ follow, pilot: flying, ...settings });
    expect(r).toMatchObject({
      active: true,
      lock_state: "locked",
      target_id: TARGET_TRACK,
      commanding: true,
      range_m: follow.rangeM,
      distance_setpoint_m: 8,
      height_setpoint_m: 4,
      hold_reason: null,
    });
  });

  it.each([
    [2, "no-lock", null, null],
    [11, "lock-uncertain", "uncertain", TARGET_TRACK],
    [13.5, "lock-uncertain", "uncertain", TARGET_TRACK],
    [15.5, "no-ground-fix", "locked", TARGET_TRACK],
    [21, "lock-uncertain", "uncertain", TARGET_TRACK],
    [29, "lock-lost", "lost", null],
  ] as const)("t=%s holds with %s", (t, hold, lock, target) => {
    const r = demoFollowReadback({ follow: scriptFollow(t, CTX), pilot: flying, ...settings });
    expect(r).toMatchObject({ active: true, commanding: false, hold_reason: hold, lock_state: lock, target_id: target });
    expect([r.range_m, r.distance_setpoint_m, r.height_setpoint_m]).toEqual([null, null, null]);
  });

  it("keeps commanding through the coast and on the re-acquired track", () => {
    expect(demoFollowReadback({ follow: scriptFollow(16.5, CTX), pilot: flying, ...settings })).toMatchObject({
      commanding: true,
      lock_state: "locked",
    });
    expect(demoFollowReadback({ follow: scriptFollow(25, CTX), pilot: flying, ...settings })).toMatchObject({
      commanding: true,
      target_id: REACQUIRED_TRACK,
    });
  });

  it("names the flight controller gate, in the extension's order", () => {
    const follow = scriptFollow(12.5, CTX);
    const stale = demoFollowReadback({ follow, pilot: { state: pilot(), ageMs: 3500 }, ...settings });
    expect(stale).toMatchObject({ hold_reason: "fc-stale", fc_armed: false, fc_guided: false, commanding: false });
    expect(demoFollowReadback({ follow, pilot: null, ...settings }).hold_reason).toBe("fc-stale");
    const disarmed = demoFollowReadback({ follow, pilot: { state: pilot({ armed: false, fc_mode_name: "LOITER" }), ageMs: 0 }, ...settings });
    expect(disarmed).toMatchObject({ hold_reason: "fc-disarmed", fc_armed: false, fc_guided: false });
    const loiter = demoFollowReadback({ follow, pilot: { state: pilot({ fc_mode_name: "LOITER" }), ageMs: 0 }, ...settings });
    expect(loiter).toMatchObject({ hold_reason: "fc-not-guided", fc_armed: true, fc_guided: false });
    expect(demoFollowReadback({ follow, pilot: { state: pilot({ fc_mode_name: "OFFBOARD" }), ageMs: 0 }, ...settings }).commanding).toBe(true);
  });
});

describe("getDemoFollowMeContribution", () => {
  it("mounts under the tab header the demo drone's install row produces", () => {
    const header = getDemoDronePluginContributions("alpha-1").find((c) => c.pluginId === FOLLOW_ME_ID)!;
    const demo = getDemoFollowMeContribution("alpha-1")!;
    expect(demo.contribution.pluginInstallId).toBe(header.installId);
    expect(demo.contribution.panelId).toBe(header.panelId);
    expect(header.panelId).toBe(FOLLOW_ME_PANEL_ID);
    expect(demo.contribution.isolation).toBe("inline");
    expect(demo.contribution.title).toBe(header.title);
    expect(getDemoFollowMeContribution("alpha-1")).toBe(demo);
    expect(demoInlineContributions("alpha-1", "node.detail.tab", "drone")).toContain(demo.contribution);
  });

  it("is absent on a demo drone without the extension running", () => {
    expect(getDemoDronePluginContributions("charlie-3").some((c) => c.pluginId === FOLLOW_ME_ID)).toBe(false);
    expect(getDemoFollowMeContribution("charlie-3")).toBeNull();
  });
});

describe("DEMO_FOLLOW_ME_MODULE", () => {
  const droneId = nodeIdForDevice("alpha-1");
  let root: HTMLElement | null = null;
  let dispose: (() => void) | null = null;
  const host = {
    ctx: {
      theme: { onChange: () => () => {} },
      i18n: { t: (key: string) => key },
    },
    node: { deviceId: "alpha-1", profile: "drone" },
  } as unknown as InlineHostApi;

  const text = (id: string) => root!.querySelector(`[data-testid=${id}]`)?.textContent;

  beforeEach(() => {
    // The cockpit already runs the demo feed: the tab only reads it.
    vi.spyOn(mockDetectionStream, "isRunning").mockReturnValue(true);
  });
  afterEach(async () => {
    await act(async () => {
      dispose?.();
      await Promise.resolve();
    });
    dispose = null;
    root?.remove();
    root = null;
    useNavStreamStore.getState().clear(droneId);
    usePluginConfigCache.setState({ values: {} });
    vi.restoreAllMocks();
  });

  async function mount(): Promise<void> {
    root = document.createElement("div");
    document.body.append(root);
    await act(async () => {
      dispose = await DEMO_FOLLOW_ME_MODULE.mount(root!, host);
    });
  }

  it("shows the About section and an off read-back before the skill flies", async () => {
    await mount();
    const all = root!.textContent ?? "";
    for (const label of ["Follow-Me", "About", "Detector", "Generic person / COCO model", "Requires a guided position-hold mode", "Live", "Lock state", "Range to subject"]) {
      expect(all).toContain(label);
    }
    expect(all).not.toContain("metrics.");
    expect(text("fm-lock-state")).toBe("No lock");
    expect(text("fm-commanding")).toBe("No");
    expect(text("fm-hold-reason")).toBe("Follow is off");
    expect(text("fm-range")).toBe("—");
  });

  it("reads the demo follow feed live: commanding, then a named hold", async () => {
    const store = useNavStreamStore.getState();
    store.setPilot(droneId, pilot());
    store.setFollow(droneId, scriptFollow(12.5, CTX));
    usePluginConfigCache.getState().record("alpha-1", FOLLOW_ME_ID, "follow_distance_m", 12);
    await mount();
    expect(text("fm-lock-state")).toBe("Locked");
    expect(text("fm-commanding")).toBe("Yes");
    expect(root!.querySelector("[data-testid=fm-hold-reason-row]")).toBeNull();
    expect(text("fm-fc-armed")).toBe("Yes");
    expect(text("fm-fc-guided")).toBe("Yes");
    expect(text("fm-target-id")).toBe(`#${TARGET_TRACK}`);
    expect(text("fm-range")).toBe(`${scriptFollow(12.5, CTX).rangeM!.toFixed(1)} m`);
    expect(text("fm-distance-setpoint")).toBe("12.0 m");
    expect(text("fm-height-setpoint")).toBe("4.0 m");

    await act(async () => {
      useNavStreamStore.getState().setFollow(droneId, scriptFollow(29, CTX));
    });
    expect(text("fm-lock-state")).toBe("Lost");
    expect(text("fm-hold-reason")).toBe("Subject lost");
    expect(text("fm-distance-setpoint")).toBe("—");
  });

  it("flags a stale flight controller heartbeat as a fault", async () => {
    const store = useNavStreamStore.getState();
    store.setPilot(droneId, pilot(), Date.now() - 5000);
    store.setFollow(droneId, scriptFollow(12.5, CTX));
    await mount();
    expect(text("fm-hold-reason")).toBe("No flight controller heartbeat");
    expect(root!.querySelector<HTMLElement>("[data-testid=fm-hold-reason]")!.style.color).toContain("--fm-error");
    expect(text("fm-fc-armed")).toBe("No");
  });
});
