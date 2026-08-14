/**
 * @module community-api
 * @description Typed Convex API references for the community board feature.
 * Uses typed imports from convex/_generated/api for full type safety.
 * @license GPL-3.0-only
 */

import { api } from "../../convex/_generated/api";

export const communityApi = {
  changelog: {
    list: api.communityChangelog.list,
    listPaginated: api.communityChangelog.listPaginated,
    listRecent: api.communityChangelog.listRecent,
    listCount: api.communityChangelog.listCount,
    getByVersion: api.communityChangelog.getByVersion,
    getById: api.communityChangelog.getById,
    create: api.communityChangelog.create,
    update: api.communityChangelog.update,
    remove: api.communityChangelog.remove,
    react: api.communityChangelog.react,
    reactionCounts: api.communityChangelog.reactionCounts,
    myReactions: api.communityChangelog.myReactions,
  },
  items: {
    list: api.communityItems.list,
    get: api.communityItems.get,
    listByStatus: api.communityItems.listByStatus,
    myUpvotes: api.communityItems.myUpvotes,
    create: api.communityItems.create,
    update: api.communityItems.update,
    updateStatus: api.communityItems.updateStatus,
    remove: api.communityItems.remove,
    upvote: api.communityItems.upvote,
  },
  comments: {
    list: api.comments.list,
    create: api.comments.create,
    remove: api.comments.remove,
    count: api.comments.countByTarget,
    countBatch: api.comments.countByTargets,
  },
  contact: {
    submit: api.contactSubmissions.submit,
  },
  profiles: {
    getMyProfile: api.profiles.getMyProfile,
    updateRole: api.profiles.updateRole,
  },
  clientConfig: {
    get: api.clientConfig.getClientConfig,
    // No credential rides here or anywhere else in this barrel. The browser's
    // broker credential is the operator's own minted write grant
    // (`cmdMqttControlGrantsApi.mint`), scoped to the drones they own, held in
    // memory for the life of the tab and never returned twice.
  },
  aiUsage: {
    checkAndRecord: api.cmdAiUsage.checkAndRecord,
    getRemaining: api.cmdAiUsage.getRemaining,
  },
  plugins: {
    listMine: api.cmdPlugins.listMine,
    getInstallWithPermissions: api.cmdPlugins.getInstallWithPermissions,
    recentEvents: api.cmdPlugins.recentEvents,
    recentCrashes: api.cmdPlugins.recentCrashes,
    recordInstall: api.cmdPlugins.recordInstall,
    grantPermission: api.cmdPlugins.grantPermission,
    revokePermission: api.cmdPlugins.revokePermission,
    setStatus: api.cmdPlugins.setStatus,
    removeInstall: api.cmdPlugins.removeInstall,
    recordEvent: api.cmdPlugins.recordEvent,
  },
  pluginArchives: {
    generateUploadUrl: api.cmdPluginArchives.generateUploadUrl,
    // `verifyArchive` ships in the Node-runtime module
    // `cmdPluginArchivesVerify`. The dialog resolves the action via
    // `makeFunctionReference` so this barrel does not need a typed
    // import that the generated api surface has not picked up yet.
    recordArchive: api.cmdPluginArchives.recordArchive,
    getSignedDownloadUrl: api.cmdPluginArchives.getSignedDownloadUrl,
    getArchive: api.cmdPluginArchives.getArchive,
    listMine: api.cmdPluginArchives.listMine,
  },
  pluginInstallJobs: {
    createJob: api.cmdPluginInstallJobs.createJob,
    cancelJob: api.cmdPluginInstallJobs.cancelJob,
    listJobsForDevice: api.cmdPluginInstallJobs.listJobsForDevice,
    getJob: api.cmdPluginInstallJobs.getJob,
  },
  mcpTokens: {
    mint: api.cmdMcpTokens.mint,
    listMine: api.cmdMcpTokens.listMine,
    revoke: api.cmdMcpTokens.revoke,
    recentAudit: api.cmdMcpTokens.recentAuditEvents,
  },
};
