/** A raw UDP/TCP MAVLink endpoint the desktop app opens natively (browsers cannot). */
interface ElectronNetOpenSpec {
  proto: "udp" | "tcp";
  host: string;
  port: number;
  /** UDP only. "listen" binds host:port and learns the peer from the first
   *  datagram (the common autopilot case); "target" sends to a fixed host:port.
   *  Ignored for TCP (always a client connect). */
  mode?: "listen" | "target";
}
interface ElectronNetDataMessage {
  id: string;
  data: Uint8Array;
}
interface ElectronNetCloseMessage {
  id: string;
  reason?: string;
}
/** Native UDP/TCP socket bridge owned by the Electron main process. The renderer
 *  only ever holds an opaque socket id; the real socket never leaves main. */
interface ElectronNetAPI {
  open: (spec: ElectronNetOpenSpec) => Promise<{ id: string }>;
  send: (id: string, data: Uint8Array) => Promise<void>;
  close: (id: string) => Promise<void>;
  /** Subscribe to inbound bytes for any open socket. Returns an unsubscribe. */
  onData: (cb: (msg: ElectronNetDataMessage) => void) => () => void;
  /** Subscribe to socket close/error events. Returns an unsubscribe. */
  onClose: (cb: (msg: ElectronNetCloseMessage) => void) => () => void;
}

/** Update status the main process pushes; mirrors `UpdateStatus` in electron/updater.ts. */
export type ElectronUpdateStatus =
  | { state: "idle" }
  /** `installable` is false where only a manual download from `releasesUrl` works. */
  | { state: "available"; version: string; installable: boolean; releasesUrl: string }
  | { state: "downloading"; version: string }
  | { state: "downloaded"; version: string }
  | { state: "error"; message: string };

interface ElectronUpdatesAPI {
  /** The latest status, including a result that arrived before this page mounted. */
  status: () => Promise<ElectronUpdateStatus>;
  /** Subscribe to status changes. Returns an unsubscribe. */
  onStatus: (cb: (status: ElectronUpdateStatus) => void) => () => void;
  /** Download the available version. Rejects where this build cannot install. */
  download: () => Promise<void>;
  /** Quit and install the downloaded version. */
  install: () => Promise<void>;
}

interface ElectronAPI {
  isElectron: true;
  platform: "darwin" | "win32" | "linux";
  getVersion: () => Promise<string>;
  minimize: () => Promise<void>;
  maximize: () => Promise<void>;
  close: () => Promise<void>;
  updates: ElectronUpdatesAPI;
  /** Native UDP/TCP MAVLink sockets — desktop builds only (absent in browsers). */
  net?: ElectronNetAPI;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
