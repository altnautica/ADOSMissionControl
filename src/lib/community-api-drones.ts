/**
 * @module community-api-drones
 * @description Typed Convex function references for drone pairing and fleet management.
 * Uses makeFunctionReference to reference functions in convex/ without requiring
 * codegen (_generated/) to exist at build time.
 * @license GPL-3.0-only
 */

import { makeFunctionReference } from "convex/server";

export const cmdDronesApi = {
  listMyDrones: makeFunctionReference<"query">("cmdDrones:listMyDrones"),
  getDrone: makeFunctionReference<"query">("cmdDrones:getDrone"),
  renameDrone: makeFunctionReference<"mutation">("cmdDrones:renameDrone"),
  unpairDrone: makeFunctionReference<"mutation">("cmdDrones:unpairDrone"),
  updateHeartbeat: makeFunctionReference<"mutation">("cmdDrones:updateHeartbeat"),
};

export const cmdPairingApi = {
  claimPairingCode: makeFunctionReference<"mutation">("cmdPairing:claimPairingCode"),
  preGenerateCode: makeFunctionReference<"mutation">("cmdPairing:preGenerateCode"),
  getPairingStatus: makeFunctionReference<"query">("cmdPairing:getPairingStatus"),
  getMyPendingCodes: makeFunctionReference<"query">("cmdPairing:getMyPendingCodes"),
};
