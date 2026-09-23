"use client";

/**
 * @module use-drone-world-model
 * @description Local-first source for a drone's reconstructed world model
 * (local-first). Resolves the paired compute / workstation node the drone
 * reconstructs on (from `local-nodes-store`), polls its job API (reusing
 * `use-compute-jobs`, the engine's own `:8092` listener), and resolves the
 * newest completed reconstruction for a session — correlated by `session_id`,
 * the key the compute job and the drone's atlas heartbeat share.
 *
 * The drone-detail World Model (post-flight) and Live World (in-flight) tabs
 * render this artifact LOCAL-FIRST and fall back to the Convex `cmd_atlasJobs`
 * cloud-relay path only when no compute node is paired locally or its job API is
 * unreachable (cloud relay is the secondary path).
 *
 * The reconstructor node is not drone-scoped (a session id is `atlas-<ms>`, not
 * derived from the capturing drone), so the active session is the correlation
 * key: the Live World tab passes the drone's reported `live.sessionId`; the
 * post-flight tab passes the operator's selected session, or null to resolve the
 * newest completed reconstruction on the node (its session selector disambiguates
 * when more than one drone reconstructed there).
 *
 * @license GPL-3.0-only
 */

import { useEffect, useMemo, useState } from "react";

import {
  viewerForKind,
  type AtlasViewer,
} from "@/components/atlas/viewer-types";
import type { ComputeAgentClient } from "@/lib/agent/compute-client";
import { useComputeJobs } from "@/hooks/use-compute-jobs";
import { useLocalNodesStore } from "@/stores/local-nodes-store";

/** A completed reconstruction session on the compute node (a selector entry). */
export interface WorldModelSession {
  /** The capturing session id (the correlation key). */
  sessionId: string;
  /** The newest completed reconstruct job for this session. */
  jobId: string;
  /** When that job was created (epoch ms). */
  createdMs: number;
}

/** The local-first path's status for the requested session. */
export type WorldModelStatus =
  /** Local-first not applicable — signed in, demo, or no compute node paired.
   * The caller falls back to the Convex `cmd_atlasJobs` path. */
  | "inactive"
  /** A compute node is paired but its job API is unreachable. The caller falls
   * back to the Convex path. */
  | "unreachable"
  /** The compute node is reachable but has no completed reconstruction for the
   * requested session yet. The caller shows a "building…" state. */
  | "building"
  /** A completed reconstruction is resolved (`artifactUrl` + `viewerHint` set). */
  | "ready";

export interface DroneWorldModel {
  /** Whether a workstation / compute node is paired locally at all (independent
   * of reachability). Drives the "pair a compute node" guidance vs the generic
   * empty state. */
  hasComputeNode: boolean;
  status: WorldModelStatus;
  /** The resolved artifact URL when `status === "ready"`, else null. */
  artifactUrl: string | null;
  /** Viewer derived from the artifact kind when ready, else null. */
  viewerHint: AtlasViewer | null;
  /** The concrete reconstruction backend of the resolved artifact (`"mock"` =
   * placeholder, else the real backend name), or null when none is resolved.
   * Drives the reconstruction-honesty badge (no fabricated reading). */
  backend: string | null;
  /** Completed reconstruction sessions on the node, newest-first (selector). */
  sessions: WorldModelSession[];
  /** The bare device id of the resolved reconstructor node, or null when none
   * is paired. */
  computeNodeDeviceId: string | null;
  /** A client for the resolved reconstructor node (for on-demand submits like
   * "Reconstruct now"), or null when not local-first for the node. Reuses the
   * job-poll client so there is no second poll loop. */
  computeClient: ComputeAgentClient | null;
}

export interface DroneWorldModelParams {
  /** The session to resolve — the active `live.sessionId` on the Live World tab,
   * or a selected session on the post-flight tab. Null resolves the newest
   * completed reconstruction on the node. */
  sessionId: string | null;
  /** The compute node the drone reports it reconstructs on (the Live World
   * heartbeat's `computeNodeId`), used to pinpoint the node among several paired
   * workstation nodes. Optional; falls back to the newest-paired one. */
  computeNodeId?: string | null;
}

