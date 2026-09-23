/**
 * @module api/ground-station/types/pic
 * @description Pilot-in-Command arbiter types: state snapshot, claim /
 * release / confirm-token responses, and the streamed event envelope.
 *
 * @license GPL-3.0-only
 */

export interface PicState {
  state: string;
  claimed_by: string | null;
  claim_counter: number;
  primary_gamepad_id: string | null;
}

export interface PicClaimResult {
  claimed: boolean;
  claimed_by: string | null;
  claim_counter: number;
  requires_confirm_token?: boolean;
}

export interface PicReleaseResult {
  released: boolean;
  claimed_by: string | null;
}

export interface PicConfirmTokenResult {
  confirm_token: string;
  expires_in_s: number;
}

/** One frame of `/ws/pic`. The agent relays the PIC arbiter's transition
 * lines verbatim (ados-hid `pic_ipc.rs` subscribe: `client_id` is the new
 * holder on `claimed`, the previous holder on `released`/`disconnected`), and
 * sends an `error` frame when the arbiter's socket is unreachable
 * (ados-control `gs_ws.rs` pic_loop). */
export type PicEvent =
  | {
      event: "claimed" | "released" | "disconnected";
      client_id: string | null;
      claim_counter: number;
      timestamp_ms: number;
    }
  | { event: "error"; code: string; message: string };
