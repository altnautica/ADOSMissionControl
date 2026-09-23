/**
 * @module api/ground-station/types/mesh
 * @description Distributed receive + mesh types: role enumeration, mesh
 * health snapshot, neighbor and route entries, gateway selection, mesh
 * config, WFB relay/receiver status, and the streamed mesh + pair event
 * envelope.
 *
 * @license GPL-3.0-only
 */

export type GroundStationRole = "direct" | "relay" | "receiver" | "unset";

export interface RoleInfo {
  /** Authoritative current role from the on-disk sentinel. */
  current: GroundStationRole;
  /** Pydantic-configured role; may differ from `current` during a transition. */
  configured: GroundStationRole;
  supported: GroundStationRole[];
  mesh_capable: boolean;
}

export interface MeshHealth {
  up: boolean;
  peer_count: number;
  selected_gateway: string | null;
  partition: boolean;
  mesh_id: string | null;
}

export interface MeshNeighbor {
  mac: string;
  iface: string;
  tq: number;
  last_seen_ms: number;
}

export interface MeshRoute {
  dest: string;
  via: string | null;
  metric: number | null;
}

export interface MeshGateway {
  mac: string;
  class_up_kbps: number;
  class_down_kbps: number;
  tq: number;
  selected: boolean;
}

export interface MeshGatewayPreferenceUpdate {
  mode: "auto" | "pinned" | "off";
  pinned_mac?: string | null;
}

export interface MeshConfig {
  mesh_id: string | null;
  carrier: "802.11s" | "ibss";
  channel: number;
  bat_iface: string;
  interface_override: string | null;
}

export interface MeshConfigUpdate {
  mesh_id?: string;
  carrier?: "802.11s" | "ibss";
  channel?: number;
}

/** `GET .../wfb/relay/status` (ados-control `gs_status.rs`
 * get_wfb_relay_status). With no current snapshot the agent nulls every key
 * under `stale: true`, so every reading is nullable. */
export interface WfbRelayStatus {
  role: "relay" | null;
  drone_iface: string | null;
  receiver_ip: string | null;
  receiver_port: number | null;
  receiver_last_seen_ms: number | null;
  fragments_seen: number | null;
  fragments_forwarded: number | null;
  up: boolean | null;
  mesh_iface: string | null;
  stale: boolean;
}

export interface WfbReceiverRelay {
  mac: string;
  last_seen_ms: number;
  fragments: number;
}

/** `GET .../wfb/receiver/relays`. `relays` is null (not the empty list) under
 * `stale: true`: the receive loop has no current snapshot, so "no relays" is
 * a reading this node cannot make. */
export interface WfbReceiverRelays {
  relays: WfbReceiverRelay[] | null;
  stale: boolean;
}

/** `GET .../wfb/receiver/combined`. Every counter is null under `stale: true`. */
export interface WfbReceiverCombined {
  fragments_after_dedup: number | null;
  fec_repaired: number | null;
  output_kbps: number | null;
  up: boolean | null;
  stale: boolean;
}

/** Event envelope from /api/v1/ground-station/ws/mesh. */
export type MeshEvent =
  | {
      bus: "mesh";
      kind:
        | "role_changed"
        | "neighbor_join"
        | "neighbor_leave"
        | "partition_detected"
        | "partition_healed"
        | "gateway_changed"
        | "relay_connected"
        | "relay_disconnected"
        | "receiver_unreachable";
      timestamp_ms: number;
      payload: Record<string, unknown>;
    }
  | {
      bus: "pair";
      kind:
        | "accept_window_opened"
        | "accept_window_closed"
        | "join_request_received"
        | "join_approved"
        | "join_rejected"
        | "join_completed"
        | "revoked"
        | "psk_mismatch"
        | "bundle_expired";
      timestamp_ms: number;
      payload: Record<string, unknown>;
    };
