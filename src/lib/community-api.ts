/**
 * @module community-api
 * @description Typed Convex function references for the community board feature.
 * Uses makeFunctionReference to reference functions in convex/ without requiring
 * codegen (_generated/) to exist at build time. This allows demo mode and standalone
 * builds to work without a Convex deployment.
 * @license GPL-3.0-only
 */

import { makeFunctionReference } from "convex/server";

export const communityApi = {
  changelog: {
    list: makeFunctionReference<"query">("communityChangelog:list"),
    getByVersion: makeFunctionReference<"query">("communityChangelog:getByVersion"),
    getById: makeFunctionReference<"query">("communityChangelog:getById"),
    create: makeFunctionReference<"mutation">("communityChangelog:create"),
    update: makeFunctionReference<"mutation">("communityChangelog:update"),
    remove: makeFunctionReference<"mutation">("communityChangelog:remove"),
    react: makeFunctionReference<"mutation">("communityChangelog:react"),
    reactionCounts: makeFunctionReference<"query">("communityChangelog:reactionCounts"),
    myReactions: makeFunctionReference<"query">("communityChangelog:myReactions"),
  },
  items: {
    list: makeFunctionReference<"query">("communityItems:list"),
    get: makeFunctionReference<"query">("communityItems:get"),
    listByStatus: makeFunctionReference<"query">("communityItems:listByStatus"),
    myUpvotes: makeFunctionReference<"query">("communityItems:myUpvotes"),
    create: makeFunctionReference<"mutation">("communityItems:create"),
    update: makeFunctionReference<"mutation">("communityItems:update"),
    updateStatus: makeFunctionReference<"mutation">("communityItems:updateStatus"),
    remove: makeFunctionReference<"mutation">("communityItems:remove"),
    upvote: makeFunctionReference<"mutation">("communityItems:upvote"),
  },
  comments: {
    list: makeFunctionReference<"query">("comments:list"),
    create: makeFunctionReference<"mutation">("comments:create"),
    remove: makeFunctionReference<"mutation">("comments:remove"),
    count: makeFunctionReference<"query">("comments:countByTarget"),
    countBatch: makeFunctionReference<"query">("comments:countByTargets"),
  },
  contact: {
    submit: makeFunctionReference<"mutation">("contactSubmissions:submit"),
  },
  profiles: {
    getMyProfile: makeFunctionReference<"query">("profiles:getMyProfile"),
    applyForAlpha: makeFunctionReference<"mutation">("profiles:applyForAlpha"),
    listAlphaApplications: makeFunctionReference<"query">("profiles:listAlphaApplications"),
    updateRole: makeFunctionReference<"mutation">("profiles:updateRole"),
  },
  clientConfig: {
    get: makeFunctionReference<"query">("clientConfig:getClientConfig"),
  },
  aiUsage: {
    checkAndRecord: makeFunctionReference<"mutation">("cmdAiUsage:checkAndRecord"),
    getRemaining: makeFunctionReference<"query">("cmdAiUsage:getRemaining"),
  },
  adsbCache: {
    getAll: makeFunctionReference<"query">("cmdAdsbCacheMutations:getAll"),
    getByRegion: makeFunctionReference<"query">("cmdAdsbCacheMutations:getByRegion"),
    getRegionList: makeFunctionReference<"query">("cmdAdsbCacheMutations:getRegionList"),
  },
};
