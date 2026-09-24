/**
 * @module workstation-provisioning
 * @description Which paired nodes need a workstation credential, and the one
 * act that gives them one.
 *
 * Whenever this GCS holds a paired workstation and a paired drone (or ground
 * station), the drone needs a credential from that workstation for its lanes
 * (see `node-credential-client`). {@link planProvisioning} is the pure decision
 * over the paired nodes and the recorded links; {@link provisionAndRecord}
 * issues on the workstation, installs on the peer, and records the outcome.
 * A failed link is retried on a fixed interval with no cap; a revoked one only
 * when the operator asks.
 * @license GPL-3.0-only
 */

import { ComputeAgentClient } from "@/lib/agent/compute-client";
import {
  DRONE_LANES,
  GROUND_STATION_LANES,
  installWorkstationCredential,
  issueNodeCredential,
  type NodeLane,
} from "@/lib/agent/node-credential-client";
import type { LocalNode } from "@/stores/local-nodes-store";
import {
  useWorkstationLinkStore,
  workstationLinkKey,
  type WorkstationLink,
} from "@/stores/workstation-link-store";

/** Fixed interval between attempts on a link that failed. */
export const PROVISION_RETRY_MS = 5000;

/** One workstation-to-peer link to provision. */
export interface ProvisionPair {
  workstation: LocalNode;
  peer: LocalNode;
  lanes: readonly NodeLane[];
}

/** The lanes a node of `profile` is issued, or `null` for a profile that uses
 * no workstation lane. */
export function lanesForPeer(profile: LocalNode["profile"]): readonly NodeLane[] | null {
  switch (profile) {
    case "drone":
      return DRONE_LANES;
    case "ground-station":
      return GROUND_STATION_LANES;
    case "workstation":
      return null;
  }
}

/**
 * Every workstation-to-peer link that needs provisioning now: never
 * provisioned; provisioned before either node was last (re-)paired; or failed
 * at least {@link PROVISION_RETRY_MS} ago. A revoked link and one already in
 * flight are skipped.
 */
export function planProvisioning(
  nodes: readonly LocalNode[],
  links: Readonly<Record<string, WorkstationLink>>,
  inFlight: Readonly<Record<string, true>>,
  now: number,
): ProvisionPair[] {
  const pairs: ProvisionPair[] = [];
  for (const workstation of nodes) {
    // A node is reachable once it has an address and this GCS holds its key.
    if (workstation.profile !== "workstation" || !workstation.hostname || !workstation.apiKey) {
      continue;
    }
    for (const peer of nodes) {
      const lanes = lanesForPeer(peer.profile);
      if (!lanes || peer.deviceId === workstation.deviceId || !peer.hostname || !peer.apiKey) {
        continue;
      }
      const key = workstationLinkKey(workstation.deviceId, peer.deviceId);
      if (inFlight[key]) continue;
      const link = links[key];
      const repaired =
        link !== undefined &&
        (link.workstationPairedAt !== workstation.pairedAt ||
          link.peerPairedAt !== peer.pairedAt);
      const due =
        link === undefined ||
        (link.state !== "revoked" && repaired) ||
        (link.state === "failed" && now - link.at >= PROVISION_RETRY_MS);
      if (due) pairs.push({ workstation, peer, lanes });
    }
  }
  return pairs;
}

/**
 * Issue a credential for `pair.peer` on the workstation, install it on the
 * peer, and record the outcome. One attempt per pair at a time; a pair already
 * in flight is left alone.
 */
export async function provisionAndRecord(pair: ProvisionPair): Promise<WorkstationLink> {
  const { workstation, peer, lanes } = pair;
  const key = workstationLinkKey(workstation.deviceId, peer.deviceId);
  const store = useWorkstationLinkStore.getState();
  const base = {
    workstationDeviceId: workstation.deviceId,
    peerDeviceId: peer.deviceId,
    workstationPairedAt: workstation.pairedAt,
    peerPairedAt: peer.pairedAt,
  };
  if (store.inFlight[key]) {
    return store.links[key] ?? { ...base, state: "failed", at: Date.now(), error: "in progress" };
  }
  store.setInFlight(key, true);
  let link: WorkstationLink;
  try {
    const issued = await issueNodeCredential(
      new ComputeAgentClient(workstation.hostname, workstation.apiKey),
      peer.deviceId,
      lanes,
    );
    if (!issued.ok) {
      link = { ...base, state: "failed", at: Date.now(), error: `workstation: ${issued.message}` };
    } else {
      const installed = await installWorkstationCredential(
        { baseUrl: peer.hostname, apiKey: peer.apiKey },
        issued,
      );
      link = installed.ok
        ? { ...base, state: "provisioned", credentialId: issued.id, at: Date.now() }
        : {
            ...base,
            state: "failed",
            credentialId: issued.id,
            at: Date.now(),
            error: `${peer.name}: ${installed.message}`,
          };
    }
  } finally {
    useWorkstationLinkStore.getState().setInFlight(key, false);
  }
  useWorkstationLinkStore.getState().record(link);
  return link;
}
