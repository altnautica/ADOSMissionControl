"use client";

/**
 * @module use-resolved-agent-video
 * @description The agent video source every video surface dials, resolved in
 * one place.
 *
 * The singleton video store is filled by the LAN status poll or a cloud
 * heartbeat. A drone reached through another node (linked to a paired ground
 * station over the radio) has neither, so that store stays empty even though
 * the ground station already decodes the drone's downlink into its own media
 * server and publishes the playable URL on the drone's fleet-status row. The
 * singleton wins when it knows anything; otherwise the funnelled row fills in
 * both the URL and the reported state.
 *
 * The reported state feeds the connection gates in
 * {@link useSingletonAgentVideo}: a surface that resolved a funnelled feed
 * must hand the same resolved state to the retry and stall gates, or a
 * failed first attempt is never retried.
 *
 * @license GPL-3.0-only
 */

import { useVideoStore } from "@/stores/video-store";
import { useCommandFleetStore } from "@/stores/command-fleet-store";
import { resolveAgentVideoUrl } from "@/lib/agent/video-url";

export interface ResolvedAgentVideo {
  /** URL to dial: the singleton agent URL, else the funnelled one. */
  whepUrl: string | null;
  /** The funnelled URL alone, so a surface can name a relayed producer. */
  funneledWhepUrl: string | null;
  /** The agent's reported video state for the resolved source. */
  videoState: string;
}

/**
 * @param deviceId the node whose fleet-status row may carry a funnelled feed;
 *   null or undefined disables the fallback.
 */
export function useResolvedAgentVideo(
  deviceId: string | null | undefined,
): ResolvedAgentVideo {
  const singletonWhepUrl = useVideoStore((s) => s.agentWhepUrl);
  const singletonVideoState = useVideoStore((s) => s.agentVideoState);
  const nodeStatus = useCommandFleetStore((s) =>
    deviceId ? s.cloudStatuses[deviceId] : undefined,
  );
  const funneledWhepUrl = resolveAgentVideoUrl(nodeStatus);
  const videoState =
    singletonVideoState && singletonVideoState !== "unknown"
      ? singletonVideoState
      : (nodeStatus?.videoState ?? singletonVideoState);
  return {
    whepUrl: singletonWhepUrl ?? funneledWhepUrl,
    funneledWhepUrl,
    videoState,
  };
}
