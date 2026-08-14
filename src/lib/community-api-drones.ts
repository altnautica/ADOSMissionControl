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
  renameDrone: api.cmdDrones.renameDrone,
  unpairDrone: api.cmdDrones.unpairDrone,
  // `updateHeartbeat` is deliberately absent: it is an internal mutation
  // reached only through the `/heartbeat` HTTP route, which authenticates the
  // agent. Exposing it to the browser gave any caller a directly-invokable
  // write path that bypassed that route's checks.
};

export const cmdPairingApi = {
  claimPairingCode: api.cmdPairing.claimPairingCode,
  claimPairingCodeAnon: api.cmdPairing.claimPairingCodeAnon,
  preGenerateCode: api.cmdPairing.preGenerateCode,
  getPairingStatus: api.cmdPairing.getPairingStatus,
  getMyPendingCodes: api.cmdPairing.getMyPendingCodes,
  wipePairStateForOwnedDevice: api.cmdPairing.wipePairStateForOwnedDevice,
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
};

export const cmdSigningEventsApi = {
  listForDrone: api.cmdSigningEvents.listForDrone,
  listMine: api.cmdSigningEvents.listMine,
  append: api.cmdSigningEvents.append,
};
