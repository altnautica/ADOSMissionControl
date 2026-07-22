// Network surface: AP, ethernet, WiFi client, modem, uplink priority, share-uplink, and the uplink event stream.

import type {
  ApStatus,
  ApUpdate,
  EthernetConfig,
  EthernetConfigUpdate,
  ModemDetailStatus,
  ModemStatus,
  ModemUpdate,
  NetworkStatus,
  ShareUplinkResult,
  UplinkEvent,
  UplinkPriorityConfig,
  WifiJoinResult,
  WifiLeaveResult,
  WifiScanResponse,
} from "./types";
import { gsRequest, type RequestContext } from "./request";
import { subscribeWebSocket } from "./ws";

export function getNetwork(ctx: RequestContext): Promise<NetworkStatus> {
  return gsRequest<NetworkStatus>(ctx, "/api/v1/ground-station/network");
}

export function setAp(ctx: RequestContext, update: ApUpdate): Promise<ApStatus> {
  return gsRequest<ApStatus>(ctx, "/api/v1/ground-station/network/ap", {
    method: "PUT",
    body: JSON.stringify(update),
  });
}

/**
 * Get Ethernet config. Returns 404 GroundStationApiError until the
 * agent endpoint ships.
 */
export function getEthernetConfig(ctx: RequestContext): Promise<EthernetConfig> {
  return gsRequest<EthernetConfig>(ctx, "/api/v1/ground-station/network/ethernet");
}

/**
 * Set Ethernet config. Returns 404 GroundStationApiError until the
 * agent endpoint ships.
 */
export function setEthernetConfig(
  ctx: RequestContext,
  update: EthernetConfigUpdate,
): Promise<EthernetConfig> {
  return gsRequest<EthernetConfig>(ctx, "/api/v1/ground-station/network/ethernet", {
    method: "PUT",
    body: JSON.stringify(update),
  });
}

export function scanWifiClient(ctx: RequestContext, timeoutS = 10): Promise<WifiScanResponse> {
  const q = encodeURIComponent(String(timeoutS));
  return gsRequest<WifiScanResponse>(
    ctx,
    `/api/v1/ground-station/network/client/scan?timeout_s=${q}`,
  );
}

export function joinWifiClient(
  ctx: RequestContext,
  ssid: string,
  passphrase?: string,
  force?: boolean,
): Promise<WifiJoinResult> {
  const body: Record<string, unknown> = { ssid };
  if (passphrase !== undefined) body.passphrase = passphrase;
  if (force) body.force = true;
  return gsRequest<WifiJoinResult>(ctx, "/api/v1/ground-station/network/client/join", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export function leaveWifiClient(ctx: RequestContext): Promise<WifiLeaveResult> {
  return gsRequest<WifiLeaveResult>(ctx, "/api/v1/ground-station/network/client", {
    method: "DELETE",
  });
}

export function getModem(ctx: RequestContext): Promise<ModemStatus> {
  return gsRequest<ModemStatus>(ctx, "/api/v1/ground-station/network/modem");
}

export function setModem(ctx: RequestContext, update: ModemUpdate): Promise<ModemStatus> {
  return gsRequest<ModemStatus>(ctx, "/api/v1/ground-station/network/modem", {
    method: "PUT",
    body: JSON.stringify(update),
  });
}

/** The cellular detail snapshot: modem presence + the agent's reason when
 * none is present. */
export function getModemDetail(ctx: RequestContext): Promise<ModemDetailStatus> {
  return gsRequest<ModemDetailStatus>(ctx, "/api/v1/ground-station/modem-status");
}

export function getPriority(ctx: RequestContext): Promise<UplinkPriorityConfig> {
  return gsRequest<UplinkPriorityConfig>(ctx, "/api/v1/ground-station/network/priority");
}

export function setPriority(
  ctx: RequestContext,
  priority: string[],
): Promise<UplinkPriorityConfig> {
  return gsRequest<UplinkPriorityConfig>(ctx, "/api/v1/ground-station/network/priority", {
    method: "PUT",
    body: JSON.stringify({ priority }),
  });
}

export function setShareUplink(ctx: RequestContext, enabled: boolean): Promise<ShareUplinkResult> {
  return gsRequest<ShareUplinkResult>(ctx, "/api/v1/ground-station/network/share_uplink", {
    method: "PUT",
    body: JSON.stringify({ enabled }),
  });
}

/**
 * Subscribe to uplink events via WebSocket.
 * Exponential-backoff reconnect; pairing key is exchanged for a
 * one-shot ticket and presented through the WebSocket subprotocol.
 */
export function subscribeUplinkEvents(
  ctx: RequestContext,
  onEvent: (e: UplinkEvent) => void,
): () => void {
  return subscribeWebSocket<UplinkEvent>({
    ctx,
    path: "/api/v1/ground-station/ws/uplink",
    scope: "gs.uplink_events",
    onEvent,
  });
}
