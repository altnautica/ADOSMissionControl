/**
 * @module hooks/use-live-sweep
 * @description Navigation's live sweep cloud for the Map tab's 3D view.
 * While `active`, polls `GET /api/plugins/com.altnautica.navigation/x/
 * navigation/sweep?since=<seq>` once a second through the node's plugin reach
 * (LAN, the HTTPS proxy, or a ground station's relay), folds each reply into
 * the held cloud ({@link applySweep}) and bumps `version` so the canvas
 * re-uploads it. A node whose Navigation serves no sweep (404 or 503), or
 * that this browser cannot reach, reads `unavailable`; a failed poll keeps the
 * cloud and retries. Demo mode answers from the synthetic warehouse sweep.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useRef, useState } from "react";

import {
  applySweep,
  emptySweepCloud,
  parseSweep,
  type SweepCloud,
} from "@/components/drone-detail/map/sweep-cloud";
import { NAVIGATION_PLUGIN_ID } from "@/hooks/use-nav-feed";
import { deviceIdFromNodeId } from "@/lib/agent/node-id";
import { pluginClientForReach, resolveNodeAgentReach } from "@/lib/plugins/node-agent-reach";
import { isDemoMode } from "@/lib/utils";

export const SWEEP_POLL_MS = 1000;

export type SweepState = "loading" | "live" | "unavailable";

export interface LiveSweep {
  cloud: SweepCloud;
  /** Bumped on every reply that changed the cloud. */
  version: number;
  state: SweepState;
}

type SweepReply = ArrayBuffer | "unavailable";

async function fetchSweep(deviceId: string, since: number | null): Promise<SweepReply> {
  if (isDemoMode()) {
    // Loaded on demand so the demo mocks stay out of the production bundle.
    const { demoSweepReply } = await import("@/mock/mock-live-map");
    return demoSweepReply(since);
  }
  const reach = resolveNodeAgentReach(deviceId);
  if (!reach) return "unavailable";
  const path = since === null ? "navigation/sweep" : `navigation/sweep?since=${since}`;
  const res = await pluginClientForReach(reach).pluginHttp(NAVIGATION_PLUGIN_ID, path);
  if (res.status === 404 || res.status === 503) return "unavailable";
  if (!res.ok) throw new Error(`sweep HTTP ${res.status}`);
  return res.arrayBuffer();
}

export function useLiveSweep(droneId: string, active: boolean): LiveSweep {
  const cloud = useRef<SweepCloud>(emptySweepCloud());
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<SweepState>("loading");

  // A different drone starts from nothing. Declared before the poll so it
  // runs first when the drone changes, and the new poll asks for the whole
  // cloud.
  useEffect(() => {
    cloud.current = emptySweepCloud();
    setVersion((v) => v + 1);
    setState("loading");
  }, [droneId]);

  useEffect(() => {
    if (!active) return;
    const deviceId = deviceIdFromNodeId(droneId) ?? droneId;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const reply = await fetchSweep(deviceId, cloud.current.seq);
        if (stopped) return;
        if (reply === "unavailable") {
          setState("unavailable");
          return;
        }
        const frame = parseSweep(reply);
        if (frame && (frame.reset || frame.count > 0 || cloud.current.seq === null)) {
          cloud.current = applySweep(cloud.current, frame);
          setVersion((v) => v + 1);
        } else if (frame) {
          cloud.current = { ...cloud.current, seq: frame.seq };
        }
        setState("live");
      } catch {
        // A failed poll keeps what the view holds; the next one retries.
      }
      if (!stopped) timer = setTimeout(poll, SWEEP_POLL_MS);
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [active, droneId]);

  return { cloud: cloud.current, version, state };
}
