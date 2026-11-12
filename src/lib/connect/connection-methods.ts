/**
 * @module connection-methods
 * @description Single source of truth for the Direct-to-FC connection methods
 * shown in the connect dialog and their per-surface availability. The same
 * descriptor drives the method card, its availability chip, and the selected
 * method's banner so the copy never drifts. Availability is computed at call
 * time from the running surface (desktop vs browser, Chromium vs not), reusing
 * the existing capability probes. Call client-side only (it reads window/navigator).
 * @license GPL-3.0-only
 */

import { isElectron } from "@/lib/utils";
import { WebSerialTransport } from "@/lib/protocol/transport/webserial";
import { BluetoothTransport } from "@/lib/protocol/transport/ble";

export type DirectMethodId = "serial" | "websocket" | "udp" | "tcp" | "bluetooth";

export type MethodAvailability =
  /** Works on this surface right now. */
  | "available"
  /** Needs a Chromium browser (Chrome/Edge) in a secure context. */
  | "chromium-only"
  /** Native in the desktop app; in the browser needs the local bridge. */
  | "desktop-or-bridge"
  /** The desktop app cannot offer it on this OS (Web Bluetooth on Linux). */
  | "desktop-unsupported";

export interface ConnectionMethod {
  id: DirectMethodId;
  /** i18n key under the `connect` namespace for the method name. */
  labelKey: string;
  /** i18n key under the `connect` namespace for the one-line purpose. */
  blurbKey: string;
  availability: MethodAvailability;
}

/**
 * Resolve the Direct-to-FC methods with availability for the CURRENT surface.
 * Returns every method (nothing is hidden) so the operator always sees the full
 * set and where each one works.
 */
export function getDirectConnectionMethods(): ConnectionMethod[] {
  const electron = isElectron();
  const serialOk = WebSerialTransport.isSupported();
  const bleOk = BluetoothTransport.isSupported();

  return [
    {
      id: "serial",
      labelKey: "method.serial.label",
      blurbKey: "method.serial.blurb",
      availability: serialOk ? "available" : "chromium-only",
    },
    {
      id: "websocket",
      labelKey: "method.websocket.label",
      blurbKey: "method.websocket.blurb",
      availability: "available",
    },
    {
      id: "udp",
      labelKey: "method.udp.label",
      blurbKey: "method.udp.blurb",
      availability: electron ? "available" : "desktop-or-bridge",
    },
    {
      id: "tcp",
      labelKey: "method.tcp.label",
      blurbKey: "method.tcp.blurb",
      availability: electron ? "available" : "desktop-or-bridge",
    },
    {
      id: "bluetooth",
      labelKey: "method.bluetooth.label",
      blurbKey: "method.bluetooth.blurb",
      // The desktop runtime ships no Web Bluetooth on Linux; telling the
      // operator to switch to Chrome or Edge from inside the app is wrong.
      availability: bleOk ? "available" : electron ? "desktop-unsupported" : "chromium-only",
    },
  ];
}
