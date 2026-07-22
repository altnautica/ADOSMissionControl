"use client";

/**
 * @module use-atlas-control
 * @description Capture-control hook for a drone's Atlas world-model service.
 * Resolves the LAN-paired agent for `droneId` (host + apiKey from
 * `local-nodes-store`, Rule 39 local-first), polls
 * `GET /api/atlas/readiness` into the per-drone `atlas-readiness-store`, and
 * returns the enable/disable + capture lifecycle callbacks. The readiness the
 * store holds is what the node-detail surface registry reads synchronously to
 * decide whether the "Live World" tab is shown (one tab when not capturing, two
 * while capturing).
 *
 * Kept disjoint from the cloud path (`cloudDeviceId !== deviceId`) so the one
 * drone `CloudStatusBridge` drives is not double-polled. In demo mode the hook
 * does not touch the network: it seeds a mock readiness (and the focused-drone
 * `atlas-store` live slice so the Live World stats render) and the actions
 * mutate that mock so the whole capture flow is exercisable offline (Rule 4).
 *
 * @license GPL-3.0-only
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  AtlasControlClient,
  isActiveCaptureState,
  type AtlasReadiness,
  type CaptureResult,
  type CaptureStatus,
} from "@/lib/agent/atlas-control-client";
import { deviceIdFromNodeId } from "@/lib/agent/node-id";
import { DEFAULT_RECONSTRUCTION_STEPS } from "@/lib/atlas/reconstruction-quality";
import { isDemoMode } from "@/lib/utils";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useNodeFeaturesStore } from "@/stores/node-features-store";
import { useAtlasReadinessStore } from "@/stores/atlas-readiness-store";
import { useAtlasStore, EMPTY_ATLAS_LIVE } from "@/stores/atlas-store";
import { useLocalNodesStore } from "@/stores/local-nodes-store";

/** How often to poll the local agent's Atlas readiness, in ms. */
export const ATLAS_READINESS_POLL_INTERVAL_MS = 1500;

/** The mock readiness a demo drone starts from — cameras present, service off. */
function demoBaseReadiness(): AtlasReadiness {
  return {
    enabled: false,
    profile: "drone",
    // Matches the agent's default + its locked capture-profile enum
    // (orbit / lawnmower / freeform / inspection).
    captureProfile: "freeform",
    reconstructSteps: DEFAULT_RECONSTRUCTION_STEPS,
    camerasConfigured: 6,
    poseSource: "local_vio",
    serviceRunning: false,
    capturing: false,
    state: "idle",
    sessionId: null,
    cameraCount: 6,
    keyframes: 0,
    ingestRateHz: 0,
  };
}

export interface AtlasControl {
  /** The bare device id this control targets, or null when not a drone. */
  deviceId: string | null;
  /** Last-known readiness (reactive), or null until the first poll resolves. */
  readiness: AtlasReadiness | null;
  /** True while a lifecycle/config action is in flight (drives button spinners). */
  busy: boolean;
  /** True when a real LAN agent is reachable (not demo, paired, cloud-disjoint),
   * even if the World Model feature is not yet enabled. Enable/disable gate on
   * this so the operator can turn a not-yet-enabled feature on. */
  reachable: boolean;
  /** True when reachable AND the World Model feature is enabled for this node.
   * Gates the readiness poll and the capture actions. */
  live: boolean;
  /** Demo mode — actions simulate a session; no network. */
  demo: boolean;
  /** Enable the Atlas capture service on this drone (PUT config enabled=true). */
  enable: () => Promise<void>;
  /** Disable the Atlas capture service (PUT config enabled=false). */
  disable: () => Promise<void>;
  /** Set the capture profile (PUT config capture_profile). */
  setCaptureProfile: (profile: string) => Promise<void>;
  /** Set the default reconstruction detail level, in Brush steps (PUT config
   * reconstruct_steps). Read at reconstruct-submit time. */
  setReconstructSteps: (steps: number) => Promise<void>;
  start: () => Promise<CaptureResult>;
  stop: () => Promise<CaptureResult>;
  pause: () => Promise<CaptureResult>;
  resume: () => Promise<CaptureResult>;
}

