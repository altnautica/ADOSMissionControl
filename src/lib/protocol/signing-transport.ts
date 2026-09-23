/**
 * Outbound view of a transport that signs every MAVLink v2 frame.
 *
 * Every send path in the MAVLink adapter (commands, params, missions, FTP,
 * logs, heartbeat) writes through the adapter's command transport, so
 * wrapping that one object is what makes "signing enabled" true for every
 * frame the GCS emits rather than for whichever caller remembered to sign.
 *
 * @module protocol/signing-transport
 * @license GPL-3.0-only
 */

import type { Transport, TransportEventMap } from "./types";
import type { MavlinkSigner } from "./mavlink-signer";

export class SigningTransport implements Transport {
  constructor(
    readonly inner: Transport,
    private readonly currentSigner: () => MavlinkSigner | null,
  ) {}

  get type(): Transport["type"] {
    return this.inner.type;
  }

  get isConnected(): boolean {
    return this.inner.isConnected;
  }

  get canCommand(): boolean {
    return this.inner.canCommand;
  }

  connect(...args: unknown[]): Promise<void> {
    return this.inner.connect(...args);
  }

  disconnect(): Promise<void> {
    return this.inner.disconnect();
  }

  send(data: Uint8Array): void {
    const signer = this.currentSigner();
    this.inner.send(signer ? signer.signFrame(data) : data);
  }

  on<K extends keyof TransportEventMap>(event: K, handler: (data: TransportEventMap[K]) => void): void {
    this.inner.on(event, handler);
  }

  off<K extends keyof TransportEventMap>(event: K, handler: (data: TransportEventMap[K]) => void): void {
    this.inner.off(event, handler);
  }
}
