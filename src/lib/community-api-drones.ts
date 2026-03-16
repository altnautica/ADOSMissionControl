/**
 * @module community-api-drones
 * @description Typed Convex function references for drone pairing and fleet management.
 * Uses typed imports from the local convex/_generated/api.
 * @license GPL-3.0-only
 */

import { api } from "../../convex/_generated/api";

export const cmdDronesApi = {
  listMyDrones: api.cmdDrones.listMyDrones,
  getDrone: api.cmdDrones.getDrone,
  renameDrone: api.cmdDrones.renameDrone,
  unpairDrone: api.cmdDrones.unpairDrone,
  updateHeartbeat: api.cmdDrones.updateHeartbeat,
};

export const cmdPairingApi = {
  claimPairingCode: api.cmdPairing.claimPairingCode,
  preGenerateCode: api.cmdPairing.preGenerateCode,
  getPairingStatus: api.cmdPairing.getPairingStatus,
  getMyPendingCodes: api.cmdPairing.getMyPendingCodes,
};
