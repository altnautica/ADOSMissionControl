// Distributed RX role transitions, batman-adv mesh health, and the relay-receiver pairing flow.

import type {
  GroundStationRole,
  MeshConfig,
  MeshConfigUpdate,
  MeshEvent,
  MeshGateway,
  MeshGatewayPreferenceUpdate,
  MeshHealth,
  MeshNeighbor,
  MeshRoute,
  PairingApproveResult,
  PairingRevokeResult,
  PairingSnapshot,
  PairingWindow,
  PairJoinRequest,
  PairJoinResult,
  RoleInfo,
} from "./types";
import { gsRequest, type RequestContext } from "./request";
import { subscribeWebSocket } from "./ws";

// --- Role ---

/** Get the ground-station role snapshot. */
export function getRole(ctx: RequestContext): Promise<RoleInfo> {
  return gsRequest<RoleInfo>(ctx, "/api/v1/ground-station/role");
}

/** Apply a role transition. 409 E_NOT_PAIRED when relay target is unpaired. */
export function setRole(ctx: RequestContext, role: GroundStationRole): Promise<RoleInfo> {
  return gsRequest<RoleInfo>(ctx, "/api/v1/ground-station/role", {
    method: "PUT",
    body: JSON.stringify({ role }),
  });
}

// --- Mesh health and topology ---

/** Mesh health snapshot. 404 E_NOT_IN_MESH when role is direct. */
export function getMeshHealth(ctx: RequestContext): Promise<MeshHealth> {
  return gsRequest<MeshHealth>(ctx, "/api/v1/ground-station/mesh");
}

export function getMeshNeighbors(
  ctx: RequestContext,
): Promise<{ neighbors: MeshNeighbor[] }> {
  return gsRequest<{ neighbors: MeshNeighbor[] }>(
    ctx,
    "/api/v1/ground-station/mesh/neighbors",
  );
}

export function getMeshRoutes(ctx: RequestContext): Promise<{ routes: MeshRoute[] }> {
  return gsRequest<{ routes: MeshRoute[] }>(ctx, "/api/v1/ground-station/mesh/routes");
}

export function getMeshGateways(ctx: RequestContext): Promise<{
  gateways: MeshGateway[];
  selected: string | null;
}> {
  return gsRequest(ctx, "/api/v1/ground-station/mesh/gateways");
}

export function setMeshGatewayPreference(
  ctx: RequestContext,
  update: MeshGatewayPreferenceUpdate,
): Promise<{ mode: string; pinned_mac: string | null }> {
  return gsRequest(ctx, "/api/v1/ground-station/mesh/gateway_preference", {
    method: "PUT",
    body: JSON.stringify(update),
  });
}

export function getMeshConfig(ctx: RequestContext): Promise<MeshConfig> {
  return gsRequest<MeshConfig>(ctx, "/api/v1/ground-station/mesh/config");
}

export function setMeshConfig(
  ctx: RequestContext,
  update: MeshConfigUpdate,
): Promise<MeshConfig> {
  return gsRequest<MeshConfig>(ctx, "/api/v1/ground-station/mesh/config", {
    method: "PUT",
    body: JSON.stringify(update),
  });
}

// --- Receiver pairing window ---

/** Open the receiver Accept window. Idempotent during an open window. */
export function openPairingWindow(
  ctx: RequestContext,
  duration_s = 60,
): Promise<PairingWindow> {
  return gsRequest<PairingWindow>(ctx, "/api/v1/ground-station/pair/accept", {
    method: "POST",
    body: JSON.stringify({ duration_s }),
  });
}

/** Close the receiver Accept window early. Idempotent. */
export function closePairingWindow(ctx: RequestContext): Promise<{ closed: boolean }> {
  return gsRequest(ctx, "/api/v1/ground-station/pair/close", {
    method: "POST",
  });
}

/** Receiver-side pending join requests plus window state. */
export function getPairingPending(ctx: RequestContext): Promise<PairingSnapshot> {
  return gsRequest<PairingSnapshot>(ctx, "/api/v1/ground-station/pair/pending");
}

/** Approve a pending relay; receiver sends the encrypted invite back. */
export function approvePairing(
  ctx: RequestContext,
  device_id: string,
): Promise<PairingApproveResult> {
  return gsRequest<PairingApproveResult>(
    ctx,
    `/api/v1/ground-station/pair/approve/${encodeURIComponent(device_id)}`,
    { method: "POST" },
  );
}

/** Revoke a previously approved relay by device id. */
export function revokeRelay(
  ctx: RequestContext,
  device_id: string,
): Promise<PairingRevokeResult> {
  return gsRequest<PairingRevokeResult>(
    ctx,
    `/api/v1/ground-station/pair/revoke/${encodeURIComponent(device_id)}`,
    { method: "POST" },
  );
}

/**
 * Relay-side: send a join request to a receiver, with the join code the
 * receiver shows. Blocks until the invite is persisted.
 */
export function requestJoin(
  ctx: RequestContext,
  req: PairJoinRequest,
): Promise<PairJoinResult> {
  return gsRequest<PairJoinResult>(ctx, "/api/v1/ground-station/pair/join", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

// --- Mesh events ---

/**
 * Subscribe to mesh plus pairing events on the combined WebSocket.
 * Mirrors subscribeUplinkEvents: exponential-backoff reconnect, API key via
 * query param, close on unsubscribe.
 *
 * Optional `onState` callback fires on connection lifecycle transitions
 * (`connected`, `reconnecting`, `closed`). Consumers can use it to surface
 * a "connection lost" banner to the operator so silently missed events
 * do not look like a healthy mesh.
 */
export function subscribeMeshEvents(
  ctx: RequestContext,
  onEvent: (e: MeshEvent) => void,
  onState?: (state: "connected" | "reconnecting" | "closed") => void,
): () => void {
  return subscribeWebSocket<MeshEvent>({
    ctx,
    path: "/api/v1/ground-station/ws/mesh",
    scope: "gs.mesh_events",
    onEvent,
    onState,
  });
}
