/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as changelogSync from "../changelogSync.js";
import type * as changelogSyncMutations from "../changelogSyncMutations.js";
import type * as clientConfig from "../clientConfig.js";
import type * as cmdAdsbCache from "../cmdAdsbCache.js";
import type * as cmdAdsbCacheMutations from "../cmdAdsbCacheMutations.js";
import type * as cmdAiUsage from "../cmdAiUsage.js";
import type * as cmdDroneCommands from "../cmdDroneCommands.js";
import type * as cmdDroneStatus from "../cmdDroneStatus.js";
import type * as cmdDrones from "../cmdDrones.js";
import type * as cmdMissions from "../cmdMissions.js";
import type * as cmdPairing from "../cmdPairing.js";
import type * as cmdPreferences from "../cmdPreferences.js";
import type * as comments from "../comments.js";
import type * as communityChangelog from "../communityChangelog.js";
import type * as communityItems from "../communityItems.js";
import type * as contactSubmissions from "../contactSubmissions.js";
import type * as crons from "../crons.js";
import type * as http from "../http.js";
import type * as profiles from "../profiles.js";
import type * as storage from "../storage.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  changelogSync: typeof changelogSync;
  changelogSyncMutations: typeof changelogSyncMutations;
  clientConfig: typeof clientConfig;
  cmdAdsbCache: typeof cmdAdsbCache;
  cmdAdsbCacheMutations: typeof cmdAdsbCacheMutations;
  cmdAiUsage: typeof cmdAiUsage;
  cmdDroneCommands: typeof cmdDroneCommands;
  cmdDroneStatus: typeof cmdDroneStatus;
  cmdDrones: typeof cmdDrones;
  cmdMissions: typeof cmdMissions;
  cmdPairing: typeof cmdPairing;
  cmdPreferences: typeof cmdPreferences;
  comments: typeof comments;
  communityChangelog: typeof communityChangelog;
  communityItems: typeof communityItems;
  contactSubmissions: typeof contactSubmissions;
  crons: typeof crons;
  http: typeof http;
  profiles: typeof profiles;
  storage: typeof storage;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
