/**
 * @module node-credential-client
 * @description Moving a workstation-issued credential onto the nodes that use
 * the workstation's lanes.
 *
 * Each node mints its own pairing key, so a drone cannot authenticate to a
 * workstation with its own key, and must never hand that key to one. The GCS
 * holds the owner key of both, so it asks the workstation to issue the drone a
 * credential scoped to the lanes a drone uses (the Atlas ingest and world
 * stream, the offload session and its detection stream, the artifacts), and
 * installs it on the drone. A ground station, which only relays Atlas events,
 * is issued the ingest lane alone.
 *
 * Workstation side (its job API, `:8092`, through {@link ComputeAgentClient}):
 * issue, list, revoke, and the short-lived ticket a browser offers to open the
 * world stream. Drone side (its control front, `:8080`): install and list.
 * On an HTTPS origin the drone calls ride `/api/lan-pair/workstation-credential`
 * and the workstation calls ride `/api/lan-pair/compute`, as every LAN call does.
 * @license GPL-3.0-only
 */

import type { ComputeAgentClient } from "./compute-client";
import { timedFetch } from "@/lib/agent/agent-client/timeout";

/** The lanes a credential can be scoped to (the agent's wire names). */
export type NodeLane =
  | "atlas.ingest"
  | "atlas.world"
  | "offload.stream"
  | "artifacts.read"
  | "jobs.submit";

export const DRONE_LANES: readonly NodeLane[] = [
  "atlas.ingest",
  "atlas.world",
  "offload.stream",
  "artifacts.read",
  "jobs.submit",
];

/** A ground station only relays Atlas capture events off the air. */
export const GROUND_STATION_LANES: readonly NodeLane[] = ["atlas.ingest"];

/** The ticket scope the workstation's world stream accepts. */
export const WORLD_TICKET_SCOPE = "compute.atlas_world";

/** A credential a workstation just issued; `credential` is shown once. */
export interface IssuedNodeCredential {
  id: string;
  peerDeviceId: string;
  lanes: NodeLane[];
  createdAtMs: number;
  credential: string;
  /** The id the workstation advertises over mDNS; the drone files the
   * credential under it so each lane presents it only to that workstation. */
  workstationNodeId: string;
}

/** One credential as the workstation lists it (never the secret). */
export interface ListedNodeCredential {
  id: string;
  peerDeviceId: string;
  lanes: NodeLane[];
  createdAtMs: number;
  /** Issued under the workstation's current owner key; false once the
   * workstation was re-paired, when it admits nothing. */
  current: boolean;
}

/** A failed call: the HTTP status (0 = unreachable) and the agent's reason. */
export interface CallFailure {
  ok: false;
  status: number;
  message: string;
}

function lanesOf(v: unknown): NodeLane[] {
  const known: readonly string[] = DRONE_LANES;
  return Array.isArray(v)
    ? v.filter((l): l is NodeLane => typeof l === "string" && known.includes(l))
    : [];
}

function failure(r: { status: number; json: unknown } | null): CallFailure {
  if (!r) return { ok: false, status: 0, message: "unreachable" };
  const body = r.json as Record<string, unknown> | null;
  const reason = body?.error ?? body?.detail;
  return {
    ok: false,
    status: r.status,
    message: typeof reason === "string" ? reason : `HTTP ${r.status}`,
  };
}

/** Ask the workstation to issue `peerDeviceId` a credential for `lanes`,
 * replacing any it issued that peer before. */
