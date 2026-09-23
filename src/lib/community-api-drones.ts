/**
 * @module community-api-drones
 * @description Typed Convex API references for drone pairing and fleet management.
 * Uses typed imports from convex/_generated/api for full type safety.
 * @license GPL-3.0-only
 */

import { api } from "../../convex/_generated/api";

export const cmdDronesApi = {
  listMyDrones: api.cmdDrones.listMyDrones,
  getDrone: api.cmdDrones.getDrone,
  getAgentKey: api.cmdDrones.getAgentKey,
  renameDrone: api.cmdDrones.renameDrone,
  unpairDrone: api.cmdDrones.unpairDrone,
  // `updateHeartbeat` is deliberately absent: it is an internal mutation
  // reached only through the `/heartbeat` HTTP route, which authenticates the
  // agent. Exposing it to the browser gave any caller a directly-invokable
  // write path that bypassed that route's checks.
  //
  // `listMyDrones` and `getDrone` return an explicit owner projection, so a
  // credential-shaped column added to `cmd_drones` later is omitted unless it
  // is named there deliberately. The device `apiKey` is named, because a
  // cloud-paired node has no local pairing record and the row is the only
  // place the browser can obtain its key. `getAgentKey` is the scoped
  // single-device read new code should use instead of taking the key off the
  // fleet-wide list.
};

export const cmdPairingApi = {
  claimPairingCode: api.cmdPairing.claimPairingCode,
  claimPairingCodeAnon: api.cmdPairing.claimPairingCodeAnon,
  issueBrowserSession: api.cmdPairing.issueBrowserSession,
  preGenerateCode: api.cmdPairing.preGenerateCode,
  getMyPendingCodes: api.cmdPairing.getMyPendingCodes,
  wipePairStateForOwnedDevice: api.cmdPairing.wipePairStateForOwnedDevice,
  // `getPairingStatus` and `registerAgent` are deliberately absent: both are
  // internal, reached only through their HTTP routes, which supply the device's
  // own API key and the source-address rate-limit bucket respectively. As
  // public functions the first was a claim oracle for any guessed deviceId and
  // the second let any browser write an attacker-chosen apiKey keyed by any
  // deviceId. Nothing in the GCS ever called either one.
};

export const cmdDroneStatusApi = {
  getCloudStatus: api.cmdDroneStatus.getCloudStatus,
  listMyCloudStatuses: api.cmdDroneStatus.listMyCloudStatuses,
};

export const cmdAtlasJobsApi = {
  listForDevice: api.cmdAtlasJobs.listForDevice,
  listByComputeNode: api.cmdAtlasJobs.listByComputeNode,
  get: api.cmdAtlasJobs.get,
};

export const cmdDroneCommandsApi = {
  enqueueCommand: api.cmdDroneCommands.enqueueCommand,
  getCommandStatus: api.cmdDroneCommands.getCommandStatus,
  listRecentCommands: api.cmdDroneCommands.listRecentCommands,
};

export const cmdMqttControlGrantsApi = {
  mint: api.cmdMqttControlGrants.mint,
  myCurrent: api.cmdMqttControlGrants.myCurrent,
  revoke: api.cmdMqttControlGrants.revoke,
  confirmWrite: api.cmdMqttControlGrants.confirmWrite,
  // `ownedDeviceIds` and `insert` are deliberately absent: both are internal,
  // reached only from inside `mint`, which derives the grant's scope rather than
  // accepting it from the caller.
};

export const cmdVideoRelayTokensApi = {
  // Owner-gated, five-minute viewer token for the cloud video relay.
  mint: api.cmdVideoRelayTokens.mint,
};

export const cmdRadioPairingApi = {
  enqueueWfbPairInit: api.cmdRadioPairing.enqueueWfbPairInit,
  enqueueWfbPairApply: api.cmdRadioPairing.enqueueWfbPairApply,
  enqueueWfbPairUnpair: api.cmdRadioPairing.enqueueWfbPairUnpair,
  getCommandWithData: api.cmdRadioPairing.getCommandWithData,
  finalizePairing: api.cmdRadioPairing.finalizePairing,
  cancelCommand: api.cmdRadioPairing.cancelCommand,
};

export const cmdSigningKeysApi = {
  listMine: api.cmdSigningKeys.listMine,
  getForDrone: api.cmdSigningKeys.getForDrone,
  store: api.cmdSigningKeys.store,
  removeKey: api.cmdSigningKeys.removeKey,
  allocateLinkId: api.cmdSigningKeys.allocateLinkId,
  releaseLinkId: api.cmdSigningKeys.releaseLinkId,
  // `listMine` and `getForDrone` return metadata only. `exportKey` is the one
  // path that returns `keyHex`, and it writes an `export` audit event in the
  // same transaction.
  exportKey: api.cmdSigningKeys.exportKey,
};

export const cmdSigningEventsApi = {
  listForDrone: api.cmdSigningEvents.listForDrone,
  listMine: api.cmdSigningEvents.listMine,
  append: api.cmdSigningEvents.append,
};
