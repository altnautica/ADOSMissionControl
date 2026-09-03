"use client";

/**
 * @module command/nodes-view/CloudCommandAckWatcher
 * @description Watches every in-flight cloud-relay command for the vehicle's own
 * answer and surfaces it.
 *
 * The cloud command lane is store-and-forward: a queued command reports only
 * "queued" the instant it is accepted, and the vehicle's real accepted/rejected
 * verdict lands later on the queue row. This mounts one reactive subscription per
 * outstanding queue row (recorded by the command sink's `onQueued` seam) and,
 * when a row reaches a terminal status, raises a toast carrying the vehicle's own
 * result — an honest acknowledgement rather than a permanent "queued". Each watch
 * drops itself once resolved, so the set stays bounded by what is actually in
 * flight.
 *
 * Renders nothing. It is a set of live subscriptions, not UI.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useMemo } from "react";

import { useConvexAvailable } from "@/app/ConvexClientProvider";
import { useConvexSkipQuery } from "@/hooks/use-convex-skip-query";
import type { FleetNodeEntry } from "@/hooks/use-fleet-nodes";
import { notifySkill } from "@/lib/skills";
import {
  useCloudCommandAckStore,
  type OutstandingCloudCommand,
} from "@/stores/cloud-command-ack-store";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

export function CloudCommandAckWatcher({
  nodes,
}: {
  nodes: readonly FleetNodeEntry[];
}) {
  const pending = useCloudCommandAckStore((s) => s.pending);
  const convexAvailable = useConvexAvailable();
  const nameByDeviceId = useMemo(
    () => new Map(nodes.map((n) => [n.deviceId, n.name])),
    [nodes],
  );

  // The queue rows only exist in a backed session, and every watched id was
  // minted by an authenticated enqueue — with no backend there is nothing to
  // subscribe to.
  if (!convexAvailable || pending.length === 0) return null;

  return (
    <>
      {pending.map((command) => (
        <CommandAckWatch
          key={command.commandId}
          command={command}
          nodeName={nameByDeviceId.get(command.deviceId) ?? command.deviceId}
        />
      ))}
    </>
  );
}

/** One reactive subscription to a single queue row's terminal status. */
function CommandAckWatch({
  command,
  nodeName,
}: {
  command: OutstandingCloudCommand;
  nodeName: string;
}) {
  const resolve = useCloudCommandAckStore((s) => s.resolve);
  // `getCommandStatus` resolves the caller's ownership of the command, so it
  // throws for an anonymous caller. A bare `useQuery` propagates that throw out
  // of render and into the nearest error.tsx — a session that expired while a
  // command was in flight BLACK-SCREENED the whole nodes view. The skip-aware
  // wrapper skips when Convex is unavailable or demo mode is on, and resolves a
  // server-side throw to `undefined`, which is the same shape as "still loading"
  // and is exactly how the effect below already treats it.
  const status = useConvexSkipQuery(api.cmdDroneCommands.getCommandStatus, {
    args: { commandId: command.commandId as Id<"cmd_droneCommands"> },
  });

  useEffect(() => {
    if (!status) return;
    if (status.status !== "completed" && status.status !== "failed") return;
    // Terminal: the vehicle's answer is in. A completed row with no explicit
    // failure is an acceptance; anything else is a refusal. Prefer the vehicle's
    // own message so the operator hears the real reason, not a generic line.
    const accepted =
      status.status === "completed" && status.result?.success !== false;
    const message =
      status.result?.message ??
      (accepted
        ? `${nodeName} acknowledged the queued command`
        : `${nodeName} rejected the queued command`);
    notifySkill(message, accepted ? "success" : "error");
    resolve(command.commandId);
  }, [status, command.commandId, nodeName, resolve]);

  return null;
}
