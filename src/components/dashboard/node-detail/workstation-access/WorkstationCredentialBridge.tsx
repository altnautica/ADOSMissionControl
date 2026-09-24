"use client";

/**
 * @module WorkstationCredentialBridge
 * @description Headless: keeps every paired drone and ground station holding a
 * credential from every paired workstation, so their lanes to it are admitted.
 *
 * Provisions a new pair as soon as both nodes are paired, re-provisions after
 * either is re-paired, and retries a failed pair on a fixed interval (see
 * `workstation-provisioning`). It runs on an HTTPS origin too: both calls have
 * a same-origin proxy. Mounted once with the other agent bridges, which are not
 * mounted in demo.
 * @license GPL-3.0-only
 */

import { useEffect, useState } from "react";

import {
  planProvisioning,
  provisionAndRecord,
  PROVISION_RETRY_MS,
} from "@/lib/nodes/workstation-provisioning";
import { useLocalNodesStore } from "@/stores/local-nodes-store";
import { useWorkstationLinkStore } from "@/stores/workstation-link-store";

export function WorkstationCredentialBridge() {
  const nodes = useLocalNodesStore((s) => s.nodes);
  const links = useWorkstationLinkStore((s) => s.links);
  const inFlight = useWorkstationLinkStore((s) => s.inFlight);
  const hasFailed = Object.values(links).some((l) => l.state === "failed");
  const [retryTick, setRetryTick] = useState(0);

  // Only a failed link needs a clock: everything else is driven by a change to
  // the paired nodes or the recorded links.
  useEffect(() => {
    if (!hasFailed) return;
    const id = setInterval(() => setRetryTick((t) => t + 1), PROVISION_RETRY_MS);
    return () => clearInterval(id);
  }, [hasFailed]);

  useEffect(() => {
    useWorkstationLinkStore.getState().prune(nodes.map((n) => n.deviceId));
  }, [nodes]);

  useEffect(() => {
    for (const pair of planProvisioning(nodes, links, inFlight, Date.now())) {
      void provisionAndRecord(pair);
    }
  }, [nodes, links, inFlight, retryTick]);

  return null;
}
