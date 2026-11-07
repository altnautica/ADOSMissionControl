/**
 * @module fc-setup/use-fc-setup
 * @description The setup wizard's live state for one drone: one
 * `GET /api/v1/fc-setup` read, then the setup stream folded in frame by frame,
 * plus the operator's requests (start, step action, re-run, abort, revert).
 * Each request applies the engine's reply at once, so the screen moves before
 * the next frame lands.
 *
 * {@link useDroneSetupTransport} picks the transport: the drone's agent on the
 * LAN (pairing key), the demo engine in demo mode, or none, in which case the
 * calibration panels keep their direct MAVLink path.
 * @license GPL-3.0-only
 */

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { deviceIdFromNodeId } from "@/lib/agent/node-id";
import { resolveLanAgentUrl, resolvePairedApiKey } from "@/lib/agent/resolve-agent";
import { isDemoMode } from "@/lib/utils";
import { demoSetupTransport } from "@/mock/mock-fc-setup";
import { useLocalNodesStore } from "@/stores/local-nodes-store";

import {
  abortWizard,
  agentSetupTransport,
  fetchSetupStatus,
  rerunStep,
  revertToSnapshot,
  runStepAction,
  setupErrorKey,
  startWizard,
  type SetupTransport,
} from "./client";
import { applyFrame, withStep, withWizard } from "./parse";
import { setupText } from "./strings";
import type { SetupStatus, SetupStep, SetupValue, Wizard } from "./types";

export interface FcSetupController {
  status: SetupStatus | null;
  /** True until the first read settles. */
  loading: boolean;
  /** The last failed read, or null. */
  loadError: string | null;
  /** The last refused or failed request, as display text, or null. */
  requestError: string | null;
  /** The request in flight (`<wizard>`, `<wizard>/<step>/<action>`, `revert`), or null. */
  busy: string | null;
  refresh: () => Promise<void>;
  start: (wizard: string) => Promise<void>;
  abort: (wizard: string) => Promise<void>;
  action: (step: SetupStep, actionId: string, args?: Record<string, SetupValue>) => Promise<void>;
  /** Run one step on its own (Settings › Aircraft setup, the calibration panels). */
  runStep: (wizard: string, step: string) => Promise<void>;
  /** Restore a parameter snapshot; resolves to the restored count, or null on failure. */
  revert: (snapshot: string) => Promise<number | null>;
}

function requestMessage(err: unknown): string {
  const key = setupErrorKey(err);
  if (key) return setupText(key);
  return err instanceof Error ? err.message : String(err);
}

/** The setup transport for a drone, or null when it has no reachable agent. */
export function useDroneSetupTransport(droneId: string | null | undefined): SetupTransport | null {
  const nodes = useLocalNodesStore((s) => s.nodes);
  const deviceId = droneId ? deviceIdFromNodeId(droneId) ?? droneId : null;
  const agentUrl = deviceId ? resolveLanAgentUrl(deviceId) : null;
  const apiKey = deviceId ? resolvePairedApiKey(deviceId) : null;
  return useMemo(() => {
    if (!deviceId) return null;
    if (isDemoMode()) return demoSetupTransport(deviceId);
    return agentUrl ? agentSetupTransport({ baseUrl: agentUrl, apiKey }) : null;
    // `nodes` is the reactive trigger for the resolvers, which read the store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId, agentUrl, apiKey, nodes]);
}

export function useFcSetup(transport: SetupTransport | null): FcSetupController {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const live = useRef(true);

  const refresh = useCallback(async () => {
    if (!transport) return;
    try {
      const next = await fetchSetupStatus(transport);
      if (!live.current) return;
      setStatus(next);
      setLoadError(null);
    } catch (err) {
      if (live.current) setLoadError(requestMessage(err));
    } finally {
      if (live.current) setLoading(false);
    }
  }, [transport]);

  useEffect(() => {
    live.current = true;
    if (!transport) return;
    void refresh();
    const stop = transport.openStream(
      (frame) => setStatus((s) => (s ? applyFrame(s, frame) : s)),
      () => void refresh(),
    );
    return () => {
      live.current = false;
      stop();
    };
  }, [transport, refresh]);

  const request = useCallback(async <T,>(key: string, run: (t: SetupTransport) => Promise<T>): Promise<T | null> => {
    if (!transport) return null;
    setBusy(key);
    setRequestError(null);
    try {
      return await run(transport);
    } catch (err) {
      if (live.current) setRequestError(requestMessage(err));
      return null;
    } finally {
      if (live.current) setBusy(null);
    }
  }, [transport]);

  const applyWizard = (w: Wizard | null) => {
    if (w) setStatus((s) => (s ? withWizard(s, w) : s));
  };
  const applyStep = (step: SetupStep | null) => {
    if (step) setStatus((s) => (s ? withStep(s, step) : s));
  };

  return {
    status,
    loading: transport ? loading : false,
    loadError,
    requestError,
    busy,
    refresh,
    start: async (wizard) => applyWizard(await request(wizard, (t) => startWizard(t, wizard))),
    abort: async (wizard) => applyWizard(await request(wizard, (t) => abortWizard(t, wizard))),
    action: async (step, actionId, args) =>
      applyStep(
        await request(`${step.wizard}/${step.step}/${actionId}`, (t) =>
          runStepAction(t, step.wizard, step.step, actionId, args),
        ),
      ),
    runStep: async (wizard, step) =>
      applyStep(await request(`${wizard}/${step}/run`, (t) => rerunStep(t, wizard, step))),
    revert: async (snapshot) => {
      const restored = await request("revert", (t) => revertToSnapshot(t, snapshot));
      if (restored !== null) await refresh();
      return restored;
    },
  };
}

/** The setup controller for a drone when its agent's setup engine answers
 *  (an identified FC), else null: callers then keep their MAVLink path. */
export function useAgentFcSetup(droneId: string | null | undefined): FcSetupController | null {
  const transport = useDroneSetupTransport(droneId);
  const setup = useFcSetup(transport);
  return transport && setup.status?.uid ? setup : null;
}

/** A step of a wizard in the current status, or null. */
export function findStep(status: SetupStatus | null, wizard: string, step: string): SetupStep | null {
  return status?.wizards.find((w) => w.id === wizard)?.steps.find((s) => s.step === step) ?? null;
}
