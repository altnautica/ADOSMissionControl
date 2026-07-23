"use client";

/**
 * @module command/nodes-view/use-node-command-lane
 * @description Resolves the two things every board row needs to work out its
 * own command reach, and resolves them once for the whole board.
 *
 * The cloud queue writer is a React-scoped mutation handle and the page origin
 * is a browser fact, so neither can be read from the pure reach resolver. This
 * hook holds both, memoised, and hands them down as one options object so a
 * fleet of rows shares one mutation handle and one stable memo key.
 *
 * The queue writer is null unless a backend is configured and this is not demo
 * mode, so a local-only or demo session resolves LAN reach or nothing at all
 * rather than queueing commands nobody will ever deliver.
 *
 * @license GPL-3.0-only
 */

import { useMemo, useState } from "react";
import { useMutation } from "convex/react";

import { useConvexAvailable } from "@/app/ConvexClientProvider";
import { isDemoMode } from "@/lib/utils";
import type {
  CloudCommandEnqueuer,
  NodeCommandSinkOptions,
} from "@/lib/nodes/command-sink";
import { useCloudCommandAckStore } from "@/stores/cloud-command-ack-store";
import { api } from "../../../../convex/_generated/api";

export function useNodeCommandLane(): NodeCommandSinkOptions {
  const convexAvailable = useConvexAvailable();
  const enqueue = useMutation(api.cmdDroneCommands.enqueueCommand);

  // The origin cannot change without a navigation, and reading it during the
  // first render would differ between the server and the client.
  const [originIsHttps] = useState(
    () => typeof window !== "undefined" && window.location.protocol === "https:",
  );

  const enqueueCloudCommand: CloudCommandEnqueuer | null = useMemo(() => {
    if (isDemoMode()) {
      // The simulated fleet takes commands too, so every control on the board
      // is exercisable offline. Loaded on demand so the mock never reaches a
      // production bundle.
      return async ({ deviceId, args }) => {
        const { applyDemoNodeCommand } = await import(
          "@/mock/demo-node-commands"
        );
        applyDemoNodeCommand(deviceId, args.cmd, args.args);
        return { commandId: `demo-${deviceId}-${Date.now()}` };
      };
    }
    if (!convexAvailable) return null;
    return (args) => enqueue(args);
  }, [convexAvailable, enqueue]);

  // Record every queued cloud command so a mounted watcher can surface the
  // vehicle's real answer. Only a real backed session mints a watchable queue
  // row: a demo command id is synthetic and has no row to poll, so it is left
  // unwatched and the cloud dispatch reports "queued" as before.
  const onQueued: NodeCommandSinkOptions["onQueued"] = useMemo(() => {
    if (isDemoMode() || !convexAvailable) return undefined;
    return (queued) => useCloudCommandAckStore.getState().watch(queued);
  }, [convexAvailable]);

  return useMemo<NodeCommandSinkOptions>(
    () => ({ enqueueCloudCommand, onQueued, originIsHttps }),
    [enqueueCloudCommand, onQueued, originIsHttps],
  );
}
