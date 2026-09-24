/**
 * MAVLink CAN_FORWARD transport.
 *
 * Wraps an existing `DroneProtocol` and exposes the unified `CanTransport`
 * surface so a `DroneCanClient` can run end-to-end without claiming the
 * USB port for SLCAN ASCII. CAN frames are tunneled through the FC's
 * MAVLink CAN passthrough using msg 386 (CAN_FRAME) / msg 387 (CANFD_FRAME)
 * and gated by `MAV_CMD_CAN_FORWARD`. Throughput is link-limited; SLCAN
 * remains the high-bandwidth fallback when raw bus access is needed.
 *
 * @module protocol/transport/mavlink-can-forward-transport
 * @license GPL-3.0-only
 */

import type { DroneProtocol } from "../types/protocol";
import type {
  CanFrame,
  CanTransport,
  CanTransportState,
  CanTransportStats,
} from "./can-transport";

export interface MavlinkCanForwardOptions {
  /** CAN bus index to forward (1 or 2). Defaults to 1. */
  bus?: number;
}

/**
 * How often CAN_FORWARD is re-sent while open. ArduPilot drops the forwarding
 * callback once 5 s pass without a MAV_CMD_CAN_FORWARD from the client
 * (AP_MAVLinkCAN::can_frame_callback), so a single request goes quiet.
 */
const CAN_FORWARD_REFRESH_MS = 2000;

/**
 * CAN-over-MAVLink transport backed by a connected `DroneProtocol`.
 */
export class MavlinkCanForwardTransport implements CanTransport {
  private readonly protocol: DroneProtocol;
  private readonly bus: number;
  private state: CanTransportState = "closed";
  private readonly frameSubs = new Set<(f: CanFrame) => void>();
  private readonly stateSubs = new Set<(s: CanTransportState) => void>();
  private readonly stats: CanTransportStats = {
    txCount: 0,
    rxCount: 0,
    txErrors: 0,
    rxErrors: 0,
  };
  private unsubFrame: (() => void) | null = null;
  private unsubFdFrame: (() => void) | null = null;
  private refresh: ReturnType<typeof setInterval> | null = null;

  constructor(protocol: DroneProtocol, opts: MavlinkCanForwardOptions = {}) {
    this.protocol = protocol;
    this.bus = opts.bus ?? 1;
  }

  /**
   * Open the passthrough channel.
   *
   * Sends `MAV_CMD_CAN_FORWARD(bus)` and waits for the FC to ACK before
   * flipping state to "open". Bitrate is ignored because the FC already
   * owns the bus configuration via its CAN_* parameters.
   */
  async open(_opts: { bitrate: number }): Promise<void> {
    if (this.state === "open" || this.state === "opening") return;
    this.transition("opening");
    if (!this.protocol.enableCanForward) {
      this.transition("error");
      throw new Error(
        "Active protocol does not support MAVLink CAN_FORWARD",
      );
    }
    try {
      const result = await this.protocol.enableCanForward(this.bus);
      if (!result.success) {
        this.transition("error");
        throw new Error(
          `CAN_FORWARD rejected by FC: ${result.message ?? "no detail"}`,
        );
      }
    } catch (err) {
      this.transition("error");
      throw err;
    }

    // Subscribe to inbound CAN traffic. We accept both classic CAN and
    // CAN FD; the consumer treats them uniformly because both decode to
    // the same `CanFrame` shape (with up to 8 vs up to 64 data bytes).
    if (this.protocol.onCanFrame) {
      this.unsubFrame = this.protocol.onCanFrame((evt) => {
        if (evt.bus !== this.bus) return;
        this.dispatchInbound(evt.id, evt.len, evt.data);
      });
    }
    if (this.protocol.onCanFdFrame) {
      this.unsubFdFrame = this.protocol.onCanFdFrame((evt) => {
        if (evt.bus !== this.bus) return;
        this.dispatchInbound(evt.id, evt.len, evt.data);
      });
    }

    const enable = this.protocol.enableCanForward.bind(this.protocol);
    this.refresh = setInterval(() => {
      void enable(this.bus).catch(() => {});
    }, CAN_FORWARD_REFRESH_MS);
    this.transition("open");
  }

  /**
   * Close the transport.
   *
   * Best-effort disables forwarding on the FC by sending CAN_FORWARD(0),
   * then drops all subscriptions. Idempotent: a second close() resolves
   * without throwing.
   */
  async close(): Promise<void> {
    if (this.state === "closed") return;
    this.unsubFrame?.();
    clearInterval(this.refresh ?? undefined);
    this.refresh = null;
    this.unsubFrame = null;
    this.unsubFdFrame?.();
    this.unsubFdFrame = null;
    if (this.protocol.enableCanForward) {
      try {
        await this.protocol.enableCanForward(0);
      } catch {
        // Suppressed — close path must remain forgiving even when the
        // link is already down.
      }
    }
    this.transition("closed");
  }

  /**
   * Enqueue a frame for transmission.
   *
   * Classic CAN (len <= 8) goes through CAN_FRAME; anything larger goes
   * through CANFD_FRAME. Failures bump `txErrors` rather than throwing
   * so the caller can keep the OTA loop alive on a soft hiccup.
   */
  async send(frame: CanFrame): Promise<void> {
    if (this.state !== "open") {
      this.stats.txErrors += 1;
      throw new Error("MavlinkCanForwardTransport not open");
    }
    try {
      if (frame.data.length > 8 || frame.dlc > 8) {
        if (!this.protocol.sendCanFdFrame) {
          this.stats.txErrors += 1;
          throw new Error("Protocol does not implement sendCanFdFrame");
        }
        this.protocol.sendCanFdFrame(this.bus, frame.id, frame.data);
      } else {
        if (!this.protocol.sendCanFrame) {
          this.stats.txErrors += 1;
          throw new Error("Protocol does not implement sendCanFrame");
        }
        this.protocol.sendCanFrame(this.bus, frame.id, frame.data);
      }
      this.stats.txCount += 1;
    } catch (err) {
      this.stats.txErrors += 1;
      throw err;
    }
  }

  onFrame(cb: (frame: CanFrame) => void): () => void {
    this.frameSubs.add(cb);
    return () => {
      this.frameSubs.delete(cb);
    };
  }

  onState(cb: (s: CanTransportState) => void): () => void {
    this.stateSubs.add(cb);
    return () => {
      this.stateSubs.delete(cb);
    };
  }

  getState(): CanTransportState {
    return this.state;
  }

  getStats(): CanTransportStats {
    return { ...this.stats };
  }

  /** Dispatch a decoded inbound frame to subscribers. */
  private dispatchInbound(id: number, len: number, data: Uint8Array): void {
    const safeLen = Math.min(Math.max(len, 0), data.length);
    const trimmed = safeLen === data.length ? data : data.slice(0, safeLen);
    const frame: CanFrame = {
      id,
      extended: (id & 0x80000000) !== 0,
      dlc: safeLen,
      data: trimmed,
      timestamp: Date.now(),
    };
    this.stats.rxCount += 1;
    for (const sub of this.frameSubs) {
      try {
        sub(frame);
      } catch {
        this.stats.rxErrors += 1;
      }
    }
  }

  /** Move into the requested lifecycle state and notify subscribers. */
  private transition(next: CanTransportState): void {
    if (this.state === next) return;
    this.state = next;
    for (const cb of this.stateSubs) {
      try {
        cb(next);
      } catch {
        // Subscriber errors must not break the transport.
      }
    }
  }
}
