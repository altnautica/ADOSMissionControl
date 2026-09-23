// index.ts — programmatic entry point for the MAVLink bridge tool
// SPDX-License-Identifier: GPL-3.0-only

export { UdpWsBridge } from './udp-ws.js';
export type { UdpMode, UdpWsBridgeConfig } from './udp-ws.js';
export { TcpWsBridge } from './tcp-ws.js';
export type { TcpWsBridgeConfig } from './tcp-ws.js';
export { UdpPeerTracker, isLocalEndpoint, isMavlinkFrame } from './udp-peer.js';
export type { UdpPeer, UdpVerdict } from './udp-peer.js';
export {
  DEFAULT_WS_HOST,
  bridgeUrl,
  checkWsClient,
  createBridgeToken,
  isLoopbackOrigin,
  wsVerifyClient,
} from './ws-guard.js';
export type { WsGuardOptions, WsRefusal } from './ws-guard.js';
export type {
  Bridge,
  BridgeEvents,
  LinkEvent,
  PeerEvent,
  WsClientEvent,
  DataEvent,
} from './types.js';
