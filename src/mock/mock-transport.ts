/**
 * Minimal Transport stub for demo mode.
 *
 * Always reports connected, all I/O methods are no-ops.
 * on()/off() are no-ops so DroneManager's close handler never fires.
 *
 * @license GPL-3.0-only
 */

import type { Transport } from "@/lib/protocol/types";

export class MockTransport implements Transport {
  readonly type = "websocket" as const;
  /**
   * A direct link: bytes written here go to the flight controller over this
   * connection, so a command that leaves is a command that arrives.
   */
  readonly canCommand = true;

  get isConnected(): boolean {
    return true;
  }

  async connect(): Promise<void> {
    // no-op
  }

  async disconnect(): Promise<void> {
    // no-op
  }

  send(): void {
    // no-op
  }

  on(): void {
    // no-op — prevents DroneManager close handler from registering
  }

  off(): void {
    // no-op
  }
}
