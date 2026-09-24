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
  getPreGeneratedClaim: api.cmdPairing.getPreGeneratedClaim,
  wipePairStateForOwnedDevice: api.cmdPairing.wipePairStateForOwnedDevice,
  // `registerAgent` is deliberately absent: it is internal, reached only
  // through its HTTP route, which supplies the source-address rate-limit
  // bucket. As a public function it let any browser write an attacker-chosen
  // apiKey keyed by any deviceId.
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

export const cmdSigningKeysApi = {
  // Metadata only: no key material leaves the backend through this surface.
  getForDrone: api.cmdSigningKeys.getForDrone,
  removeKey: api.cmdSigningKeys.removeKey,
};

export const cmdSigningEventsApi = {
  listForDrone: api.cmdSigningEvents.listForDrone,
  listMine: api.cmdSigningEvents.listMine,
  append: api.cmdSigningEvents.append,
};