/** Mirror a demo readiness into the focused-drone atlas-store live slice so the
 * Live World stats render offline (Rule 4). Only used in demo — real mode leaves
 * the atlas-store to `use-atlas-local-state` / `CloudStatusBridge` (Rule 39). */
function syncDemoLiveSlice(r: AtlasReadiness): void {
  useAtlasStore.getState().setLive({
    ...EMPTY_ATLAS_LIVE,
    state: r.capturing ? r.state : r.state === "bagged" ? "bagged" : "idle",
    sessionId: r.sessionId,
    keyframesIngested: r.keyframes,
    ingestRateHz: r.ingestRateHz,
    cameraCount: r.cameraCount,
    vioHealth: "good",
    // On real hardware these Stream-card fields come from the forwarder handoff;
    // demo mocks a coherent set while capturing (a node, its bearer, a fresh
    // keyframe) so the card renders fully offline (Rule 4), and clears when idle.
    computeNodeId: r.capturing ? "demo-compute-node" : null,
    lastKfAt: r.capturing ? Date.now() : null,
    bearer: r.capturing ? "direct-lan" : null,
    relayGroundAgentId: null,
    relayDecimation: null,
    updatedAt: Date.now(),
  });
}

function captureStatusFrom(r: AtlasReadiness, vioHealth: string): CaptureStatus {
  return {
    sessionId: r.sessionId ?? "",
    state: r.state,
    keyframes: r.keyframes,
    vioHealth,
    cameraCount: r.cameraCount,
    ingestRateHz: r.ingestRateHz,
  };
}

/**
 * Drive a drone's Atlas capture service. Polls readiness while mounted and
 * returns the capture-control callbacks. Inert (no network) unless local-first
 * for the drone and the Atlas flag is on; demo mode drives a mock instead.
 */
