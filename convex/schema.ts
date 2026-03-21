import { defineSchema, defineTable } from "convex/server";
import { authTables } from "@convex-dev/auth/server";
import { v } from "convex/values";

export default defineSchema({
  ...authTables,

  profiles: defineTable({
    userId: v.string(),
    role: v.union(
      v.literal("pending"),
      v.literal("investor"),
      v.literal("admin"),
      v.literal("rejected"),
      v.literal("pilot"),
      v.literal("alpha_tester")
    ),
fullName: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    company: v.optional(v.string()),
    linkedin: v.optional(v.string()),
    showName: v.optional(v.boolean()),
    showEmail: v.optional(v.boolean()),
    showLinkedin: v.optional(v.boolean()),
    showPhone: v.optional(v.boolean()),
    investorType: v.optional(v.string()),
    investorTypeOther: v.optional(v.string()),
    ticketSize: v.optional(v.string()),
    notifyUpdates: v.boolean(),
    notifyMilestones: v.boolean(),
  }).index("by_userId", ["userId"]),

  contactSubmissions: defineTable({
    name: v.string(),
    email: v.string(),
    subject: v.optional(v.string()),
    message: v.string(),
    source: v.optional(v.string()),
    company: v.optional(v.string()),
    investorType: v.optional(v.string()),
    linkedin: v.optional(v.string()),
  }),

  comments: defineTable({
    targetType: v.union(
      v.literal("update"),
      v.literal("milestone"),
      v.literal("document"),
      v.literal("general"),
      v.literal("grant"),
      v.literal("changelog"),
      v.literal("community_item")
    ),
    targetId: v.string(),
    authorId: v.id("profiles"),
    body: v.string(),
    deleted: v.optional(v.boolean()),
  })
    .index("by_target", ["targetType", "targetId"])
    .index("by_author", ["authorId"]),

  // ── Community tables ────────────────────────────────────────

  community_changelog: defineTable({
    version: v.string(),
    title: v.string(),
    body: v.string(),
    bodyHtml: v.optional(v.string()),
    publishedAt: v.number(),
    authorId: v.id("profiles"),
    authorName: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    published: v.boolean(),
    source: v.optional(v.union(v.literal("auto"), v.literal("manual"))),
    commitShas: v.optional(v.array(v.string())),
    commitSha: v.optional(v.string()),
    commitUrl: v.optional(v.string()),
    commitDate: v.optional(v.number()),
    editedByAdmin: v.optional(v.boolean()),
    repo: v.optional(v.string()),
    translations: v.optional(v.record(v.string(), v.object({
      title: v.string(),
      description: v.string(),
    }))),
  })
    .index("by_publishedAt", ["published", "publishedAt"])
    .index("by_version", ["version"])
    .index("by_commitSha", ["commitSha"]),

  changelog_sync_state: defineTable({
    lastSyncedSha: v.string(),
    lastSyncedAt: v.number(),
    repo: v.string(),
  }).index("by_repo", ["repo"]),

  community_items: defineTable({
    type: v.union(v.literal("feature"), v.literal("bug")),
    title: v.string(),
    body: v.string(),
    authorId: v.id("profiles"),
    status: v.union(
      v.literal("backlog"),
      v.literal("in_discussion"),
      v.literal("planned"),
      v.literal("in_progress"),
      v.literal("released"),
      v.literal("wont_do"),
    ),
    category: v.union(
      v.literal("command"),
      v.literal("ados"),
      v.literal("website"),
      v.literal("general"),
    ),
    priority: v.optional(v.union(
      v.literal("low"), v.literal("medium"),
      v.literal("high"), v.literal("critical"),
    )),
    upvoteCount: v.number(),
    eta: v.optional(v.string()),
    resolvedVersion: v.optional(v.string()),
    translations: v.optional(v.record(v.string(), v.object({
      title: v.string(),
      description: v.string(),
    }))),
  })
    .index("by_type_status", ["type", "status"])
    .index("by_type_upvotes", ["type", "upvoteCount"])
    .index("by_category", ["category"])
    .index("by_status", ["status"]),

  community_upvotes: defineTable({
    itemId: v.id("community_items"),
    userId: v.string(),
  })
    .index("by_item", ["itemId"])
    .index("by_user_item", ["userId", "itemId"]),

  changelog_reactions: defineTable({
    changelogId: v.id("community_changelog"),
    userId: v.string(),
    reaction: v.string(),
  })
    .index("by_changelog", ["changelogId"])
    .index("by_user_changelog", ["userId", "changelogId"]),

  // ── Command GCS tables (cmd_ prefix) ───────────────────────

  cmd_missions: defineTable({
    userId: v.string(),
    name: v.string(),
    waypoints: v.array(v.object({
      id: v.string(),
      lat: v.number(),
      lon: v.number(),
      alt: v.number(),
      speed: v.optional(v.number()),
      holdTime: v.optional(v.number()),
      command: v.optional(v.string()),
      param1: v.optional(v.number()),
      param2: v.optional(v.number()),
      param3: v.optional(v.number()),
    })),
    droneId: v.optional(v.string()),
    suiteType: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_userId", ["userId"]),

  cmd_connectionPresets: defineTable({
    userId: v.string(),
    name: v.string(),
    type: v.union(v.literal("serial"), v.literal("websocket")),
    config: v.object({
      baudRate: v.optional(v.number()),
      url: v.optional(v.string()),
    }),
  }).index("by_userId", ["userId"]),

  cmd_flightLogs: defineTable({
    userId: v.string(),
    droneId: v.optional(v.string()),
    droneName: v.optional(v.string()),
    missionName: v.optional(v.string()),
    duration: v.number(),
    distance: v.number(),
    maxAlt: v.optional(v.number()),
    maxSpeed: v.optional(v.number()),
    batteryUsed: v.optional(v.number()),
    waypointCount: v.optional(v.number()),
    status: v.union(v.literal("completed"), v.literal("aborted"), v.literal("emergency")),
    completedAt: v.number(),
  }).index("by_userId", ["userId"]),

  cmd_preferences: defineTable({
    userId: v.string(),
    preferences: v.object({
      mapTileSource: v.optional(v.string()),
      units: v.optional(v.string()),
      defaultAlt: v.optional(v.number()),
      defaultSpeed: v.optional(v.number()),
      defaultAcceptRadius: v.optional(v.number()),
      defaultFrame: v.optional(v.string()),
    }),
    updatedAt: v.number(),
  }).index("by_userId", ["userId"]),

  cmd_ai_usage: defineTable({
    userId: v.string(),
    feature: v.string(),
    usedAt: v.number(),
  }).index("by_userId_feature", ["userId", "feature"]),

  cmd_adsbCache: defineTable({
    region: v.string(),
    aircraft: v.string(), // JSON stringified array (stays under 1MB limit)
    source: v.string(),
    fetchedAt: v.number(),
    count: v.number(),
  }).index("by_region", ["region"]),

  // ── ADOS Pairing tables (cmd_ prefix) ──────────────────────

  cmd_drones: defineTable({
    userId: v.string(),
    deviceId: v.string(),
    name: v.string(),
    apiKey: v.string(),
    agentVersion: v.optional(v.string()),
    board: v.optional(v.string()),
    tier: v.optional(v.number()),
    os: v.optional(v.string()),
    mdnsHost: v.optional(v.string()),
    lastIp: v.optional(v.string()),
    lastSeen: v.optional(v.number()),
    fcConnected: v.optional(v.boolean()),
    pairedAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_deviceId", ["deviceId"]),

  // ── Cloud relay tables (cmd_ prefix) ──────────────────────

  cmd_droneStatus: defineTable({
    deviceId: v.string(),
    version: v.string(),
    uptimeSeconds: v.number(),
    boardName: v.optional(v.string()),
    boardTier: v.optional(v.number()),
    boardSoc: v.optional(v.string()),
    boardArch: v.optional(v.string()),
    cpuPercent: v.optional(v.number()),
    memoryPercent: v.optional(v.number()),
    diskPercent: v.optional(v.number()),
    temperature: v.optional(v.float64()),
    fcConnected: v.optional(v.boolean()),
    fcPort: v.optional(v.string()),
    fcBaud: v.optional(v.number()),
    services: v.optional(v.array(v.object({
      name: v.string(),
      status: v.string(),
      cpuPercent: v.optional(v.number()),
      memoryMb: v.optional(v.number()),
    }))),
    lastIp: v.optional(v.string()),
    mdnsHost: v.optional(v.string()),
    peripherals: v.optional(v.any()),
    scripts: v.optional(v.any()),
    suites: v.optional(v.any()),
    enrollment: v.optional(v.any()),
    peers: v.optional(v.any()),
    logs: v.optional(v.any()),
    updatedAt: v.number(),
  })
    .index("by_deviceId", ["deviceId"]),

  cmd_droneCommands: defineTable({
    deviceId: v.string(),
    userId: v.string(),
    command: v.string(),
    args: v.optional(v.any()),
    status: v.union(
      v.literal("pending"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    result: v.optional(v.object({
      success: v.boolean(),
      message: v.string(),
    })),
    data: v.optional(v.any()),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_deviceId_status", ["deviceId", "status"])
    .index("by_deviceId_createdAt", ["deviceId", "createdAt"]),

  cmd_pairingRequests: defineTable({
    deviceId: v.optional(v.string()),
    pairingCode: v.string(),
    agentName: v.optional(v.string()),
    agentVersion: v.optional(v.string()),
    board: v.optional(v.string()),
    tier: v.optional(v.number()),
    os: v.optional(v.string()),
    apiKey: v.optional(v.string()),
    mdnsHost: v.optional(v.string()),
    localIp: v.optional(v.string()),
    expiresAt: v.number(),
    createdBy: v.optional(v.string()),
    claimedBy: v.optional(v.string()),
    claimedAt: v.optional(v.number()),
  })
    .index("by_pairingCode", ["pairingCode"])
    .index("by_deviceId", ["deviceId"])
    .index("by_createdBy", ["createdBy"]),
});
