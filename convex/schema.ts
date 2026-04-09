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
    /** FlightRecord.id from the client (UUID). Stable across sync. */
    clientId: v.string(),
    droneId: v.string(),
    droneName: v.string(),
    suiteType: v.optional(v.string()),
    startTime: v.number(),
    endTime: v.number(),
    duration: v.number(),
    distance: v.number(),
    maxAlt: v.number(),
    maxSpeed: v.number(),
    avgSpeed: v.optional(v.number()),
    batteryUsed: v.number(),
    batteryStartV: v.optional(v.number()),
    batteryEndV: v.optional(v.number()),
    waypointCount: v.number(),
    status: v.union(
      v.literal("in_progress"),
      v.literal("completed"),
      v.literal("aborted"),
      v.literal("emergency"),
    ),
    // Geo
    takeoffLat: v.optional(v.number()),
    takeoffLon: v.optional(v.number()),
    landingLat: v.optional(v.number()),
    landingLon: v.optional(v.number()),
    /** Downsampled track: [[lat, lon], ...]. */
    path: v.optional(v.array(v.array(v.number()))),
    // Recording linkage
    recordingId: v.optional(v.string()),
    hasTelemetry: v.optional(v.boolean()),
    // Analyzer (Phase 5)
    events: v.optional(
      v.array(
        v.object({
          t: v.number(),
          type: v.string(),
          severity: v.union(v.literal("info"), v.literal("warning"), v.literal("error")),
          label: v.string(),
          data: v.optional(v.any()),
        }),
      ),
    ),
    flags: v.optional(
      v.array(
        v.object({
          type: v.string(),
          severity: v.union(v.literal("info"), v.literal("warning"), v.literal("error")),
          message: v.string(),
          suggestion: v.optional(v.string()),
        }),
      ),
    ),
    health: v.optional(
      v.object({
        avgSatellites: v.optional(v.number()),
        avgHdop: v.optional(v.number()),
        maxVibrationRms: v.optional(v.number()),
        batteryHealthPct: v.optional(v.number()),
      }),
    ),
    // User metadata
    customName: v.optional(v.string()),
    notes: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    favorite: v.optional(v.boolean()),
    // Frozen pilot/aircraft snapshot (Phase 7a)
    pilotFirstName: v.optional(v.string()),
    pilotLastName: v.optional(v.string()),
    pilotLicenseNumber: v.optional(v.string()),
    pilotLicenseIssuer: v.optional(v.string()),
    aircraftRegistration: v.optional(v.string()),
    aircraftSerial: v.optional(v.string()),
    aircraftMtomKg: v.optional(v.number()),
    // Sign-and-lock (Phase 7c-3)
    pilotSignedAt: v.optional(v.number()),
    pilotSignatureHash: v.optional(v.string()),
    // Phase 11 — origin tracking for imported records.
    source: v.optional(
      v.union(v.literal("live"), v.literal("dataflash"), v.literal("imported")),
    ),
    sourceFilename: v.optional(v.string()),
    // Phase 12c — frozen loadout snapshot at arm time.
    loadout: v.optional(
      v.object({
        batteryIds: v.optional(v.array(v.string())),
        propSetId: v.optional(v.string()),
        motorSetId: v.optional(v.string()),
        escSetId: v.optional(v.string()),
        cameraId: v.optional(v.string()),
        gimbalId: v.optional(v.string()),
        payloadId: v.optional(v.string()),
        frameId: v.optional(v.string()),
        rcTxId: v.optional(v.string()),
      }),
    ),
    // Phase 14a — sun / moon environmental snapshot.
    sunMoon: v.optional(
      v.object({
        computedAt: v.string(),
        lat: v.number(),
        lon: v.number(),
        sunriseIso: v.optional(v.string()),
        sunsetIso: v.optional(v.string()),
        civilDawnIso: v.optional(v.string()),
        civilDuskIso: v.optional(v.string()),
        goldenHourMorningStartIso: v.optional(v.string()),
        goldenHourMorningEndIso: v.optional(v.string()),
        goldenHourEveningStartIso: v.optional(v.string()),
        goldenHourEveningEndIso: v.optional(v.string()),
        daylightPhase: v.union(
          v.literal("day"),
          v.literal("civil_twilight"),
          v.literal("nautical_twilight"),
          v.literal("astronomical_twilight"),
          v.literal("night"),
        ),
        inGoldenHour: v.boolean(),
        sunAltitudeDeg: v.number(),
        sunAzimuthDeg: v.number(),
        moonPhase: v.number(),
        moonIllumination: v.number(),
        moonPhaseLabel: v.string(),
        moonAltitudeDeg: v.number(),
        moonAzimuthDeg: v.number(),
      }),
    ),
    // Phase 14b — METAR weather snapshot at arm time.
    weatherSnapshot: v.optional(
      v.object({
        observedAt: v.string(),
        stationIcao: v.string(),
        stationName: v.optional(v.string()),
        stationLat: v.optional(v.number()),
        stationLon: v.optional(v.number()),
        stationDistanceKm: v.optional(v.number()),
        tempC: v.optional(v.number()),
        dewPointC: v.optional(v.number()),
        windDirDeg: v.optional(v.number()),
        windKts: v.optional(v.number()),
        gustKts: v.optional(v.number()),
        visibilityMi: v.optional(v.number()),
        ceilingFtAgl: v.optional(v.number()),
        altimeterHpa: v.optional(v.number()),
        flightCategory: v.optional(
          v.union(
            v.literal("VFR"),
            v.literal("MVFR"),
            v.literal("IFR"),
            v.literal("LIFR"),
          ),
        ),
        rawMetar: v.optional(v.string()),
        error: v.optional(v.string()),
      }),
    ),
    // Phase 14c — airspace / NOTAM / TFR intersection snapshot.
    airspaceSnapshot: v.optional(
      v.object({
        computedAt: v.string(),
        pathSampleCount: v.number(),
        windowStartIso: v.string(),
        windowEndIso: v.string(),
        bbox: v.object({
          south: v.number(),
          north: v.number(),
          west: v.number(),
          east: v.number(),
        }),
        intersections: v.array(
          v.object({
            id: v.string(),
            kind: v.union(v.literal("zone"), v.literal("notam"), v.literal("tfr")),
            source: v.string(),
            type: v.string(),
            name: v.string(),
            severity: v.union(v.literal("info"), v.literal("warning"), v.literal("error")),
            floorAltitude: v.optional(v.number()),
            ceilingAltitude: v.optional(v.number()),
            effectiveStartIso: v.optional(v.string()),
            effectiveEndIso: v.optional(v.string()),
            summary: v.optional(v.string()),
          }),
        ),
      }),
    ),
    // Phase 13 — frozen pre-flight checklist + prearm bitmask snapshot.
    preflight: v.optional(
      v.object({
        checklistSessionId: v.optional(v.string()),
        checklistStartedAt: v.optional(v.number()),
        checklistComplete: v.optional(v.boolean()),
        checklistItems: v.optional(
          v.array(
            v.object({
              id: v.string(),
              category: v.string(),
              label: v.string(),
              status: v.union(
                v.literal("pending"),
                v.literal("pass"),
                v.literal("fail"),
                v.literal("skipped"),
              ),
              type: v.union(v.literal("auto"), v.literal("manual")),
              displayValue: v.optional(v.string()),
            }),
          ),
        ),
        sysStatusHealth: v.optional(v.number()),
        sysStatusPresent: v.optional(v.number()),
        sysStatusEnabled: v.optional(v.number()),
        prearmFailures: v.optional(v.array(v.string())),
      }),
    ),
    /** Last mutation time (client-side). Server uses this for last-write-wins conflict resolution. */
    updatedAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_user_clientId", ["userId", "clientId"])
    .index("by_user_startTime", ["userId", "startTime"]),

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

  cmd_airspaceZones: defineTable({
    jurisdiction: v.string(),
    zones: v.string(),       // Compact JSON blob of zone data
    zoneCount: v.number(),
    generatedAt: v.number(),
  }).index("by_jurisdiction", ["jurisdiction"]),

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
    // Absolute resource values
    memoryUsedMb: v.optional(v.number()),
    memoryTotalMb: v.optional(v.number()),
    diskUsedGb: v.optional(v.number()),
    diskTotalGb: v.optional(v.number()),
    cpuCores: v.optional(v.number()),
    boardRamMb: v.optional(v.number()),
    // Process-level totals (single-process architecture)
    processCpuPercent: v.optional(v.number()),
    processMemoryMb: v.optional(v.number()),
    // History arrays for sparkline charts (last 60 samples, 5s interval = 5 min)
    cpuHistory: v.optional(v.array(v.number())),
    memoryHistory: v.optional(v.array(v.number())),
    services: v.optional(v.array(v.object({
      name: v.string(),
      status: v.string(),
      cpuPercent: v.optional(v.number()),
      memoryMb: v.optional(v.number()),
      uptimeSeconds: v.optional(v.number()),
      pid: v.optional(v.number()),
      category: v.optional(v.string()),
    }))),
    lastIp: v.optional(v.string()),
    mdnsHost: v.optional(v.string()),
    // Video pipeline status for GCS auto-discovery
    videoState: v.optional(v.string()),
    videoWhepPort: v.optional(v.number()),
    mavlinkWsPort: v.optional(v.number()),
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
