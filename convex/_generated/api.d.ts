/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as airportData from "../airportData.js";
import type * as auth from "../auth.js";
import type * as changelogSync from "../changelogSync.js";
import type * as changelogSyncMutations from "../changelogSyncMutations.js";
import type * as clientConfig from "../clientConfig.js";
import type * as cmdAiUsage from "../cmdAiUsage.js";
import type * as cmdAtlasJobs from "../cmdAtlasJobs.js";
import type * as cmdDroneAccess from "../cmdDroneAccess.js";
import type * as cmdDroneCommands from "../cmdDroneCommands.js";
import type * as cmdDroneStatus from "../cmdDroneStatus.js";
import type * as cmdDrones from "../cmdDrones.js";
import type * as cmdFlightLogs from "../cmdFlightLogs.js";
import type * as cmdLogdWindows from "../cmdLogdWindows.js";
import type * as cmdMcpReach from "../cmdMcpReach.js";
import type * as cmdMcpReachDb from "../cmdMcpReachDb.js";
import type * as cmdMcpTokens from "../cmdMcpTokens.js";
import type * as cmdMissions from "../cmdMissions.js";
import type * as cmdPairing from "../cmdPairing.js";
import type * as cmdPluginArchives from "../cmdPluginArchives.js";
import type * as cmdPluginArchivesVerify from "../cmdPluginArchivesVerify.js";
import type * as cmdPluginCapabilityTokens from "../cmdPluginCapabilityTokens.js";
import type * as cmdPluginInstallJobs from "../cmdPluginInstallJobs.js";
import type * as cmdPlugins from "../cmdPlugins.js";
import type * as cmdPluginsValidators from "../cmdPluginsValidators.js";
import type * as cmdPreferences from "../cmdPreferences.js";
import type * as cmdRadioPairing from "../cmdRadioPairing.js";
import type * as cmdSigningEvents from "../cmdSigningEvents.js";
import type * as cmdSigningKeys from "../cmdSigningKeys.js";
import type * as commandVocabulary from "../commandVocabulary.js";
import type * as comments from "../comments.js";
import type * as communityChangelog from "../communityChangelog.js";
import type * as communityItems from "../communityItems.js";
import type * as contactSubmissions from "../contactSubmissions.js";
import type * as crons from "../crons.js";
import type * as discordNotify from "../discordNotify.js";
import type * as http from "../http.js";
import type * as operatorHmacSecrets from "../operatorHmacSecrets.js";
import type * as paramRegistry from "../paramRegistry.js";
import type * as pluginRegistry from "../pluginRegistry.js";
import type * as pluginRegistryDownload from "../pluginRegistryDownload.js";
import type * as profiles from "../profiles.js";
import type * as storage from "../storage.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  airportData: typeof airportData;
  auth: typeof auth;
  changelogSync: typeof changelogSync;
  changelogSyncMutations: typeof changelogSyncMutations;
  clientConfig: typeof clientConfig;
  cmdAiUsage: typeof cmdAiUsage;
  cmdAtlasJobs: typeof cmdAtlasJobs;
  cmdDroneAccess: typeof cmdDroneAccess;
  cmdDroneCommands: typeof cmdDroneCommands;
  cmdDroneStatus: typeof cmdDroneStatus;
  cmdDrones: typeof cmdDrones;
  cmdFlightLogs: typeof cmdFlightLogs;
  cmdLogdWindows: typeof cmdLogdWindows;
  cmdMcpReach: typeof cmdMcpReach;
  cmdMcpReachDb: typeof cmdMcpReachDb;
  cmdMcpTokens: typeof cmdMcpTokens;
  cmdMissions: typeof cmdMissions;
  cmdPairing: typeof cmdPairing;
  cmdPluginArchives: typeof cmdPluginArchives;
  cmdPluginArchivesVerify: typeof cmdPluginArchivesVerify;
  cmdPluginCapabilityTokens: typeof cmdPluginCapabilityTokens;
  cmdPluginInstallJobs: typeof cmdPluginInstallJobs;
  cmdPlugins: typeof cmdPlugins;
  cmdPluginsValidators: typeof cmdPluginsValidators;
  cmdPreferences: typeof cmdPreferences;
  cmdRadioPairing: typeof cmdRadioPairing;
  cmdSigningEvents: typeof cmdSigningEvents;
  cmdSigningKeys: typeof cmdSigningKeys;
  commandVocabulary: typeof commandVocabulary;
  comments: typeof comments;
  communityChangelog: typeof communityChangelog;
  communityItems: typeof communityItems;
  contactSubmissions: typeof contactSubmissions;
  crons: typeof crons;
  discordNotify: typeof discordNotify;
  http: typeof http;
  operatorHmacSecrets: typeof operatorHmacSecrets;
  paramRegistry: typeof paramRegistry;
  pluginRegistry: typeof pluginRegistry;
  pluginRegistryDownload: typeof pluginRegistryDownload;
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
