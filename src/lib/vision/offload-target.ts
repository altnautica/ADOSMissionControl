/**
 * @module vision/offload-target
 * @description Maps a LAN-paired workstation node to the `host:port` address a
 * drone agent stores as its perception-offload target
 * (`perception.offload.compute_node_addr`). One helper so the node Settings
 * "Pin workstation" control and the Vision-tab tier card write the SAME stored
 * value — two views of one link. An empty string means auto-discover (the
 * agent picks any serving workstation on the LAN).
 * @license GPL-3.0-only
 */

import { COMPUTE_JOB_PORT } from "@/lib/agent/compute-client";
import type { LocalNode } from "@/stores/local-nodes-store";

/**
 * The address the drone agent dials for offload: the workstation's verified
 * reach HOST plus the ados-compute engine's job-API port (`:8092`), NOT the
 * ados-control front (`:8080`) the GCS paired to. The offload path submits jobs
 * to the compute engine, which listens on its own port; a pin to `:8080` would
 * 404 (that front does not serve `/api/compute/jobs`). Empty when the node has
 * no reachable host.
 */
export function nodeToOffloadAddr(node: Pick<LocalNode, "hostname">): string {
  const raw = node.hostname?.trim();
  if (!raw) return "";
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `http://${raw}`);
    return `${u.hostname}:${COMPUTE_JOB_PORT}`;
  } catch {
    return raw;
  }
}