/**
 * Resolve a drone's world model local-first from the paired compute node. No-op
 * (status `inactive`) when not local-first (signed in, demo, no LAN key) or when
 * no workstation node is paired — the caller then falls back to Convex.
 */
export function useDroneWorldModel({
  sessionId,
  computeNodeId,
}: DroneWorldModelParams): DroneWorldModel {
  // Candidate reconstructors: every workstation node the operator paired over the
  // LAN. (The reserved lean `compute` headless profile is not in the local-node
  // profile union yet; workstation is the compute profile today.) Select the
  // stable `nodes` reference and filter in a memo — a `.filter()` inside the
  // zustand selector returns a fresh array each render and loops re-renders.
  const nodes = useLocalNodesStore((s) => s.nodes);
  const workstationNodes = useMemo(
    () => nodes.filter((n) => n.profile === "workstation"),
    [nodes],
  );

  // Prefer the node the drone reports as its reconstructor; else the
  // newest-paired workstation node.
  const targetNodeId = useMemo<string | null>(() => {
    if (workstationNodes.length === 0) return null;
    if (computeNodeId) {
      const match = workstationNodes.find((n) => n.deviceId === computeNodeId);
      if (match) return match.deviceId;
    }
    return [...workstationNodes].sort((a, b) => b.pairedAt - a.pairedAt)[0]
      .deviceId;
  }, [workstationNodes, computeNodeId]);

  const { jobs, unreachable, client } = useComputeJobs(targetNodeId);

  // Completed reconstruct jobs that carry a session, newest-first. Offload jobs
  // (no session, not a world model) and in-flight jobs are excluded.
  const completed = useMemo(
    () =>
      jobs
        .filter(
          (j) =>
            j.state === "completed" &&
            j.kind === "reconstruct" &&
            Boolean(j.sessionId),
        )
        .sort((a, b) => b.updatedMs - a.updatedMs),
    [jobs],
  );

  const sessions = useMemo<WorldModelSession[]>(() => {
    const seen = new Set<string>();
    const out: WorldModelSession[] = [];
    for (const j of completed) {
      const sid = j.sessionId as string;
      if (seen.has(sid)) continue;
      seen.add(sid);
      out.push({ sessionId: sid, jobId: j.id, createdMs: j.createdMs });
    }
    return out;
  }, [completed]);

  // The newest completed reconstruction for the requested session, or the newest
  // overall when the session is unknown (the post-flight default).
  const targetJobId = useMemo<string | null>(() => {
    if (completed.length === 0) return null;
    const match = sessionId
      ? completed.find((j) => j.sessionId === sessionId)
      : completed[0];
    return match?.id ?? null;
  }, [completed, sessionId]);

  // Resolve the artifact by fetching the target job's outputs (uri + kind). The
  // result is tagged by job id so a session switch never surfaces the previous
  // job's artifact: `resolved` below only accepts an `art` whose `jobId` still
  // matches the current target, so a stale or cleared target reads as no
  // artifact without a synchronous clear in the effect body.
  const [art, setArt] = useState<{
    jobId: string;
    uri: string;
    viewer: AtlasViewer;
    backend: string | null;
  } | null>(null);

  useEffect(() => {
    if (!client || !targetJobId) return;
    let cancelled = false;
    void client.getOutputs(targetJobId).then((outs) => {
      if (cancelled) return;
      const first = (outs ?? [])[0];
      setArt(
        first
          ? {
              jobId: targetJobId,
              uri: first.uri,
              viewer: viewerForKind(first.kind),
              backend: first.backend,
            }
          : null,
      );
    });
    return () => {
      cancelled = true;
    };
  }, [client, targetJobId]);

  const hasComputeNode = workstationNodes.length > 0;
  const resolved = art && art.jobId === targetJobId ? art : null;

  let status: WorldModelStatus;
  if (!client) status = "inactive";
  else if (resolved) status = "ready";
  else if (unreachable) status = "unreachable";
  else status = "building";

  return {
    hasComputeNode,
    status,
    artifactUrl: resolved?.uri ?? null,
    viewerHint: resolved?.viewer ?? null,
    backend: resolved?.backend ?? null,
    sessions,
    computeNodeDeviceId: targetNodeId,
    computeClient: client,
  };
}