export function useAtlasControl(
  droneId: string | null | undefined,
): AtlasControl {
  const cloudDeviceId = useAgentConnectionStore((s) => s.cloudDeviceId);
  const demo = isDemoMode();

  // Selection ids are the canonical `node:<deviceId>`; the stores are keyed by
  // the bare device id — resolve before lookup.
  const deviceId = droneId ? (deviceIdFromNodeId(droneId) ?? droneId) : null;
  const node = useLocalNodesStore((s) =>
    deviceId ? s.nodes.find((n) => n.deviceId === deviceId) : undefined,
  );

  // The World Model is a per-node opt-in first-party feature — enabled from
  // the node Settings world-model page (or the fleet board's Features cell),
  // not a global flag. It gates the readiness poll
  // and the "actively doing Atlas" state so a lean fleet does no Atlas work on a
  // drone that never opted in.
  const featureEnabled = useNodeFeaturesStore((s) =>
    deviceId ? (s.enabled[deviceId] ?? []).includes("world-model") : false,
  );

  const host = node?.hostname ?? "";
  const apiKey = node?.apiKey ?? "";
  // Reachable = a real, LAN-paired agent we can drive. Enable/disable a feature
  // gate on THIS (so the operator can turn a not-yet-enabled feature on);
  // `live` additionally requires the feature enabled and gates the poll + the
  // capture actions.
  const reachable =
    !demo &&
    Boolean(deviceId) &&
    Boolean(host) &&
    Boolean(apiKey) &&
    cloudDeviceId !== deviceId;
  const live = reachable && featureEnabled;

  const readiness = useAtlasReadinessStore((s) =>
    deviceId ? s.getReadiness(deviceId) : null,
  );
  const setReadiness = useAtlasReadinessStore((s) => s.setReadiness);

  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  // Hold the live key without re-arming the poll when only its identity changes.
  const apiKeyRef = useRef(apiKey);
  useEffect(() => {
    apiKeyRef.current = apiKey;
  });

  // Seed the demo mock once (cameras present, service off) so the setup surface
  // renders with a real starting point and the Live World stats have a slice.
  const seededDemo = useRef(false);
  useEffect(() => {
    if (!demo || !deviceId || seededDemo.current) return;
    if (!useAtlasReadinessStore.getState().getReadiness(deviceId)) {
      const base = demoBaseReadiness();
      setReadiness(deviceId, base);
      syncDemoLiveSlice(base);
    }
    seededDemo.current = true;
  }, [demo, deviceId, setReadiness]);

  // Real-agent readiness poll. Re-arms on drone switch (host) / activation; the
  // key is read per-tick via the ref so a re-pair takes effect without a re-arm.
  useEffect(() => {
    if (!live || !deviceId) return;
    let cancelled = false;

    const pollOnce = async () => {
      const client = new AtlasControlClient(host, apiKeyRef.current);
      const r = await client.getReadiness();
      if (cancelled || !r) return;
      useAtlasReadinessStore.getState().setReadiness(deviceId, r);
    };

    void pollOnce();
    const handle = setInterval(
      () => void pollOnce(),
      ATLAS_READINESS_POLL_INTERVAL_MS,
    );
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [live, deviceId, host]);

  const runAction = useCallback(
    async (fn: () => Promise<void>): Promise<void> => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      try {
        await fn();
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [],
  );

  // Apply a demo patch to the mock readiness and mirror the live slice.
  const demoPatch = useCallback(
    (patch: Partial<AtlasReadiness>): AtlasReadiness => {
      const current =
        (deviceId &&
          useAtlasReadinessStore.getState().getReadiness(deviceId)) ||
        demoBaseReadiness();
      const next = { ...current, ...patch };
      if (deviceId) setReadiness(deviceId, next);
      syncDemoLiveSlice(next);
      return next;
    },
    [deviceId, setReadiness],
  );

  const refreshReadiness = useCallback(async () => {
    if (!deviceId) return;
    const client = new AtlasControlClient(host, apiKeyRef.current);
    const r = await client.getReadiness();
    if (r) useAtlasReadinessStore.getState().setReadiness(deviceId, r);
  }, [deviceId, host]);

  const mergeCaptureStatus = useCallback(
    (status: CaptureStatus) => {
      if (!deviceId) return;
      const current =
        useAtlasReadinessStore.getState().getReadiness(deviceId) ?? null;
      if (!current) return;
      useAtlasReadinessStore.getState().setReadiness(deviceId, {
        ...current,
        state: status.state,
        capturing: isActiveCaptureState(status.state),
        sessionId: status.sessionId || current.sessionId,
        keyframes: status.keyframes,
        cameraCount: status.cameraCount || current.cameraCount,
        ingestRateHz: status.ingestRateHz,
      });
    },
    [deviceId],
  );

  const enable = useCallback(
    () =>
      runAction(async () => {
        if (demo) {
          demoPatch({ enabled: true, serviceRunning: true });
          return;
        }
        if (!reachable) return;
        const client = new AtlasControlClient(host, apiKeyRef.current);
        await client.setConfig({ enabled: true });
        await refreshReadiness();
      }),
    [runAction, demo, reachable, host, demoPatch, refreshReadiness],
  );

  const disable = useCallback(
    () =>
      runAction(async () => {
        if (demo) {
          demoPatch({
            enabled: false,
            serviceRunning: false,
            capturing: false,
            state: "idle",
            sessionId: null,
            ingestRateHz: 0,
          });
          return;
        }
        if (!reachable) return;
        const client = new AtlasControlClient(host, apiKeyRef.current);
        await client.setConfig({ enabled: false });
        await refreshReadiness();
      }),
    [runAction, demo, reachable, host, demoPatch, refreshReadiness],
  );

  const setCaptureProfile = useCallback(
    (profile: string) =>
      runAction(async () => {
        if (demo) {
          demoPatch({ captureProfile: profile });
          return;
        }
        if (!live) return;
        const client = new AtlasControlClient(host, apiKeyRef.current);
        await client.setConfig({ captureProfile: profile });
        await refreshReadiness();
      }),
    [runAction, demo, live, host, demoPatch, refreshReadiness],
  );

  const setReconstructSteps = useCallback(
    (steps: number) =>
      runAction(async () => {
        if (demo) {
          demoPatch({ reconstructSteps: steps });
          return;
        }
        if (!live) return;
        const client = new AtlasControlClient(host, apiKeyRef.current);
        await client.setConfig({ reconstructSteps: steps });
        await refreshReadiness();
      }),
    [runAction, demo, live, host, demoPatch, refreshReadiness],
  );

  const captureAction = useCallback(
    (sub: "start" | "stop" | "pause" | "resume"): Promise<CaptureResult> => {
      let result: CaptureResult = {
        ok: false,
        serviceDown: false,
        message: "inactive",
      };
      return runAction(async () => {
        if (demo) {
          result = demoCapture(sub, demoPatch);
          return;
        }
        if (!live) {
          result = { ok: false, serviceDown: false, message: "inactive" };
          return;
        }
        const client = new AtlasControlClient(host, apiKeyRef.current);
        const r =
          sub === "start"
            ? await client.captureStart()
            : sub === "stop"
              ? await client.captureStop()
              : sub === "pause"
                ? await client.capturePause()
                : await client.captureResume();
        result = r;
        if (r.ok) mergeCaptureStatus(r.status);
        await refreshReadiness();
      }).then(() => result);
    },
    [
      runAction,
      demo,
      live,
      host,
      demoPatch,
      mergeCaptureStatus,
      refreshReadiness,
    ],
  );

  const start = useCallback(() => captureAction("start"), [captureAction]);
  const stop = useCallback(() => captureAction("stop"), [captureAction]);
  const pause = useCallback(() => captureAction("pause"), [captureAction]);
  const resume = useCallback(() => captureAction("resume"), [captureAction]);

  return useMemo(
    () => ({
      deviceId,
      readiness,
      busy,
      reachable,
      live,
      demo,
      enable,
      disable,
      setCaptureProfile,
      setReconstructSteps,
      start,
      stop,
      pause,
      resume,
    }),
    [
      deviceId,
      readiness,
      busy,
      reachable,
      live,
      demo,
      enable,
      disable,
      setCaptureProfile,
      setReconstructSteps,
      start,
      stop,
      pause,
      resume,
    ],
  );
}

/** Apply a demo capture action to the mock readiness and return the result. */
function demoCapture(
  sub: "start" | "stop" | "pause" | "resume",
  demoPatch: (patch: Partial<AtlasReadiness>) => AtlasReadiness,
): CaptureResult {
  if (sub === "start") {
    const next = demoPatch({
      capturing: true,
      state: "capturing",
      sessionId: `atlas-demo-${Date.now()}`,
      serviceRunning: true,
      enabled: true,
      keyframes: 12,
      ingestRateHz: 6,
    });
    return { ok: true, status: captureStatusFrom(next, "good") };
  }
  if (sub === "stop") {
    const next = demoPatch({
      capturing: false,
      state: "bagged",
      ingestRateHz: 0,
    });
    return { ok: true, status: captureStatusFrom(next, "good") };
  }
  if (sub === "pause") {
    const next = demoPatch({ state: "paused", ingestRateHz: 0 });
    return { ok: true, status: captureStatusFrom(next, "good") };
  }
  const next = demoPatch({ state: "capturing", ingestRateHz: 6 });
  return { ok: true, status: captureStatusFrom(next, "good") };
}
