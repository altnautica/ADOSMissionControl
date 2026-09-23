/**
 * @module api/ground-station/types/pairing
 * @description Pairing-related types: legacy pair/unpair results, the v0.16
 * local-bind protocol session machine, the cloud-relay path responses, and
 * the mesh pairing window + approve/revoke + join shapes.
 *
 * @license GPL-3.0-only
 */

// Legacy pair surface
export interface PairResult {
  paired_drone_id: string;
  paired_at: string;
  key_fingerprint: string;
}

export interface UnpairResult {
  unpaired: boolean;
  previous_drone_id: string | null;
}

// New shapes for the v0.16 pairing surface (local-radio bind protocol
// + cloud-relay path). These match the agent's REST responses verbatim
// (snake_case where the agent emits snake_case).

export type LocalBindState =
  | "idle"
  | "opening_tunnel"
  | "waiting_peer"
  | "transferring_keys"
  | "applying_keys"
  | "restarting_services"
  | "paired"
  | "failed"
  | "aborted";

export interface LocalBindSession {
  session_id: string;
  role: "drone" | "gs";
  state: LocalBindState;
  started_at: string;
  finished_at: string | null;
  error: string | null;
  fingerprint: string | null;
  peer_device_id: string | null;
  source: "operator" | "auto";
  // Optional bind-phase observability fields (agent v0.x+). `phase`
  // mirrors `state` (the agent's `phase` property aliases `state.value`);
  // it is included separately so the GCS can render an elapsed-time chip
  // without having to also track when the state last changed locally.
  phase?: LocalBindState | null;
  phase_entered_at?: number | null;
  phase_age_s?: number | null;
  // Peer-presence diagnostics surfaced during the WAITING_PEER window
  // (agent v0.34.1+). Sourced from the kernel rx_packets counter on
  // the bind TUN device — an increment means the peer transmitted a
  // packet that wfb_rx successfully decoded. `last_frame_at_s` is a
  // monotonic timestamp; `last_frame_age_s` is the derived age in
  // seconds. Both stay null until the first peer frame is heard so
  // the GCS can distinguish "still listening" from "heard something
  // N seconds ago". `last_rssi_dbm` reserved for a future agent
  // release that wires the structured RX_ANT parser to the bind
  // window; null on agents that don't surface RSSI yet.
  last_frame_at_s?: number | null;
  last_frame_age_s?: number | null;
  last_rssi_dbm?: number | null;
  // Injection-iface monitor-mode prep result, stamped once the bind prep runs
  // (null until then; older agents omit these). `bind_precheck_ok === false`
  // means the injection adapter did not reach verified monitor mode, so the
  // bind will time out radiating nothing — surfaced so the operator sees the
  // real cause instead of a bare 90s timeout. `injection_mode` is the iface's
  // readback mode ("monitor" | "managed" | "unknown"); `bind_precheck_reason`
  // is a bland code ("iface_not_found" | "monitor_unverified"); `nm_enumerable`
  // is whether NetworkManager lists the injection iface.
  bind_precheck_ok?: boolean | null;
  bind_precheck_reason?: string | null;
  injection_mode?: string | null;
  nm_enumerable?: boolean | null;
}

export interface PairStatusResponse {
  paired: boolean;
  paired_with_device_id: string | null;
  paired_at: string | null;
  fingerprint: string | null;
  auto_pair_enabled: boolean;
  role: "drone" | "gs";
}

export interface AutoPairToggleResponse {
  paired: boolean;
  paired_with_device_id: string | null;
  paired_at: string | null;
  fingerprint: string | null;
  auto_pair_enabled: boolean;
  role: "drone" | "gs";
  /** A re-arm on a paired rig without `force`: nothing was persisted. */
  rearm_blocked?: boolean;
  /** Whether the change will actually take effect on the rig. */
  applied: boolean;
  /** Arming an unpaired rig queued a local-bind retry for the supervisor. */
  retry_requested?: boolean;
  /** A forced re-arm on a paired rig was granted. */
  forced?: boolean;
}

// Mesh pairing window + approve/revoke + join shapes

export interface PairingWindow {
  opened_at_ms: number;
  closes_at_ms: number;
  duration_s: number;
}

export interface PairingPendingRequest {
  device_id: string;
  received_at_ms: number;
  remote_ip: string;
}

export interface PairingSnapshot {
  open: boolean;
  opened_at_ms?: number;
  closes_at_ms?: number;
  pending?: PairingPendingRequest[];
  approvals?: Record<string, number>;
}

export interface PairingApproveResult {
  device_id: string;
  invite_blob_hex: string;
  issued_at_ms: number;
  expires_at_ms: number;
}

export interface PairingRevokeResult {
  device_id: string;
  revoked: boolean;
}

export interface PairJoinRequest {
  receiver_host?: string | null;
  receiver_port?: number | null;
}

export interface PairJoinResult {
  mesh_id: string | null;
  receiver_host: string | null;
  ok: boolean;
}