export async function issueNodeCredential(
  workstation: ComputeAgentClient,
  peerDeviceId: string,
  lanes: readonly NodeLane[],
): Promise<({ ok: true } & IssuedNodeCredential) | CallFailure> {
  const r = await workstation.jobCall("node-credentials", "POST", {
    peer_device_id: peerDeviceId,
    lanes,
  });
  const b = r?.json as Record<string, unknown> | null | undefined;
  if (
    !r ||
    r.status !== 201 ||
    typeof b?.credential !== "string" ||
    typeof b.id !== "string" ||
    typeof b.workstation_node_id !== "string"
  ) {
    return failure(r);
  }
  return {
    ok: true,
    id: b.id,
    peerDeviceId: typeof b.peer_device_id === "string" ? b.peer_device_id : peerDeviceId,
    lanes: lanesOf(b.lanes),
    createdAtMs: typeof b.created_at_ms === "number" ? b.created_at_ms : 0,
    credential: b.credential,
    workstationNodeId: b.workstation_node_id,
  };
}

/** Every credential the workstation issued, or `null` when it cannot be read. */
export async function listNodeCredentials(
  workstation: ComputeAgentClient,
): Promise<ListedNodeCredential[] | null> {
  const r = await workstation.jobCall("node-credentials", "GET");
  const b = r?.json as Record<string, unknown> | null | undefined;
  if (!r || r.status !== 200 || !Array.isArray(b?.credentials)) return null;
  return b.credentials.flatMap((raw): ListedNodeCredential[] => {
    const c = raw as Record<string, unknown>;
    if (typeof c?.id !== "string" || typeof c.peer_device_id !== "string") return [];
    return [
      {
        id: c.id,
        peerDeviceId: c.peer_device_id,
        lanes: lanesOf(c.lanes),
        createdAtMs: typeof c.created_at_ms === "number" ? c.created_at_ms : 0,
        current: c.current === true,
      },
    ];
  });
}

/** Revoke one credential on the workstation. */
export async function revokeNodeCredential(
  workstation: ComputeAgentClient,
  id: string,
): Promise<{ ok: true } | CallFailure> {
  const r = await workstation.jobCall(
    `node-credentials/${encodeURIComponent(id)}/revoke`,
    "POST",
  );
  const b = r?.json as Record<string, unknown> | null | undefined;
  return r && r.status === 200 && b?.revoked === true ? { ok: true } : failure(r);
}

/** A short-lived ticket for the workstation's world stream, or `null` when the
 * workstation will not mint one (unpaired: the stream is open anyway). */
export async function mintWorldTicket(
  workstation: ComputeAgentClient,
): Promise<string | null> {
  const r = await workstation.jobCall("ws-ticket", "POST", {
    scope: WORLD_TICKET_SCOPE,
  });
  const b = r?.json as Record<string, unknown> | null | undefined;
  return r?.status === 200 && typeof b?.ticket === "string" ? b.ticket : null;
}

/** The drone-side path, on its `:8080` control front. */
const INSTALL_PATH = "/api/compute/workstation-credential";

/** Install a workstation-issued credential on a node (a drone or ground
 * station) through its own control front. */
export async function installWorkstationCredential(
  node: { baseUrl: string; apiKey: string },
  issued: Pick<IssuedNodeCredential, "workstationNodeId" | "credential" | "lanes">,
): Promise<{ ok: true } | CallFailure> {
  const body = {
    workstation_node_id: issued.workstationNodeId,
    credential: issued.credential,
    lanes: issued.lanes,
  };
  const useProxy =
    typeof window !== "undefined" && window.location.protocol === "https:";
  let res: Response;
  try {
    res = useProxy
      ? await timedFetch("/api/lan-pair/workstation-credential", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            host: node.baseUrl,
            apiKey: node.apiKey,
            method: "POST",
            body,
          }),
        })
      : await timedFetch(`${node.baseUrl.replace(/\/+$/, "")}${INSTALL_PATH}`, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "X-ADOS-Key": node.apiKey,
          },
          body: JSON.stringify(body),
        });
  } catch {
    return failure(null);
  }
  if (!res) return failure(null);
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  const b = json as Record<string, unknown> | null;
  return res.status === 200 && b?.installed === true
    ? { ok: true }
    : failure({ status: res.status, json });
}
