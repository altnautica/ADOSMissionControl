import { defineSchema, defineTable } from "convex/server";
import { authTables } from "@convex-dev/auth/server";
import { v } from "convex/values";
import {
  gcsParametersValidator,
  flightSkillsValidator,
  targetActionsValidator,
} from "./cmdPluginsValidators";

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
    // Tombstone — the suite framework retired and the client no longer
    // sends or reads suiteType. Kept as v.optional for one release so
    // existing cmd_missions rows that still carry the field validate
    // cleanly. Drop after the shared production cycle finishes.
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
    // Tombstone — see cmd_missions.suiteType comment.
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
    // Analyzer fields
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
    // Frozen pilot/aircraft snapshot at arm time
    pilotFirstName: v.optional(v.string()),
    pilotLastName: v.optional(v.string()),
    pilotLicenseNumber: v.optional(v.string()),
    pilotLicenseIssuer: v.optional(v.string()),
    aircraftRegistration: v.optional(v.string()),
    aircraftSerial: v.optional(v.string()),
    aircraftMtomKg: v.optional(v.number()),
    // Sign-and-lock seal: pilot signature + hash freeze the row
    pilotSignedAt: v.optional(v.number()),
    pilotSignatureHash: v.optional(v.string()),
    // Origin tracking for imported records.
    source: v.optional(
      v.union(v.literal("live"), v.literal("dataflash"), v.literal("imported"), v.literal("ulog"), v.literal("tlog")),
    ),
    sourceFilename: v.optional(v.string()),
    // Frozen loadout snapshot at arm time.
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
    // Sun / moon environmental snapshot at arm time.
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
    // METAR weather snapshot at arm time.
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
    // Mission adherence (intended vs actual).
    missionId: v.optional(v.string()),
    missionName: v.optional(v.string()),
    missionWaypoints: v.optional(
      v.array(
        v.object({
          lat: v.number(),
          lon: v.number(),
          alt: v.number(),
        }),
      ),
    ),
    adherence: v.optional(
      v.object({
        totalWaypoints: v.number(),
        waypointsReached: v.number(),
        maxCrossTrackErrorM: v.number(),
        meanCrossTrackErrorM: v.number(),
        deviationSegments: v.optional(
          v.array(
            v.object({
              startIdx: v.number(),
              endIdx: v.number(),
              maxErrorM: v.number(),
            }),
          ),
        ),
      }),
    ),
    // Geofence forensics: zones snapshot + breach segments.
    geofenceSnapshot: v.optional(
      v.object({
        enabled: v.boolean(),
        maxAltitude: v.optional(v.number()),
        minAltitude: v.optional(v.number()),
        zones: v.optional(
          v.array(
            v.object({
              id: v.string(),
              role: v.union(v.literal("inclusion"), v.literal("exclusion")),
              type: v.union(v.literal("polygon"), v.literal("circle")),
              polygonPoints: v.optional(v.array(v.array(v.number()))),
              circleCenter: v.optional(v.array(v.number())),
              circleRadius: v.optional(v.number()),
            }),
          ),
        ),
      }),
    ),
    geofenceBreaches: v.optional(
      v.array(
        v.object({
          startIdx: v.number(),
          endIdx: v.number(),
          type: v.union(
            v.literal("polygon_outside"),
            v.literal("polygon_inside"),
            v.literal("circle_outside"),
            v.literal("circle_inside"),
            v.literal("max_altitude"),
            v.literal("min_altitude"),
          ),
          zoneId: v.string(),
          maxBreachDistanceM: v.optional(v.number()),
          peakIdx: v.optional(v.number()),
        }),
      ),
    ),
    // Flight phase segmentation (takeoff / climb / cruise / etc).
    phases: v.optional(
      v.array(
        v.object({
          type: v.union(
            v.literal("pre_arm"),
            v.literal("takeoff"),
            v.literal("climb"),
            v.literal("cruise"),
            v.literal("hover"),
            v.literal("descent"),
            v.literal("land"),
            v.literal("post_disarm"),
          ),
          startMs: v.number(),
          endMs: v.number(),
          avgSpeed: v.optional(v.number()),
          maxAlt: v.optional(v.number()),
        }),
      ),
    ),
    // Wind estimation from FC telemetry.
    windEstimate: v.optional(
      v.object({
        speedMs: v.number(),
        fromDirDeg: v.number(),
        sampleCount: v.number(),
        method: v.union(v.literal("vfr_diff"), v.literal("attitude_track")),
      }),
    ),
    // Media files linked to this flight (metadata only, blobs stay in IDB).
    media: v.optional(
      v.array(
        v.object({
          id: v.string(),
          name: v.string(),
          type: v.string(),
          size: v.number(),
          capturedAt: v.number(),
          lat: v.optional(v.number()),
          lon: v.optional(v.number()),
          alt: v.optional(v.number()),
          blobKey: v.string(),
        }),
      ),
    ),
    // Soft-delete fields.
    deleted: v.optional(v.boolean()),
    deletedAt: v.optional(v.number()),
    // Reverse-geocoded place names from takeoff / landing coords.
    takeoffPlaceName: v.optional(v.string()),
    landingPlaceName: v.optional(v.string()),
    country: v.optional(v.string()),
    region: v.optional(v.string()),
    locality: v.optional(v.string()),
    // Frozen pre-flight checklist + prearm bitmask snapshot.
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

  // Denormalized per-user flight-log totals, maintained incrementally inside
  // the cmd_flightLogs upsert/remove mutations. The History tab's stats +
  // count surfaces read this single row instead of scanning (and
  // deserializing the large path/events/media arrays of) every flight log on
  // each render. Mirrors the prior full-scan semantics exactly: every
  // persisted row (including soft-deleted rows, which the scan also summed)
  // contributes to count + the seconds/meters/batteryHours totals. A hard
  // `remove` subtracts its contribution.
  cmd_flightLogAggregates: defineTable({
    userId: v.string(),
    count: v.number(),
    totalSeconds: v.number(),
    totalMeters: v.number(),
    batteryHours: v.number(),
    updatedAt: v.number(),
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

  // ── ADOS Pairing tables (cmd_ prefix) ──────────────────────

  cmd_drones: defineTable({
    userId: v.string(),
    deviceId: v.string(),
    name: v.string(),
    // An empty string means "paired, but no agent key yet" -- the browser can
    // claim a pairing code before the agent has connected, and the field is
    // required so there is no `undefined` to store. Such a row must NEVER
    // authenticate: compare with `agentKeyMatches` (convex/lib/credentials.ts),
    // which refuses a blank on either side. A plain `stored !== presented`
    // check authenticates any caller who sends an empty key.
    apiKey: v.string(),
    agentVersion: v.optional(v.string()),
    board: v.optional(v.string()),
    tier: v.optional(v.number()),
    os: v.optional(v.string()),
    mdnsHost: v.optional(v.string()),
    lastIp: v.optional(v.string()),
    lastSeen: v.optional(v.number()),
    fcConnected: v.optional(v.boolean()),
    // Backend variant. Synced from cmd_droneStatus heartbeats so the
    // fleet view can show a "Lite" pill without an extra query.
    runtimeMode: v.optional(v.string()),
    // Attached panel type derived from cmd_droneStatus.peripherals[].
    // Drives the "LCD" pill on the fleet drone card without an extra
    // query. One of "spi-lcd", "hdmi", "none", or undefined.
    attachedDisplayType: v.optional(v.string()),
    // How the agent landed on its current profile. Synced from
    // cmd_droneStatus heartbeats so the fleet card can render an
    // "auto" pill without an extra query. One of "detected",
    // "tiebreaker", "default", "override", "user", or undefined.
    profileSource: v.optional(v.string()),
    // Wire-contract node profile and role. Synced from cmd_droneStatus
    // heartbeats so listMyDrones consumers (fleet cards, node sidebar)
    // can render profile pills without joining the status row. Profile
    // is "drone" | "ground-station" | "workstation"; role applies
    // to ground stations only.
    profile: v.optional(v.string()),
    role: v.optional(v.string()),
    // Direct LAN MAVLink WebSocket URL the agent advertises in its
    // heartbeat's manualConnectionUrls block. Denormalized onto
    // cmd_drones so the fleet card can render a "Direct" pill (and
    // popover with the URL) without joining cmd_droneStatus on every
    // render. Null when the agent reports no LAN-routable URL.
    manualMavlinkWsUrl: v.optional(v.string()),
    // GPS-denied navigation quick-flag for fleet pills. Synced from
    // cmd_droneStatus.navigation when the agent reports an active
    // optical-flow or VIO estimator. Denormalized so the fleet card
    // can render a "GPS-denied" badge without joining cmd_droneStatus.
    navigationGpsDenied: v.optional(v.boolean()),
    // Inter-rig peer device-id quick-flag for fleet pills. Synced
    // from cmd_droneStatus.peerDeviceId so the fleet card renders a
    // "Peer" pill without joining cmd_droneStatus on every render.
    // Null / undefined when no peer beacon has decoded recently.
    peerDeviceId: v.optional(v.union(v.string(), v.null())),
    peerRssiDbm: v.optional(v.union(v.number(), v.null())),
    // Primary camera discovery state, denormalized from
    // cmd_droneStatus.cameraState so the fleet card can render a
    // "Camera Missing" pill without joining cmd_droneStatus.
    cameraState: v.optional(v.union(v.string(), v.null())),
    // FC-link diagnostic hint ("none" | "msp_detected" | "no_heartbeat"),
    // denormalized from cmd_droneStatus so the fleet card can render the
    // "FC: MSP" / "FC: no MAVLink" pill without joining cmd_droneStatus.
    fcLinkHint: v.optional(v.string()),
    // Cloud posture chosen on the agent: "local" | "cloud" | "self_hosted".
    // Synced from cmd_droneStatus heartbeats so the fleet card can render
    // a "Local-only" pill (and operators can tell intentional local-only
    // from a drone that simply dropped off the cloud relay) without
    // joining cmd_droneStatus on every render.
    cloudPosture: v.optional(v.string()),
    // List of plugin ids currently installed on this drone. Synced
    // from cmd_pluginInstalls so the drone-detail panel can resolve
    // plugin slot contributions (drone.detail.tab and friends)
    // without a separate per-drone query on every render.
    installedPluginIds: v.optional(v.array(v.string())),
    pairedAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_deviceId", ["deviceId"]),

  // Reconstruction-job records for the ADOS Atlas world-model pipeline.
  // A capturing drone's keyframe dataset is reconstructed (splat / cloud /
  // mesh / ortho) on a compute node; one row tracks each job's lifecycle.
  // Ownership rides the capturing device (cmd_drones.deviceId) — the table
  // carries no userId of its own. Written by the compute agent via an
  // internal mutation (the HTTP action validates the device API key
  // upstream, mirroring cmd_droneStatus.pushStatus); read by the owner only.
  cmd_atlasJobs: defineTable({
    deviceId: v.string(),          // capturing drone deviceId
    computeNodeId: v.string(),     // reconstructor node deviceId
    kind: v.string(),              // "splat" | "cloud" | "mesh" | "ortho"
    status: v.string(),            // "queued" | "running" | "done" | "error" | "cancelled"
    sessionId: v.optional(v.string()),   // live sessions; null for post-flight
    inputBag: v.optional(v.string()),    // dataset/bag id the job ran on
    outputUrl: v.optional(v.string()),   // signed artifact URL
    derivedFrom: v.optional(v.string()), // lineage to a prior job id
    metadata: v.optional(v.any()),       // gaussian count, steps, bounds, viewerHint
    startedAt: v.optional(v.number()),
    finishedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_device", ["deviceId"])
    .index("by_computeNode", ["computeNodeId"])
    .index("by_status", ["status"]),

  // ── Cloud relay tables (cmd_ prefix) ──────────────────────

  cmd_droneStatus: defineTable({
    deviceId: v.string(),
    version: v.string(),
    uptimeSeconds: v.number(),
    boardName: v.optional(v.string()),
    boardTier: v.optional(v.number()),
    boardSoc: v.optional(v.string()),
    boardArch: v.optional(v.string()),
    // Probed-from-silicon hardware truth. boardSocProbed is the kernel's
    // device-tree compatible string (authoritative over the board YAML's
    // declared soc); boardCpuProbed is the probed CPU-cluster summary;
    // hwEncoderProbed is the confirmed hardware H.264 encoder node after a
    // real trial-init. All optional so older agents round-trip cleanly.
    boardSocProbed: v.optional(v.string()),
    boardCpuProbed: v.optional(v.string()),
    hwEncoderProbed: v.optional(v.string()),
    // Running kernel release string (uname -r). Reported by the agent
    // every heartbeat so the drone-detail system area can show which
    // kernel the board booted. Older agents omit it.
    kernelRelease: v.optional(v.string()),
    // How the agent's WFB radio kernel module was provided on this
    // board: "prebuilt" (shipped binary), "dkms" (built on-device), or
    // "none" (no module present). Drives the radio-module badge.
    wfbModuleSource: v.optional(v.string()),
    // Overall health of the on-board radio stack, distinct from the
    // moment-to-moment pairing state. One of "ok" | "no_injection"
    // (no injection-capable adapter found) | "unpaired" (stack up but
    // no peer bound) | "no_bind_artifacts" (paired record missing its
    // keys/channel) | "stack_incomplete" (radio driver or transport
    // binaries missing). Drives a diagnostic line on the overview so a
    // regression in the radio install reads distinctly from a plain
    // "not paired". Absent on agents that predate the field.
    radioStackState: v.optional(v.string()),
    // Stable-MAC pin verdicts per onboard network adapter: whether a no-efuse
    // adapter that randomizes its MAC each boot was detected and pinned to a
    // stable address. An object {version, adapters:[...]}; absent on boards
    // with no such adapter. Stored as a free-form object so the per-adapter
    // shape can extend additively without a schema migration.
    macStability: v.optional(v.any()),
    // Operator management-link health from the agent's link guardian: an object
    // {state, iface, transport, backend, carrier, hasLease, gatewayReachable,
    // repairing, lastRung, lastRepairAt, repairsInWindow}. state is "healthy" |
    // "degraded" (up but no data path) | "down". Stored free-form so the shape
    // extends additively without a migration. Absent on agents that predate the
    // guardian; the GCS renders "unknown".
    managementLink: v.optional(v.any()),
    // Per-interface WiFi power-save reconciler verdicts: an object
    // {interfaces:[{iface, powersaveOn, reasserts, lastReassert, signalDbm,
    // linkState}]}. The reconciler holds power-save OFF at runtime; powersaveOn
    // reads false on a healthy interface. Stored free-form so the shape extends
    // additively without a migration. Absent on agents that predate the
    // reconciler; the GCS defaults to undefined.
    wifiPowersave: v.optional(v.any()),
    // Management-link reach-back mode from the agent's failover reconciler:
    // "primary" | "wifi_heartbeat" (degraded, status-only over onboard WiFi) |
    // "none". With the interface + reason when failed over. Absent on agents
    // that predate the reconciler; the GCS treats absence as "primary".
    mgmtLinkMode: v.optional(v.string()),
    mgmtFailoverIface: v.optional(v.union(v.string(), v.null())),
    mgmtFailoverReason: v.optional(v.union(v.string(), v.null())),
    // USB-rehome self-heal state for a slow-port WFB adapter: "idle" |
    // "rehoming" | "exhausted" | "guard_blocked", with the attempt count + last
    // outcome. Absent on agents that predate the self-heal.
    usbRehomeState: v.optional(v.string()),
    usbRehomeAttempts: v.optional(v.union(v.number(), v.null())),
    usbRehomeLastResult: v.optional(v.union(v.string(), v.null())),
    // Install-health summary from the agent's self-check at last boot.
    // One of "ok" | "degraded" | "failed" | "unknown". When degraded or
    // failed, `failedSteps` lists the install steps that did not pass.
    installStatus: v.optional(v.string()),
    // Agent install/build version recorded by the installer. May be
    // absent on agents that predate the install-health surface.
    installVersion: v.optional(v.string()),
    // Names of install steps that failed or degraded during the last
    // install/self-check. Empty or absent when the install is healthy.
    failedSteps: v.optional(v.array(v.string())),
    cpuPercent: v.optional(v.number()),
    memoryPercent: v.optional(v.number()),
    diskPercent: v.optional(v.number()),
    temperature: v.optional(v.float64()),
    fcConnected: v.optional(v.boolean()),
    fcPort: v.optional(v.string()),
    fcBaud: v.optional(v.number()),
    // Gated MAVLink truth — siblings of fcConnected. transportOpen = transport
    // open; mavlinkAlive = a HEARTBEAT decoded within the freshness window;
    // heartbeatAgeS = seconds since the last one; fcSource = resolved source;
    // fcLinkHint = diagnostic hint for a not-alive link ("none" |
    // "msp_detected" | "no_heartbeat"). All optional so heartbeats from agents
    // that predate the gated truth stay additive.
    transportOpen: v.optional(v.boolean()),
    mavlinkAlive: v.optional(v.boolean()),
    heartbeatAgeS: v.optional(v.number()),
    fcSource: v.optional(v.string()),
    fcLinkHint: v.optional(v.string()),
    // FC protocol family the agent identified ("betaflight" | "inav" for an MSP
    // FC), so a cloud-relayed MSP FC drives the MSP adapter + MSP relay lane.
    // Optional so heartbeats from agents that predate the field stay additive.
    fcVariant: v.optional(v.string()),
    // Canonical FC firmware family ("ardupilot" | "px4" | "betaflight" | "inav")
    // so a cloud-relay GCS can badge the family (incl. ArduPilot vs PX4). Optional.
    fcFirmware: v.optional(v.string()),
    // fcReachable = honest connected-or-reachable verdict (true for a healthy
    // MSP FC that never emits the HEARTBEAT the alive gate needs). Emitted as
    // a plain boolean on every packaged-loop heartbeat, so a validator that
    // omits it rejects the entire heartbeat. Optional for older agents.
    fcReachable: v.optional(v.boolean()),
    // Absolute resource values
    memoryUsedMb: v.optional(v.number()),
    memoryTotalMb: v.optional(v.number()),
    // Detailed memory breakdown: available (allocatable without swapping),
    // page-cache, and swap usage. Optional so heartbeats from agents that
    // predate the breakdown stay additive.
    memoryAvailableMb: v.optional(v.number()),
    memoryCacheMb: v.optional(v.number()),
    swapTotalMb: v.optional(v.number()),
    swapUsedMb: v.optional(v.number()),
    swapPercent: v.optional(v.number()),
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
    setupUrl: v.optional(v.string()),
    apiUrl: v.optional(v.string()),
    missionControlUrl: v.optional(v.string()),
    // Video pipeline status for GCS auto-discovery
    videoState: v.optional(v.string()),
    videoWhepPort: v.optional(v.number()),
    videoWhepUrl: v.optional(v.string()),
    // Per-leg video streams (id/role/codec) a multi-stream node serves; the GCS
    // resolves each leg's :8889/<id>/whep URL against the node's reachable host.
    videoStreams: v.optional(
      v.array(
        v.object({
          id: v.string(),
          role: v.optional(v.string()),
          codec: v.optional(v.string()),
          live: v.optional(v.boolean()),
        }),
      ),
    ),
    // Count of pipeline restarts since the last healthy interval.
    // Resets to zero on the agent side once video stays up for the
    // configured cool-down. The GCS surfaces a banner when the count
    // crosses an unhealthy threshold so operators can spot a flapping
    // pipeline without trawling logs.
    videoRestartAttempts: v.optional(v.number()),
    mavlinkWsPort: v.optional(v.number()),
    mavlinkWsUrl: v.optional(v.string()),
    // Previous MAVLink WebSocket URL the agent advertised. Populated
    // when the agent rotates its WebSocket binding (port change,
    // network move). Lets the GCS retry the prior URL once before
    // surfacing a connection error so a brief rotation doesn't drop
    // an in-flight session.
    mavlinkWsUrlPrev: v.optional(v.string()),
    // LAN-routable manual-connection URLs the agent advertises so
    // the operator can dial directly from a workstation on the same
    // network. All optional; each independently null when the agent
    // can't compute a usable URL (no MAVLink TCP listener, no video
    // pipeline, etc.).
    manualConnectionUrls: v.optional(
      v.object({
        mavlinkTcp: v.optional(v.union(v.string(), v.null())),
        mavlinkWs: v.optional(v.union(v.string(), v.null())),
        // Ticket-gated authenticated MAVLink WebSocket endpoint
        // (ground-station profile), as an absolute URL or a path
        // relative to the agent front. Sibling of mavlinkWs. Null when
        // the agent does not advertise the gated endpoint.
        mavlinkWsAuthenticated: v.optional(v.union(v.string(), v.null())),
        videoViewer: v.optional(v.union(v.string(), v.null())),
        videoWhep: v.optional(v.union(v.string(), v.null())),
      }),
    ),
    // Cloud relay = MQTT-to-Convex pair, Cloudflare = inbound tunnel.
    // Split because the prior single "Remote" surface conflated them.
    cloudRelayUrl: v.optional(v.union(v.string(), v.null())),
    cloudflareUrl: v.optional(v.union(v.string(), v.null())),
    // Cloud posture chosen on the agent: "local" | "cloud" | "self_hosted".
    // The drone card renders a "Local-only" pill when this is "local" so
    // operators distinguish an intentionally offline drone from one that
    // dropped off. Absent on older agents — default to "cloud" client-side.
    cloudPosture: v.optional(v.string()),
    // Webapp-side plugin installs reported by the agent. Lets the GCS
    // per-drone Plugins tab surface installs made directly from the
    // agent's local dashboard (port 8080) without a separate fetch.
    pluginInventory: v.optional(
      v.array(
        v.object({
          plugin_id: v.string(),
          version: v.optional(v.union(v.string(), v.null())),
          status: v.optional(v.union(v.string(), v.null())),
          // Per-model delivery outcome (resolved / needs_model / verify_failed),
          // one entry per declared model id. Additive + optional.
          model_status: v.optional(
            v.array(
              v.object({
                state: v.string(),
                model_id: v.string(),
                runtime: v.optional(v.union(v.string(), v.null())),
                path: v.optional(v.union(v.string(), v.null())),
                reason: v.optional(v.union(v.string(), v.null())),
              }),
            ),
          ),
          // Per-service readiness (ready + reason), one entry per declared
          // service. Additive + optional.
          service_status: v.optional(
            v.array(
              v.object({
                name: v.string(),
                ready: v.boolean(),
                reason: v.optional(v.union(v.string(), v.null())),
              }),
            ),
          ),
        }),
      ),
    ),
    // Per-peripheral connection states sampled at the agent every
    // heartbeat. The full peripheral manifests live in
    // ``peripherals`` (untyped); this compact array drives the
    // connected/disconnected dot on the drone card without re-pulling
    // the manifest body.
    peripheralStates: v.optional(
      v.array(
        v.object({
          id: v.string(),
          connected: v.boolean(),
          last_seen: v.optional(v.union(v.number(), v.null())),
        }),
      ),
    ),
    remoteAccess: v.optional(v.any()),
    peripherals: v.optional(v.any()),
    scripts: v.optional(v.any()),
    enrollment: v.optional(v.any()),
    peers: v.optional(v.any()),
    telemetry: v.optional(v.any()),
    logs: v.optional(v.any()),
    // Backend variant the agent process is running. "lite" hides
    // the plugin host, peripheral manager, and scripting surfaces
    // in Mission Control. Absent values default to "full".
    runtimeMode: v.optional(v.string()),
    // Wire-contract identity for the Command-tab node hub. "profile"
    // is "drone" or "ground-station"; "role" is "direct" | "relay" |
    // "receiver" on a ground station, null on a drone. Older agents
    // that don't emit these fields default the GCS to "drone".
    profile: v.optional(v.string()),
    role: v.optional(v.string()),
    // Pairing/uplink failover state. "local" = steady wireless link.
    // "cloud_relay" = local supervisor fell over to the cloud heartbeat
    // path; the GCS shows a notice with a retry control. "failed" =
    // both paths down. Undefined for agents that predate the failover
    // supervisor; the GCS treats absent as "local".
    wfbFailoverState: v.optional(v.string()),
    // Ground-station cloud-relay state, posted by the uplink-aware relay
    // bridge when a ground station is in cloud mode. All optional so a drone
    // (or a GS with no active uplink) round-trips cleanly. "uplink" is the
    // active uplink iface; "throttleState" follows the data-cap ladder
    // ("ok" | "throttle_80" | "throttle_95"); "forwarding*" are the live
    // forwarding decisions derived from that ladder.
    uplink: v.optional(v.string()),
    mqttConnected: v.optional(v.boolean()),
    throttleState: v.optional(v.string()),
    forwardingVideo: v.optional(v.boolean()),
    forwardingTelemetry: v.optional(v.boolean()),
    tsMs: v.optional(v.number()),
    // NPU capability the board declares: npuTops (declared TOPS, 0 when none)
    // + hasAccelerator. Siblings of perceptionTier from the same heartbeat
    // surface; the agent emits both as plain scalars on EVERY heartbeat, so a
    // validator that omits them rejects the entire heartbeat. Optional so an
    // agent that predates the surface round-trips cleanly.
    npuTops: v.optional(v.number()),
    hasAccelerator: v.optional(v.boolean()),
    // Perception tier this node runs on (where detection / tracking runs):
    // "local" (own NPU) | "offload" (a paired compute node) | "hybrid" | "none".
    // "perceptionOffloadTarget" names the workstation the drone is offloading to
    // (host:port), present only on an actual offload path (never a fabricated
    // reach). Both mirror the native /api/status so the LAN and cloud surfaces
    // agree. This OSS-twin /agent/status route PICKS fields explicitly, so each
    // is also listed in http.ts's statusPayload pick list.
    perceptionTier: v.optional(v.string()),
    perceptionOffloadTarget: v.optional(v.string()),
    // Compute-node cluster + job-queue telemetry, posted by a compute-profile
    // agent's heartbeat. All optional so a drone or ground station round-trips
    // cleanly (absent on non-compute profiles). "computeRole" is "master" |
    // "slave"; the queue/worker counts are this node's; the cluster* fields
    // aggregate the master/slave cluster the node fronts. "computeActiveSessions"
    // is the count of live streaming perception-offload sessions the node serves
    // (distinct from queued/active reconstruction jobs). This OSS-twin
    // /agent/status route PICKS fields explicitly, so each is also listed in
    // http.ts's statusPayload pick list.
    computeRole: v.optional(v.string()),
    computeClusterMasterId: v.optional(v.string()),
    computeQueueDepth: v.optional(v.number()),
    computeActiveJobs: v.optional(v.number()),
    computeActiveSessions: v.optional(v.number()),
    computeWorkersIdle: v.optional(v.number()),
    computeClusterAggregateWorkersIdle: v.optional(v.number()),
    computeClusterSlaves: v.optional(
      v.array(
        v.object({
          nodeId: v.string(),
          accelerators: v.array(v.string()),
          workersIdle: v.number(),
          queueDepth: v.number(),
        }),
      ),
    ),
    // Generic plugin-state channel: a map from plugin id to that plugin's own
    // opaque telemetry slice, ferried verbatim by the heartbeat producer (it
    // reads /run/ados/plugins/<id>-state.json). The core knows nothing about any
    // plugin's slice shape — each plugin owns + validates its own. This is how a
    // plugin (e.g. Atlas, under pluginState.atlas) surfaces runtime telemetry to
    // the cloud GCS without adding core columns; the 50th plugin adds none.
    // (compute* above is a bounded PROFILE block, not a plugin, and stays.)
    pluginState: v.optional(v.record(v.string(), v.any())),
    // Setup wizard state on the agent. Live agents report "configured"
    // once the universal webapp wizard has been completed. Older agents
    // omit this and the GCS treats them as configured by default.
    setupState: v.optional(v.string()),
    // How the agent landed on its current profile. One of "detected"
    // (auto-detected by hardware fingerprint), "tiebreaker" (auto with
    // ambiguous signals), "default" (no detect signals, fell back),
    // "override" (forced via /etc/ados/board_override), or "user"
    // (operator picked in the setup webapp).
    profileSource: v.optional(v.string()),
    // Top-level mirror of the selected WFB radio adapter (also nested
    // inside the radio block). `wfbAdapterChipset` is the detected
    // chipset string or null; `wfbAdapterInjectionOk` is true when the
    // adapter entered monitor mode and can inject, false when no
    // injection-capable adapter was found. Optional so older agents that
    // omit them round-trip cleanly.
    wfbAdapterChipset: v.optional(v.union(v.string(), v.null())),
    wfbAdapterInjectionOk: v.optional(v.union(v.boolean(), v.null())),
    // USB link health of the selected adapter. `wfbAdapterUsbDegraded` is true
    // when it enumerated on a slow (12 Mbps full-speed) USB link and may emit no
    // RF despite advancing tx_bytes; `wfbAdapterUsbSpeedMbps` is the speed.
    wfbAdapterUsbDegraded: v.optional(v.union(v.boolean(), v.null())),
    wfbAdapterUsbSpeedMbps: v.optional(v.union(v.number(), v.null())),
    // Radio link snapshot from the air-side WFB-ng pipeline. Populated
    // from the agent heartbeat when the radio service is running. Field
    // names are camelCase here even though the agent emits snake_case
    // on the wire; the cloud relay HTTP action remaps the keys before
    // calling pushStatus.
    radio: v.optional(v.object({
      state: v.string(),
      iface: v.union(v.string(), v.null()),
      driver: v.union(v.string(), v.null()),
      channel: v.union(v.number(), v.null()),
      freqMhz: v.union(v.number(), v.null()),
      bandwidthMhz: v.union(v.number(), v.null()),
      txPowerDbm: v.union(v.number(), v.null()),
      txPowerMaxDbm: v.union(v.number(), v.null()),
      topology: v.union(v.string(), v.null()),
      rssiDbm: v.union(v.number(), v.null()),
      bitrateKbps: v.union(v.number(), v.null()),
      fecRecovered: v.union(v.number(), v.null()),
      fecLost: v.union(v.number(), v.null()),
      packetsLost: v.union(v.number(), v.null()),
      // Channel rendezvous + hop surface. Both sides boot on the fixed
      // home channel and only hop once the link is up. Newer agents
      // report the hop supervisor and peer-rendezvous state so a stuck
      // link (searching for a peer, monitor mode wedged, not actually
      // transmitting) is visible remotely. Optional + nullable: older
      // agents omit them.
      homeChannel: v.optional(v.union(v.number(), v.null())),
      band: v.optional(v.union(v.string(), v.null())),
      regDomain: v.optional(v.union(v.string(), v.null())),
      // Operating-region posture. regPosture is "unrestricted" (radio
      // transmits without a pinned region) or "region" (an operating
      // region is pinned and the strict gate is in force). pinnedRegion is
      // the pinned ISO 3166-1 alpha-2 code; regVerified is true once a
      // pinned region is confirmed effective. Optional + nullable: older
      // agents omit them and render the unrestricted default.
      regPosture: v.optional(v.union(v.string(), v.null())),
      pinnedRegion: v.optional(v.union(v.string(), v.null())),
      regVerified: v.optional(v.union(v.boolean(), v.null())),
      monitorActive: v.optional(v.union(v.boolean(), v.null())),
      txActive: v.optional(v.union(v.boolean(), v.null())),
      peerLink: v.optional(v.union(v.string(), v.null())),
      hopState: v.optional(v.union(v.string(), v.null())),
      // Receive-side link quality. Forwarded by newer agents on both
      // the transmit and receive sides; on a ground station these track
      // the downlink it decodes. Older agents omit them; v.optional +
      // null covers missing-key and explicit-null shapes alike.
      snrDb: v.optional(v.union(v.number(), v.null())),
      noiseDbm: v.optional(v.union(v.number(), v.null())),
      lossPercent: v.optional(v.union(v.number(), v.null())),
      mcsIndex: v.optional(v.union(v.number(), v.null())),
      rxSilentSeconds: v.optional(v.union(v.number(), v.null())),
      // Per-stream video-tx liveness (rule 37). Newer agents flag a
      // wedged video transmitter (UDP ingress backlog pinned while the
      // process is alive) so a silent video stall is visible remotely.
      // Optional + nullable: older agents omit them.
      txVideoStalled: v.optional(v.union(v.boolean(), v.null())),
      txVideoStallKills: v.optional(v.union(v.number(), v.null())),
      txVideoRecvqBytes: v.optional(v.union(v.number(), v.null())),
      // Ground-side receive acquisition surface. A receiver hunts for a
      // valid-decode channel ("searching"), settles once it locks
      // ("locked"), or reports it has heard nothing from a peer yet
      // ("no-peer"). `channelLocked` is the boolean form of that lock.
      // `reacquireKills` counts destructive ground wfb_rx restarts from
      // the valid-packet watchdog; a climbing value means the receive
      // link is thrashing. `rxZombieKills` counts restarts the receive
      // liveness watchdog fired because wfb_rx was alive yet had stopped
      // decoding (a process-silent stall, distinct from a decode thrash).
      // `validRxPacketsPerS` is the per-second valid WFB decode rate on
      // the ground. Optional + nullable: agents on the transmit side and
      // older agents omit them.
      acquireState: v.optional(v.union(v.string(), v.null())),
      channelLocked: v.optional(v.union(v.boolean(), v.null())),
      // The other half of the received-side proof: true when the transmit
      // counter advances while no return signal has been confirmed. Null means
      // "no verdict" and is NOT the same as false — a false would claim the
      // transmit path had been proven, so the null must be storable. Optional +
      // nullable: older agents omit it.
      rfUnverified: v.optional(v.union(v.boolean(), v.null())),
      reacquireKills: v.optional(v.union(v.number(), v.null())),
      rxZombieKills: v.optional(v.union(v.number(), v.null())),
      validRxPacketsPerS: v.optional(v.union(v.number(), v.null())),
      // Selected WFB radio adapter surface. `adapterChipset` is the
      // detected chipset string (e.g. "RTL8812EU") or null when unknown.
      // `adapterInjectionOk` is true when the selected adapter entered
      // monitor mode and is injection-capable, false when no
      // injection-capable adapter was found (the agent then refuses to
      // transmit). Optional + nullable: older agents omit them.
      adapterChipset: v.optional(v.union(v.string(), v.null())),
      adapterInjectionOk: v.optional(v.union(v.boolean(), v.null())),
      // USB link health of the selected adapter (see the top-level
      // wfbAdapterUsb* fields). Optional + nullable; older agents omit them.
      adapterUsbDegraded: v.optional(v.union(v.boolean(), v.null())),
      adapterUsbSpeedMbps: v.optional(v.union(v.number(), v.null())),
      // PHY at the muted txpower floor: the adapter injects frames yet
      // radiates nothing (txpower readback collapses toward the floor,
      // carrier down). Distinct from adapterUsbDegraded (slow USB link) and
      // adapterInjectionOk (no injection-capable adapter). Optional +
      // nullable; older agents omit it.
      phyMuted: v.optional(v.union(v.boolean(), v.null())),
      // Live radio tuning surface. fecK/fecN are the data plane's running
      // Reed-Solomon ratio (mcsIndex above is its running rate). linkPreset is
      // the operator-facing preset name. adaptiveBitrateEnabled is true when the
      // closed-loop FEC controller is armed; the recommendedTier* fields are its
      // current ladder rung. Optional + nullable: older agents omit them.
      fecK: v.optional(v.union(v.number(), v.null())),
      fecN: v.optional(v.union(v.number(), v.null())),
      linkPreset: v.optional(v.union(v.string(), v.null())),
      adaptiveBitrateEnabled: v.optional(v.union(v.boolean(), v.null())),
      recommendedTierIdx: v.optional(v.union(v.number(), v.null())),
      recommendedTierName: v.optional(v.union(v.string(), v.null())),
      recommendedBitrateKbps: v.optional(v.union(v.number(), v.null())),
      // Radio-data-plane churn + transmit-rate observability. The live
      // radio sidecar carries these counters so a thrashing or zombie
      // transmitter is visible remotely. Null when an older sidecar omits
      // them so the UI tells "no reading" from a real zero.
      txZombieKills: v.optional(v.union(v.number(), v.null())),
      txBytesPerS: v.optional(v.union(v.number(), v.null())),
      restartCount: v.optional(v.union(v.number(), v.null())),
      // Pair-state surface added in agent v0.16. Old rows from
      // pre-0.16 heartbeats lack these fields; the cloud relay
      // remap leaves them undefined and the GCS treats them as
      // "unpaired". v.optional + v.union(...,v.null()) covers both
      // shapes the relay may forward (missing key vs explicit null).
      paired: v.optional(v.boolean()),
      pairedWithDeviceId: v.optional(v.union(v.string(), v.null())),
      pairedAt: v.optional(v.union(v.string(), v.null())),
      publicKeyFingerprint: v.optional(v.union(v.string(), v.null())),
      autoPairEnabled: v.optional(v.union(v.boolean(), v.null())),
    })),
    // CRSF/ExpressLRS control-lane telemetry, mirrored from the agent's
    // crsf-stats sidecar. Pre-declared ahead of the emitting agent: the
    // strict args validator rejects an undeclared key and fails the
    // ENTIRE heartbeat the moment an agent starts sending the block.
    // The whole block is optional — absent when the control-lane service
    // is not running or its sidecar is stale — and every field inside is
    // optional + nullable: numbers/strings are null when unmeasured, and
    // a null rfUnverified means "no verdict" (never a fabricated false,
    // which would claim the transmit path had been proven).
    crsf: v.optional(v.object({
      v: v.optional(v.union(v.number(), v.null())),
      state: v.optional(v.union(v.string(), v.null())),
      rssiDbm: v.optional(v.union(v.number(), v.null())),
      lqUplink: v.optional(v.union(v.number(), v.null())),
      lqDownlink: v.optional(v.union(v.number(), v.null())),
      snrDb: v.optional(v.union(v.number(), v.null())),
      band: v.optional(v.union(v.string(), v.null())),
      packetRateHz: v.optional(v.union(v.number(), v.null())),
      txPowerMw: v.optional(v.union(v.number(), v.null())),
      txFramesPerS: v.optional(v.union(v.number(), v.null())),
      rxFramesPerS: v.optional(v.union(v.number(), v.null())),
      rfUnverified: v.optional(v.union(v.boolean(), v.null())),
      mode: v.optional(v.union(v.string(), v.null())),
      channelSource: v.optional(v.union(v.string(), v.null())),
      relayRole: v.optional(v.union(v.string(), v.null())),
      fcCommandDownGated: v.optional(v.union(v.boolean(), v.null())),
    })),
// Local SPI LCD surface state. Reported by the agent's OLED/LCD
    // service when a panel is attached and the renderer is active.
    // All fields are optional so heartbeats from agents without a
    // local display (or pre-LCD agent versions) leave them undefined.
    lcdActivePage: v.optional(v.string()),
    lcdTouchCalibrated: v.optional(v.boolean()),
    lcdRotation: v.optional(v.number()),
    lcdSnapshotUrl: v.optional(v.string()),
    lcdLastTouchAt: v.optional(v.number()),
    lcdLastGesture: v.optional(v.string()),
    // Local on-board video surface (the LCD video page tap). Reports
    // whether the agent is decoding a stream locally for the panel and
    // whether a recording is in progress. Independent of the WHEP
    // browser stream advertised via videoState/videoWhepUrl.
    videoLocalDecoderActive: v.optional(v.boolean()),
    videoLocalDecoderType: v.optional(v.string()),
    videoLocalDecoderFps: v.optional(v.number()),
    videoRecording: v.optional(v.boolean()),
    // Effective primary local-display path resolved by the agent each
    // heartbeat. Values: "hdmi" | "lcd" | "none". Reflects the operator's
    // ground_station.display.type config when set explicitly; under "auto"
    // the agent probes both renderers and HDMI wins when both are wired.
    // Distinct from the runtime `display` block (which describes the SPI
    // LCD peripheral specifically). Undefined on agents that predate the
    // enrichment.
    displayType: v.optional(v.string()),
    // Operator-selected UI theme on the agent. Mirrored back so the
    // GCS can reflect the same theme on its own surfaces and the
    // welcome flow can detect drift.
    uiTheme: v.optional(v.string()),
    // Epoch milliseconds of the last time the agent's plugin update
    // checker ran a registry sweep against the installed plugins.
    // Surfaced in the per-plugin update settings drawer so an operator
    // can confirm the auto-update loop is alive. Older agents that
    // predate the loop omit this field; the GCS renders "Never checked".
    last_plugin_update_check_at: v.optional(v.number()),
    // Inter-rig peer presence — populated by the agent's HopListener
    // when it decodes a WFB-radio PresenceBeacon from the paired peer.
    // All five fields are optional; they stay undefined until at least
    // one beacon decodes and the agent's 60s freshness gate accepts.
    // Drone heartbeats carry the GS's identity; GS heartbeats carry
    // the drone's identity.
    peerDeviceId: v.optional(v.union(v.string(), v.null())),
    peerRole: v.optional(v.union(v.string(), v.null())),
    peerChannel: v.optional(v.union(v.number(), v.null())),
    peerRssiDbm: v.optional(v.union(v.number(), v.null())),
    peerSeenAtUnix: v.optional(v.union(v.number(), v.null())),
    // The LIST of WFB peers a ground station relays (a GS can be linked to
    // more than one drone, which the scalar peer* fields above cannot
    // represent). Populated from the agent's linked-peers sidecar; each entry
    // carries only what the PresenceBeacon + listener decode. A GCS paired
    // only to the ground node reads this to enrol each drone as its own node.
    // Absent on a drone / a peerless ground node; the strict inner v.object
    // rejects an undeclared key, so it declares exactly the producer's set.
    linkedPeers: v.optional(
      v.array(
        v.object({
          deviceId: v.string(),
          role: v.optional(v.union(v.string(), v.null())),
          channel: v.optional(v.union(v.number(), v.null())),
          rssiDbm: v.optional(v.union(v.number(), v.null())),
          seenAtUnix: v.optional(v.union(v.number(), v.null())),
        }),
      ),
    ),
    // Primary camera discovery state on the air-side video pipeline.
    // "ready" → at least one camera assigned and live. "missing" →
    // pipeline scanned but no v4l2 node enumerated. "error" → driver
    // or HAL probe failed. Older agents that predate the surface
    // omit the field (the drone card hides the pill).
    cameraState: v.optional(v.union(v.string(), v.null())),
    // USB camera-recovery self-heal state from the air-side reconciler.
    // `state` walks idle → monitoring → rebinding → port_cycling →
    // hub_resetting / needs_hub_reset / guard_blocked / exhausted; `case`
    // is the agent's diagnosis of the missing-camera situation (or null);
    // the remaining fields bound the recovery episode. Inner fields are
    // optional + nullable so a slightly older agent payload still
    // validates. The GCS capability store reads this to drive the
    // camera-reseat badge remotely. Absent on agents that predate it.
    cameraUsbRecovery: v.optional(
      v.object({
        state: v.optional(v.union(v.string(), v.null())),
        case: v.optional(v.union(v.string(), v.null())),
        attempts: v.optional(v.union(v.number(), v.null())),
        maxAttempts: v.optional(v.union(v.number(), v.null())),
        cameraPresent: v.optional(v.union(v.boolean(), v.null())),
        expected: v.optional(v.union(v.boolean(), v.null())),
        pppsCapable: v.optional(v.union(v.boolean(), v.null())),
      }),
    ),
    // FC CAN bus configuration. Array of per-port entries. Absent
    // during warmup; empty array means agent has the params but
    // reports both ports disabled.
    canBuses: v.optional(v.array(v.object({
      port: v.number(),
      driver: v.number(),
      bitrate: v.number(),
      protocol: v.number(),
    }))),
    // Vision engine summary. Populated each heartbeat when a detection
    // model is loaded. `visionActiveModel` is the active model id (null
    // when idle); `visionBackend` is the inference backend ("ort" |
    // "rknn" | "mock"); `visionDetectionsPerSec` and `visionFps` are the
    // rolling throughput figures. All optional so agents that predate
    // the vision surface round-trip cleanly; old rows read back as
    // undefined and the drone-detail Vision tab renders an idle state.
    visionActiveModel: v.optional(v.union(v.string(), v.null())),
    visionBackend: v.optional(v.union(v.string(), v.null())),
    visionDetectionsPerSec: v.optional(v.number()),
    visionFps: v.optional(v.number()),
    // Per-service config-load errors. Each entry names a service whose
    // config file failed to parse (the agent kept running on built-in
    // defaults for that service). Present only for services currently in
    // an errored state; empty/absent when every config loaded cleanly.
    // Older agents omit it so old rows read back as undefined and the
    // drone-detail Health surface shows no error banner.
    configErrors: v.optional(
      v.array(
        v.object({
          service: v.string(),
          error: v.string(),
        }),
      ),
    ),
    updatedAt: v.number(),
  })
    .index("by_deviceId", ["deviceId"]),

  cmd_droneCommands: defineTable({
    deviceId: v.string(),
    userId: v.string(),
    command: v.string(),
    args: v.optional(v.any()),
    // "pending"    — queued, not yet picked up by the agent.
    // "delivering" — claimed by an agent for execution; the claim carries a
    //                lease so a crashed/disconnected agent's claim expires
    //                and the row becomes claimable again (bounded by
    //                `attempts`). The terminal statuses are set on ack.
    // "completed" / "failed" — terminal.
    status: v.union(
      v.literal("pending"),
      v.literal("delivering"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    result: v.optional(v.object({
      success: v.boolean(),
      message: v.string(),
    })),
    data: v.optional(v.any()),
    createdAt: v.number(),
    // When the row was last claimed (status flipped to "delivering"). The
    // lease is `claimedAt + lease window`; a stale lease lets the next poll
    // reclaim the row so a crashed agent does not strand a command forever.
    claimedAt: v.optional(v.number()),
    // Delivery attempt count, incremented on each claim. Bounds re-execution
    // of a non-idempotent command when an ack never arrives.
    attempts: v.optional(v.number()),
    completedAt: v.optional(v.number()),
  })
    .index("by_deviceId_status", ["deviceId", "status"])
    .index("by_deviceId_createdAt", ["deviceId", "createdAt"])
    // Retention sweep: range terminal rows by completion time so the cleanup
    // cron deletes old completed/failed rows with a bounded indexed scan
    // instead of a full-table walk.
    .index("by_status_completedAt", ["status", "completedAt"]),

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
    // Agent-authoritative pairing-code expiry (epoch seconds) lifted
    // from the beacon body. The server-side expiresAt above is the
    // cloud-relay TTL; this field mirrors what the agent's local
    // wizard is showing the operator so the GCS countdown matches the
    // physical device. Optional so legacy beacons keep registering.
    pairingCodeExpiresAt: v.optional(v.number()),
    createdBy: v.optional(v.string()),
    claimedBy: v.optional(v.string()),
    claimedAt: v.optional(v.number()),
  })
    .index("by_pairingCode", ["pairingCode"])
    .index("by_deviceId", ["deviceId"])
    .index("by_createdBy", ["createdBy"])
    // Lets the retention sweep delete only the rows past TTL with a bounded
    // indexed range scan instead of a full-table .filter().collect().
    .index("by_expiresAt", ["expiresAt"]),

  // Legacy rows for MAVLink v2 signing-key cloud sync. New plaintext uploads
  // are disabled until encrypted storage is available. Function logs MUST NOT
  // echo keyHex. See convex/cmdSigningKeys.ts.
  cmd_signingKeys: defineTable({
    userId: v.string(),
    droneId: v.string(),
    keyHex: v.string(),                   // 64-char hex, plaintext (v1 trust model)
    keyId: v.string(),                    // 8-char sha256 fingerprint, log-safe
    linkIdOwner: v.number(),              // this row's owning link_id
    linkIdsInUse: v.array(v.number()),    // every link_id claimed by any device for this drone
    enrolledAt: v.string(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_drone", ["userId", "droneId"]),

  // Append-only audit log for signing events. Log-safe fields only:
  // keyId (8-char fingerprint) is stored, keyHex is NEVER stored here.
  // Compliance exports read this table to produce a timeline of every
  // signing action per drone per user.
  cmd_signingEvents: defineTable({
    userId: v.string(),
    droneId: v.string(),
    eventType: v.union(
      v.literal("enrollment"),
      v.literal("rotation"),
      v.literal("import"),
      v.literal("export"),
      v.literal("disable"),
      v.literal("cloud_sync_on"),
      v.literal("cloud_sync_off"),
      v.literal("clear_fc"),
      v.literal("key_mismatch_detected"),
      v.literal("user_purge_on_signout"),
      v.literal("fc_rejected_enrollment"),
      v.literal("require_on"),
      v.literal("require_off"),
    ),
    keyIdOld: v.optional(v.string()),
    keyIdNew: v.optional(v.string()),
    deviceFingerprint: v.string(),        // hashed browser id, not raw
    createdAt: v.number(),
  })
    .index("by_user_drone", ["userId", "droneId"])
    .index("by_user_created", ["userId", "createdAt"]),

  // Plugin install record. One row per (user, droneId, pluginId). The
  // GCS reads this to decide which plugins to mount and where; the
  // agent writes status updates through cloud relay or the user's
  // hosted Convex deployment.
  cmd_pluginInstalls: defineTable({
    userId: v.string(),
    droneId: v.optional(v.string()),       // null = GCS-only plugin
    pluginId: v.string(),                  // reverse-DNS, e.g. com.flir.thermal
    version: v.string(),                   // semver
    name: v.string(),
    source: v.union(
      v.literal("local_file"),
      v.literal("git_url"),
      v.literal("registry"),
      v.literal("builtin")
    ),
    sourceUri: v.optional(v.string()),
    signerId: v.optional(v.string()),
    manifestHash: v.string(),              // sha256 of manifest yaml
    status: v.union(
      v.literal("installed"),              // unpacked, perms not granted
      v.literal("enabled"),                // perms granted, awaiting start
      v.literal("running"),
      v.literal("disabled"),
      v.literal("crashed"),
      v.literal("removed")
    ),
    bundleStorageId: v.optional(v.id("_storage")),  // GCS half blob, if any
    // Denormalized gcs.contributes slot entries from the manifest, so the
    // contribution producer mounts iframes without fetching the manifest
    // blob each render. Populated at install time from the parsed manifest.
    gcsContributes: v.optional(
      v.array(
        v.object({
          slot: v.string(),                 // PluginSlotName, e.g. "video.overlay"
          panelId: v.string(),              // gcs.contributes[].id
          title: v.optional(v.string()),
          icon: v.optional(v.string()),
          order: v.optional(v.number()),
          // Node profiles a node.detail.tab is offered on. Absent = any
          // profile the host allows. Populated from the manifest's tab
          // contribution so the producer can profile-filter a tab.
          profile: v.optional(
            v.array(
              v.union(
                v.literal("drone"),
                v.literal("ground-station"),
                v.literal("workstation"),
              )
            )
          ),
        })
      )
    ),
    // Denormalized declarative parameter contributions from the manifest, so
    // the native parameter panel renders a plugin's settings form without
    // re-fetching the manifest. Additive-optional; older rows omit it.
    gcsParameters: v.optional(gcsParametersValidator),
    // Denormalized flight-skill contributions from the manifest, so the cockpit
    // Skill Bar mounts a plugin skill for a cloud operator without re-fetching
    // the manifest. Additive-optional; older rows omit it.
    flightSkills: v.optional(flightSkillsValidator),
    // Denormalized cockpit target-action contributions from the manifest, so
    // the click-a-target popup lists them for a cloud operator. Additive.
    targetActions: v.optional(targetActionsValidator),
    halves: v.array(v.union(v.literal("agent"), v.literal("gcs"))),
    installedAt: v.number(),
    enabledAt: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_user_plugin", ["userId", "pluginId"])
    .index("by_drone", ["droneId"])
    .index("by_installed_at", ["installedAt"])
    // Per-drone view inside the drone detail panel filters
    // installs by (user, droneId, pluginId). droneId stays optional
    // through the v1.0 → v1.1 migration window; a follow-up tightens
    // the field to required once the cutover lands.
    .index("by_user_drone_plugin", ["userId", "droneId", "pluginId"]),

  // Per-permission grant. Two-stage install dialog records each
  // declared permission as a row with granted=false; operator approval
  // flips granted=true and stamps grantedAt + grantedBy.
  cmd_pluginPermissions: defineTable({
    userId: v.string(),
    pluginInstallId: v.id("cmd_pluginInstalls"),
    pluginId: v.string(),                  // denormalized for fast filter
    permissionId: v.string(),              // e.g. event.publish
    granted: v.boolean(),
    required: v.boolean(),
    grantedAt: v.optional(v.number()),
    grantedBy: v.optional(v.string()),     // userId of approver
    revokedAt: v.optional(v.number()),
  })
    .index("by_install", ["pluginInstallId"])
    .index("by_user_plugin", ["userId", "pluginId"])
    .index("by_install_perm", ["pluginInstallId", "permissionId"]),

  // Append-only event log per plugin: lifecycle, capability denials,
  // crashes, operator actions. TTL 30 days enforced by `cleanup_pluginEvents`
  // cron (added when the cleanup function lands).
  cmd_pluginEvents: defineTable({
    userId: v.string(),
    pluginInstallId: v.id("cmd_pluginInstalls"),
    pluginId: v.string(),
    type: v.union(
      v.literal("installed"),
      v.literal("enabled"),
      v.literal("disabled"),
      v.literal("removed"),
      v.literal("started"),
      v.literal("stopped"),
      v.literal("crashed"),
      v.literal("permission_granted"),
      v.literal("permission_revoked"),
      v.literal("permission_denied"),
      v.literal("update_available"),
      v.literal("update_applied"),
      v.literal("operator_note")
    ),
    severity: v.union(
      v.literal("info"),
      v.literal("warning"),
      v.literal("error")
    ),
    message: v.string(),
    payload: v.optional(v.any()),
    createdAt: v.number(),
  })
    .index("by_install", ["pluginInstallId"])
    .index("by_user_plugin", ["userId", "pluginId"])
    .index("by_install_type", ["pluginInstallId", "type"])
    .index("by_user_created", ["userId", "createdAt"]),

  // Uploaded .adosplug archive blobs keyed by (userId, sha256). One
  // row per uploaded archive; reused across drones via refCount so a
  // fleet-wide install does not re-upload the same payload. Manifest
  // hash, declared permissions, and signature travel with the row so
  // the install dialog and the agent both verify against the same
  // source of truth.
  plugin_archives: defineTable({
    userId: v.string(),
    storageId: v.id("_storage"),
    fileName: v.string(),
    sizeBytes: v.number(),
    sha256: v.string(),
    pluginId: v.string(),
    version: v.string(),
    manifestHash: v.string(),
    declaredPermissions: v.array(v.object({
      id: v.string(),
      required: v.boolean(),
    })),
    signerId: v.optional(v.string()),
    signatureB64: v.optional(v.string()),
    uploadedAt: v.number(),
    refCount: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_plugin_version", ["userId", "pluginId", "version"])
    .index("by_sha256", ["sha256"]),

  // Cloud-relay install job. Carries the GCS → cloud → agent install
  // request through the six-stage state machine. Each job is scoped
  // to a single (operator, drone, plugin) install. cmdId is set on
  // the cloud-relay path so the agent's command poller can correlate
  // job updates with the queue row; left undefined on a LAN-direct
  // install. installId is set once cmd_pluginInstalls has been
  // created so the GCS can deep-link from the job into the install.
  plugin_install_jobs: defineTable({
    userId: v.string(),
    operatorId: v.string(),
    deviceId: v.string(),
    archiveId: v.id("plugin_archives"),
    pluginId: v.string(),
    version: v.string(),
    requestedPermissions: v.array(v.string()),
    // State machine:
    // queued | commanded | downloading | verifying | installing
    // | completed | failed | cancelled
    stage: v.string(),
    cmdId: v.optional(v.id("cmd_droneCommands")),
    installId: v.optional(v.id("cmd_pluginInstalls")),
    error: v.optional(v.object({
      code: v.string(),
      message: v.string(),
    })),
    attempts: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_device_stage", ["deviceId", "stage"])
    .index("by_cmd", ["cmdId"]),

  // Per-operator HMAC secret used to mint capability tokens for the
  // GCS → agent plugin RPC bridge. Rotated monthly; previousSecretBase64
  // covers the overlap window so tokens minted just before rotation
  // remain valid until they expire.
  operator_hmac_secrets: defineTable({
    userId: v.string(),
    secretBase64: v.string(),
    rotatedAt: v.number(),
    previousSecretBase64: v.optional(v.string()),
  })
    .index("by_user", ["userId"]),

  // ADOS MCP machine credentials. An operator mints one scoped, revocable, opaque
  // credential in the MCP tab and runs the MCP server with it; only the SHA-256
  // hash is stored, so a DB read cannot recover a usable credential. Verified by
  // `cmdMcpReach`; the plaintext is returned once at mint (`cmdMcpTokens.mint`).
  cmd_mcpTokens: defineTable({
    userId: v.string(),
    tokenId: v.string(),
    tokenHash: v.string(),
    scopes: v.array(v.string()),
    allowedNodes: v.array(v.string()),
    label: v.string(),
    createdAt: v.number(),
    expiresAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
    lastUsedAt: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_tokenHash", ["tokenHash"]),

  // Per-operator broker write grants for the cloud relay. The browser's shared
  // broker credential is read-only, so a relay session can watch a drone and
  // cannot command it; a grant is the scoped, expiring credential that lets one
  // operator publish FC frames and video signaling offers for the devices they
  // own, without handing every browser a fleet-wide write key.
  //
  // `passwdEntry` is the broker's own verifier (see `mosquittoPasswd`), not the
  // secret: the plaintext is returned once at mint and never stored, so a read
  // of this table cannot authenticate anything. `principal` is deliberately
  // opaque rather than derived from the user id, because it is written into a
  // file on the broker host and should not carry operator identity.
  //
  // Writes are narrowed per device at the ACL, not here: holding a grant is not
  // the same as being permitted a topic, and the broker remains the authority.
  cmd_mqttControlGrants: defineTable({
    userId: v.string(),
    /** Opaque broker username, e.g. `gcs-op-<random>`. */
    principal: v.string(),
    /** Broker password-file line. A verifier, never the secret. */
    passwdEntry: v.string(),
    /** Devices this grant authorises writes for, at mint time. */
    deviceIds: v.array(v.string()),
    createdAt: v.number(),
    expiresAt: v.number(),
    revokedAt: v.optional(v.number()),
    /** Last time the holder proved the broker accepted a write. */
    lastConfirmedAt: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_principal", ["principal"])
    .index("by_expiresAt", ["expiresAt"]),

  // ADOS MCP audit mirror: one lean, already-redacted row per tool call an AI
  // client made through the MCP server, so the Mission Control MCP tab reads a
  // single cross-node history instead of each node's local store. The full
  // (redacted) argument map stays in the server's local file + the agent log
  // store; this mirror carries only what the Audit Log renders. Rows are pushed
  // by the credential-holding server via cmdMcpReach.recordAudit and scoped to
  // the owning operator. Idempotent on contentHash so a re-push never duplicates.
  cmd_mcpAuditEvents: defineTable({
    userId: v.string(),
    tokenId: v.string(),
    tool: v.string(),
    node: v.string(),
    decision: v.union(
      v.literal("allowed"),
      v.literal("denied"),
      v.literal("confirmed"),
      v.literal("operator_absent"),
    ),
    result: v.string(),
    plane: v.union(v.literal("lan_direct"), v.literal("cloud_relay"), v.literal("on_box")),
    latencyMs: v.number(),
    tsUs: v.number(),
    mcpSession: v.optional(v.string()),
    argsRedacted: v.optional(v.boolean()),
    sensitiveRead: v.optional(v.boolean()),
    contentHash: v.string(),
    createdAt: v.number(),
  })
    .index("by_user_created", ["userId", "createdAt"])
    .index("by_contentHash", ["contentHash"]),

  // Explicitly exported on-device log windows. The agent's durable
  // local log store stays the source of truth; an operator can push a
  // chosen window (a session, or a closed time range, for one record
  // kind) to the paired cloud account as a revocable export. One row
  // per stored blob. Dedup is by (deviceId, contentHash) where
  // contentHash is the SHA-256 the server recomputes from the stored
  // bytes (never a client claim), so re-pushing the same deterministic
  // window is a no-op that reuses the existing row. userId is
  // denormalized from the paired device record at insert so account
  // cleanup can cascade without a join.
  logd_windows: defineTable({
    userId: v.string(),
    deviceId: v.string(),
    sessionId: v.string(),       // "" when the window had no session
    kind: v.string(),            // logs | metrics | events | hw | mixed
    windowStartUs: v.number(),
    windowEndUs: v.number(),
    contentHash: v.string(),     // server-recomputed sha256(bytes), hex
    format: v.string(),          // jsonl.zst | jsonl
    rowCount: v.number(),
    sizeBytes: v.number(),
    storageId: v.id("_storage"),
    pushedAt: v.number(),        // epoch ms
  })
    .index("by_device_hash", ["deviceId", "contentHash"])
    .index("by_device_pushedAt", ["deviceId", "pushedAt"])
    .index("by_user", ["userId"])
    // Retention sweep: range exported windows by age so the cleanup cron
    // deletes old rows (and their stored blobs) with a bounded indexed scan.
    .index("by_pushedAt", ["pushedAt"]),

  // ── Plugin Registry tables (mirror of website-side catalog) ────
  // Public-read catalog mirror so self-hosted GCS instances can list
  // and resolve plugins independently of the central web app. Writes
  // happen on the website's Convex deployment only; this side serves
  // reads via the queries in convex/pluginRegistry.ts.

  registry_plugins: defineTable({
    plugin_id: v.string(),
    name: v.string(),
    description: v.string(),
    category: v.union(
      v.literal("drivers"),
      v.literal("ui"),
      v.literal("ai"),
      v.literal("telemetry"),
      v.literal("tools"),
    ),
    author_id: v.string(),
    verified_publisher: v.boolean(),
    repo_url: v.optional(v.string()),
    homepage_url: v.optional(v.string()),
    license: v.string(),
    total_installs: v.number(),
    created_at: v.number(),
    updated_at: v.number(),
    latest_version: v.string(),
    status: v.union(
      v.literal("draft"),
      v.literal("published"),
      v.literal("deprecated"),
      v.literal("removed"),
    ),
    icon_url: v.optional(v.string()),
    screenshot_urls: v.optional(v.array(v.string())),
    tier: v.optional(v.union(
      v.literal("first_party"),
      v.literal("verified"),
      v.literal("community"),
    )),
  })
    .index("by_plugin_id", ["plugin_id"])
    .index("by_category", ["category", "status"])
    .index("by_author", ["author_id"]),

  registry_versions: defineTable({
    plugin_id: v.string(),
    version: v.string(),
    manifest_yaml: v.string(),
    download_url: v.string(),
    signer_key_id: v.string(),
    signature: v.string(),
    payload_hash: v.string(),
    archive_size_bytes: v.number(),
    archive_sha256: v.string(),
    agent_min_version: v.string(),
    agent_max_version: v.optional(v.string()),
    gcs_min_version: v.optional(v.string()),
    released_at: v.number(),
    static_analysis_score: v.number(),
    static_analysis_report_json: v.string(),
    download_count: v.number(),
    supported_boards: v.optional(v.array(v.string())),
    release_notes_md: v.optional(v.string()),
    contains_vendor_binary: v.optional(v.boolean()),
    vendor_attribution: v.optional(v.array(v.object({
      name: v.string(),
      license: v.string(),
      source_url: v.string(),
      notice: v.optional(v.string()),
    }))),
  })
    .index("by_plugin_version", ["plugin_id", "version"])
    .index("by_plugin_released", ["plugin_id", "released_at"]),

  registry_submissions: defineTable({
    submission_id: v.string(),
    plugin_id: v.string(),
    version: v.string(),
    submitter_user_id: v.string(),
    archive_storage_id: v.id("_storage"),
    status: v.union(
      v.literal("pending"),
      v.literal("auto_approved"),
      v.literal("queued_for_review"),
      v.literal("approved"),
      v.literal("rejected"),
    ),
    static_analysis_score: v.number(),
    static_analysis_findings_json: v.string(),
    submitted_at: v.number(),
    reviewed_at: v.optional(v.number()),
    reviewer_user_id: v.optional(v.string()),
    review_notes: v.optional(v.string()),
  })
    .index("by_status_submitted", ["status", "submitted_at"])
    .index("by_plugin", ["plugin_id"])
    .index("by_submitter", ["submitter_user_id", "submitted_at"]),

  registry_revocations: defineTable({
    revocation_id: v.string(),
    kind: v.union(
      v.literal("signer_key"),
      v.literal("plugin_version"),
    ),
    target: v.string(),
    reason: v.string(),
    revoked_at: v.number(),
    revoked_by_user_id: v.string(),
  })
    .index("by_kind", ["kind", "revoked_at"]),

  // First-party parameter-metadata registry: version-matched firmware snapshots
  // (gzipped {provenance,params}, base64-encoded inline). Public read; admin
  // (internal) write. Generic technical reference data, present in both convex
  // dirs. Overlays the bundled offline floor in the GCS.
  param_registry: defineTable({
    firmware: v.string(),
    version: v.string(),
    param_count: v.number(),
    gz_b64: v.string(),
    updated_at: v.number(),
  })
    .index("by_firmware", ["firmware"])
    .index("by_firmware_version", ["firmware", "version"]),
});
