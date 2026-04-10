/**
 * @module FeatureCatalog
 * @description Static registry of all known ADOS features (smart modes, suites, utilities).
 * The GCS intersects this catalog with agent-reported capabilities to determine
 * what the user can enable, configure, and activate.
 * @license GPL-3.0-only
 */

import type { FeatureDef } from "./feature-types";

export const FEATURE_CATALOG: Record<string, FeatureDef> = {
  // ── Smart Modes: Tracking ────────────────────────────────

  "follow-me": {
    id: "follow-me",
    type: "smart-mode",
    name: "Follow Me",
    description: "Drone autonomously follows a designated target using visual tracking",
    icon: "UserRound",
    category: "tracking",
    tierRequired: 3,
    sensorsRequired: [
      { type: "camera", label: "Camera", required: true },
      { type: "npu", label: "NPU", required: true },
      { type: "gps", label: "GPS", required: true },
      { type: "imu", label: "IMU", required: true },
    ],
    servicesRequired: ["video-pipeline", "mavlink-proxy"],
    visionBehavior: "follow_target",
    requiresNpu: true,
    requiredModels: [
      { modelId: "person_v1", required: true, purpose: "Target detection" },
    ],
    configSchema: [
      { key: "follow_distance", label: "Follow Distance", type: "slider", default: 10, min: 3, max: 30, step: 1, unit: "m" },
      { key: "follow_altitude", label: "Altitude", type: "slider", default: 15, min: 5, max: 50, step: 1, unit: "m" },
      { key: "max_speed", label: "Max Speed", type: "slider", default: 8, min: 1, max: 15, step: 0.5, unit: "m/s" },
      { key: "loss_action", label: "On Target Lost", type: "select", default: "hover", options: [
        { value: "hover", label: "Hover and wait" },
        { value: "rtl", label: "Return to launch" },
        { value: "land", label: "Land in place" },
      ]},
      { key: "obstacle_mode", label: "Obstacle Avoidance", type: "select", default: "brake", options: [
        { value: "off", label: "Off" },
        { value: "brake", label: "Brake (stop on obstacle)" },
        { value: "detour", label: "Detour (fly around)" },
      ]},
    ],
  },

  "active-track": {
    id: "active-track",
    type: "smart-mode",
    name: "ActiveTrack",
    description: "Multi-target aware tracking with automatic re-acquisition after occlusion",
    icon: "Crosshair",
    category: "tracking",
    tierRequired: 3,
    sensorsRequired: [
      { type: "camera", label: "Camera", required: true },
      { type: "npu", label: "NPU", required: true },
      { type: "gps", label: "GPS", required: true },
    ],
    servicesRequired: ["video-pipeline", "mavlink-proxy"],
    visionBehavior: "active_track",
    requiresNpu: true,
    requiredModels: [
      { modelId: "person_v1", required: true, purpose: "Target detection" },
      { modelId: "vehicle_v1", required: false, purpose: "Vehicle tracking" },
    ],
    configSchema: [
      { key: "max_targets", label: "Max Tracked Targets", type: "slider", default: 4, min: 1, max: 10, step: 1 },
      { key: "follow_distance", label: "Follow Distance", type: "slider", default: 10, min: 3, max: 30, step: 1, unit: "m" },
      { key: "follow_altitude", label: "Altitude", type: "slider", default: 15, min: 5, max: 50, step: 1, unit: "m" },
    ],
  },

  // ── Smart Modes: Cinematography ──────────────────────────

  orbit: {
    id: "orbit",
    type: "smart-mode",
    name: "Orbit",
    description: "Circle a point of interest at a configurable radius, speed, and altitude",
    icon: "CircleDot",
    category: "cinematography",
    tierRequired: 3,
    sensorsRequired: [
      { type: "camera", label: "Camera", required: true },
      { type: "npu", label: "NPU", required: false },
      { type: "gps", label: "GPS", required: true },
    ],
    servicesRequired: ["mavlink-proxy"],
    visionBehavior: "orbit_poi",
    configSchema: [
      { key: "radius", label: "Orbit Radius", type: "slider", default: 15, min: 5, max: 100, step: 1, unit: "m" },
      { key: "speed", label: "Orbit Speed", type: "slider", default: 3, min: 0.5, max: 8, step: 0.5, unit: "m/s" },
      { key: "altitude", label: "Altitude", type: "slider", default: 20, min: 5, max: 100, step: 1, unit: "m" },
      { key: "direction", label: "Direction", type: "select", default: "cw", options: [
        { value: "cw", label: "Clockwise" },
        { value: "ccw", label: "Counter-clockwise" },
      ]},
    ],
  },

  "quickshot-dronie": {
    id: "quickshot-dronie",
    type: "smart-mode",
    name: "Dronie",
    description: "Fly backward and upward from the target for a dramatic reveal shot",
    icon: "MoveUpRight",
    category: "cinematography",
    tierRequired: 3,
    sensorsRequired: [
      { type: "camera", label: "Camera", required: true },
      { type: "npu", label: "NPU", required: true },
      { type: "gps", label: "GPS", required: true },
    ],
    servicesRequired: ["video-pipeline", "mavlink-proxy"],
    visionBehavior: "quickshot_dronie",
    requiresNpu: true,
    requiredModels: [
      { modelId: "person_v1", required: true, purpose: "Subject tracking" },
    ],
    configSchema: [
      { key: "distance", label: "Flight Distance", type: "slider", default: 30, min: 10, max: 60, step: 5, unit: "m" },
      { key: "max_altitude", label: "Max Altitude", type: "slider", default: 30, min: 10, max: 60, step: 5, unit: "m" },
      { key: "speed", label: "Speed", type: "slider", default: 4, min: 1, max: 8, step: 0.5, unit: "m/s" },
    ],
  },

  "quickshot-rocket": {
    id: "quickshot-rocket",
    type: "smart-mode",
    name: "Rocket",
    description: "Fly straight up while the camera points down at the subject",
    icon: "ArrowUp",
    category: "cinematography",
    tierRequired: 3,
    sensorsRequired: [
      { type: "camera", label: "Camera", required: true },
      { type: "npu", label: "NPU", required: true },
      { type: "gps", label: "GPS", required: true },
    ],
    servicesRequired: ["video-pipeline", "mavlink-proxy"],
    visionBehavior: "quickshot_rocket",
    requiresNpu: true,
    requiredModels: [
      { modelId: "person_v1", required: true, purpose: "Subject tracking" },
    ],
    configSchema: [
      { key: "max_altitude", label: "Max Altitude", type: "slider", default: 40, min: 10, max: 80, step: 5, unit: "m" },
      { key: "speed", label: "Ascent Speed", type: "slider", default: 3, min: 1, max: 6, step: 0.5, unit: "m/s" },
    ],
  },

  "quickshot-circle": {
    id: "quickshot-circle",
    type: "smart-mode",
    name: "Circle Shot",
    description: "Complete a 360-degree orbit around the subject while filming",
    icon: "RotateCw",
    category: "cinematography",
    tierRequired: 3,
    sensorsRequired: [
      { type: "camera", label: "Camera", required: true },
      { type: "npu", label: "NPU", required: true },
      { type: "gps", label: "GPS", required: true },
    ],
    servicesRequired: ["video-pipeline", "mavlink-proxy"],
    visionBehavior: "quickshot_circle",
    requiresNpu: true,
    requiredModels: [
      { modelId: "person_v1", required: true, purpose: "Subject tracking" },
    ],
    configSchema: [
      { key: "radius", label: "Circle Radius", type: "slider", default: 10, min: 5, max: 30, step: 1, unit: "m" },
      { key: "speed", label: "Speed", type: "slider", default: 2, min: 0.5, max: 5, step: 0.5, unit: "m/s" },
    ],
  },

  "quickshot-helix": {
    id: "quickshot-helix",
    type: "smart-mode",
    name: "Helix",
    description: "Spiral upward around the subject while filming from above",
    icon: "Orbit",
    category: "cinematography",
    tierRequired: 3,
    sensorsRequired: [
      { type: "camera", label: "Camera", required: true },
      { type: "npu", label: "NPU", required: true },
      { type: "gps", label: "GPS", required: true },
    ],
    servicesRequired: ["video-pipeline", "mavlink-proxy"],
    visionBehavior: "quickshot_helix",
    requiresNpu: true,
    requiredModels: [
      { modelId: "person_v1", required: true, purpose: "Subject tracking" },
    ],
    configSchema: [
      { key: "radius", label: "Helix Radius", type: "slider", default: 10, min: 5, max: 30, step: 1, unit: "m" },
      { key: "max_altitude", label: "Max Altitude", type: "slider", default: 30, min: 10, max: 60, step: 5, unit: "m" },
      { key: "speed", label: "Speed", type: "slider", default: 2, min: 0.5, max: 5, step: 0.5, unit: "m/s" },
    ],
  },

  "quickshot-boomerang": {
    id: "quickshot-boomerang",
    type: "smart-mode",
    name: "Boomerang",
    description: "Arc away from the subject and return in a smooth boomerang path",
    icon: "Undo2",
    category: "cinematography",
    tierRequired: 3,
    sensorsRequired: [
      { type: "camera", label: "Camera", required: true },
      { type: "npu", label: "NPU", required: true },
      { type: "gps", label: "GPS", required: true },
    ],
    servicesRequired: ["video-pipeline", "mavlink-proxy"],
    visionBehavior: "quickshot_boomerang",
    requiresNpu: true,
    requiredModels: [
      { modelId: "person_v1", required: true, purpose: "Subject tracking" },
    ],
    configSchema: [
      { key: "distance", label: "Arc Distance", type: "slider", default: 30, min: 10, max: 60, step: 5, unit: "m" },
      { key: "speed", label: "Speed", type: "slider", default: 4, min: 1, max: 8, step: 0.5, unit: "m/s" },
    ],
  },

  // ── Smart Modes: Safety ──────────────────────────────────

  "obstacle-avoidance": {
    id: "obstacle-avoidance",
    type: "smart-mode",
    name: "Obstacle Avoidance",
    description: "Automatic obstacle detection with brake or detour maneuvers",
    icon: "ShieldAlert",
    category: "safety",
    tierRequired: 3,
    sensorsRequired: [
      { type: "camera", label: "Camera", required: true },
      { type: "npu", label: "NPU", required: true },
    ],
    servicesRequired: ["video-pipeline"],
    visionBehavior: "obstacle_avoidance",
    requiresNpu: true,
    requiredModels: [
      { modelId: "depth_midas_v3", required: true, purpose: "Depth estimation" },
    ],
    configSchema: [
      { key: "mode", label: "Avoidance Mode", type: "select", default: "brake", options: [
        { value: "brake", label: "Brake (stop on obstacle)" },
        { value: "detour", label: "Detour (fly around)" },
      ]},
      { key: "min_distance", label: "Minimum Distance", type: "slider", default: 3, min: 1, max: 10, step: 0.5, unit: "m" },
      { key: "sensitivity", label: "Sensitivity", type: "select", default: "normal", options: [
        { value: "low", label: "Low (fewer false positives)" },
        { value: "normal", label: "Normal" },
        { value: "high", label: "High (more cautious)" },
      ]},
    ],
  },

  "precision-landing": {
    id: "precision-landing",
    type: "smart-mode",
    name: "Precision Landing",
    description: "Land accurately on an ArUco marker or landing pad using visual guidance",
    icon: "Target",
    category: "safety",
    tierRequired: 3,
    sensorsRequired: [
      { type: "camera", label: "Camera", required: true },
      { type: "npu", label: "NPU", required: true },
      { type: "gps", label: "GPS", required: true },
    ],
    servicesRequired: ["video-pipeline", "mavlink-proxy"],
    visionBehavior: "precision_landing",
    requiresNpu: true,
    requiredModels: [
      { modelId: "landing_pad_v1", required: true, purpose: "Landing pad detection" },
    ],
    configSchema: [
      { key: "marker_type", label: "Marker Type", type: "select", default: "apriltag", options: [
        { value: "apriltag", label: "AprilTag" },
        { value: "h_marker", label: "H-Marker" },
        { value: "circle", label: "Circle pad" },
      ]},
      { key: "approach_altitude", label: "Approach Altitude", type: "slider", default: 10, min: 3, max: 30, step: 1, unit: "m" },
      { key: "descent_speed", label: "Descent Speed", type: "slider", default: 0.5, min: 0.2, max: 1.5, step: 0.1, unit: "m/s" },
    ],
  },

  "terrain-following": {
    id: "terrain-following",
    type: "smart-mode",
    name: "Terrain Following",
    description: "Maintain constant altitude above ground using downward camera and rangefinder",
    icon: "Mountain",
    category: "safety",
    tierRequired: 3,
    sensorsRequired: [
      { type: "camera", label: "Camera", required: true },
      { type: "rangefinder", label: "Rangefinder", required: false },
      { type: "gps", label: "GPS", required: true },
    ],
    servicesRequired: ["mavlink-proxy"],
    visionBehavior: "terrain_following",
    configSchema: [
      { key: "target_agl", label: "Target AGL", type: "slider", default: 10, min: 2, max: 50, step: 1, unit: "m" },
      { key: "max_climb_rate", label: "Max Climb Rate", type: "slider", default: 2, min: 0.5, max: 5, step: 0.5, unit: "m/s" },
      { key: "max_descent_rate", label: "Max Descent Rate", type: "slider", default: 1, min: 0.5, max: 3, step: 0.5, unit: "m/s" },
    ],
  },

  // ── Smart Modes: Utility ─────────────────────────────────

  "gesture-recognition": {
    id: "gesture-recognition",
    type: "utility",
    name: "Gesture Control",
    description: "Control the drone with hand gestures detected by the camera",
    icon: "Hand",
    category: "utility",
    tierRequired: 3,
    sensorsRequired: [
      { type: "camera", label: "Camera", required: true },
      { type: "npu", label: "NPU", required: true },
    ],
    servicesRequired: ["video-pipeline", "mavlink-proxy"],
    visionBehavior: "gesture_recognition",
    requiresNpu: true,
    requiredModels: [
      { modelId: "gesture_v1", required: true, purpose: "Gesture detection" },
    ],
    configSchema: [
      { key: "gesture_sensitivity", label: "Sensitivity", type: "slider", default: 0.7, min: 0.3, max: 0.95, step: 0.05 },
    ],
  },

  panorama: {
    id: "panorama",
    type: "utility",
    name: "Panorama",
    description: "Capture a 360-degree panorama or wide-angle composite automatically",
    icon: "Maximize2",
    category: "utility",
    tierRequired: 2,
    sensorsRequired: [
      { type: "camera", label: "Camera", required: true },
      { type: "gps", label: "GPS", required: true },
    ],
    servicesRequired: ["video-pipeline", "mavlink-proxy"],
    visionBehavior: "panorama_capture",
    configSchema: [
      { key: "pano_type", label: "Panorama Type", type: "select", default: "sphere", options: [
        { value: "sphere", label: "Full sphere (360 x 180)" },
        { value: "wide", label: "Wide angle (180)" },
        { value: "vertical", label: "Vertical (top to bottom)" },
      ]},
    ],
  },

  // ── Suites ───────────────────────────────────────────────

  "suite-sentry": {
    id: "suite-sentry",
    type: "suite",
    name: "Sentry Suite",
    description: "Patrol and surveillance with perimeter monitoring and intrusion detection",
    icon: "Shield",
    category: "mission",
    tierRequired: 3,
    sensorsRequired: [
      { type: "camera", label: "Camera", required: true },
      { type: "npu", label: "NPU", required: true },
      { type: "gps", label: "GPS", required: true },
      { type: "imu", label: "IMU", required: true },
    ],
    servicesRequired: ["video-pipeline", "mavlink-proxy"],
    suiteId: "sentry",
    requiresNpu: true,
    requiredModels: [
      { modelId: "person_v1", required: true, purpose: "Person detection" },
      { modelId: "vehicle_v1", required: false, purpose: "Vehicle detection" },
    ],
    configSchema: [
      { key: "patrol_speed", label: "Patrol Speed", type: "slider", default: 4, min: 1, max: 10, step: 0.5, unit: "m/s" },
      { key: "patrol_altitude", label: "Patrol Altitude", type: "slider", default: 30, min: 10, max: 80, step: 5, unit: "m" },
      { key: "detection_sensitivity", label: "Detection Sensitivity", type: "slider", default: 0.5, min: 0.2, max: 0.9, step: 0.05 },
    ],
  },

  "suite-survey": {
    id: "suite-survey",
    type: "suite",
    name: "Survey Suite",
    description: "Aerial mapping, photogrammetry, and 3D reconstruction capture",
    icon: "Map",
    category: "mission",
    tierRequired: 2,
    sensorsRequired: [
      { type: "camera", label: "Camera", required: true },
      { type: "gps", label: "GPS", required: true },
      { type: "imu", label: "IMU", required: true },
    ],
    servicesRequired: ["video-pipeline", "mavlink-proxy"],
    suiteId: "survey",
    configSchema: [
      { key: "overlap_pct", label: "Forward Overlap", type: "slider", default: 75, min: 50, max: 90, step: 5, unit: "%" },
      { key: "sidelap_pct", label: "Side Overlap", type: "slider", default: 65, min: 40, max: 85, step: 5, unit: "%" },
      { key: "target_gsd", label: "Target GSD", type: "slider", default: 3, min: 1, max: 10, step: 0.5, unit: "cm/px" },
    ],
  },

  "suite-agriculture": {
    id: "suite-agriculture",
    type: "suite",
    name: "Agriculture Suite",
    description: "Crop health monitoring, precision spray control, and field analytics",
    icon: "Sprout",
    category: "mission",
    tierRequired: 3,
    sensorsRequired: [
      { type: "camera", label: "Camera", required: true },
      { type: "npu", label: "NPU", required: true },
      { type: "gps", label: "GPS", required: true },
    ],
    servicesRequired: ["video-pipeline", "mavlink-proxy"],
    suiteId: "agriculture",
    requiresNpu: true,
    requiredModels: [
      { modelId: "crop_health_v1", required: true, purpose: "Crop health detection" },
    ],
    configSchema: [
      { key: "spray_rate", label: "Spray Rate", type: "slider", default: 2, min: 0.5, max: 5, step: 0.5, unit: "L/min" },
      { key: "row_width", label: "Row Width", type: "slider", default: 3, min: 1, max: 10, step: 0.5, unit: "m" },
      { key: "flight_altitude", label: "Flight Altitude", type: "slider", default: 5, min: 2, max: 15, step: 1, unit: "m" },
    ],
  },

  "suite-cargo": {
    id: "suite-cargo",
    type: "suite",
    name: "Cargo Suite",
    description: "Autonomous delivery with precision landing and route optimization",
    icon: "PackageCheck",
    category: "mission",
    tierRequired: 3,
    sensorsRequired: [
      { type: "camera", label: "Camera", required: true },
      { type: "npu", label: "NPU", required: true },
      { type: "gps", label: "GPS", required: true },
      { type: "rangefinder", label: "Rangefinder", required: false },
    ],
    servicesRequired: ["video-pipeline", "mavlink-proxy"],
    suiteId: "cargo",
    requiresNpu: true,
    requiredModels: [
      { modelId: "landing_pad_v1", required: true, purpose: "Drop zone detection" },
    ],
    configSchema: [
      { key: "approach_altitude", label: "Approach Altitude", type: "slider", default: 15, min: 5, max: 30, step: 1, unit: "m" },
      { key: "descent_speed", label: "Descent Speed", type: "slider", default: 0.5, min: 0.2, max: 1.5, step: 0.1, unit: "m/s" },
    ],
  },

  "suite-sar": {
    id: "suite-sar",
    type: "suite",
    name: "SAR Suite",
    description: "Search and rescue with thermal detection and systematic search patterns",
    icon: "LifeBuoy",
    category: "mission",
    tierRequired: 3,
    sensorsRequired: [
      { type: "camera", label: "Camera", required: true },
      { type: "npu", label: "NPU", required: true },
      { type: "gps", label: "GPS", required: true },
      { type: "thermal", label: "Thermal Camera", required: false },
    ],
    servicesRequired: ["video-pipeline", "mavlink-proxy"],
    suiteId: "sar",
    requiresNpu: true,
    requiredModels: [
      { modelId: "person_v1", required: true, purpose: "Person detection (RGB)" },
      { modelId: "thermal_person_v1", required: false, purpose: "Person detection (thermal)" },
    ],
    configSchema: [
      { key: "search_altitude", label: "Search Altitude", type: "slider", default: 30, min: 10, max: 80, step: 5, unit: "m" },
      { key: "search_speed", label: "Search Speed", type: "slider", default: 5, min: 2, max: 12, step: 0.5, unit: "m/s" },
      { key: "detection_sensitivity", label: "Detection Sensitivity", type: "slider", default: 0.4, min: 0.2, max: 0.8, step: 0.05 },
    ],
  },

  "suite-inspection": {
    id: "suite-inspection",
    type: "suite",
    name: "Inspection Suite",
    description: "Close-range structural assessment with thermal and defect detection",
    icon: "Search",
    category: "mission",
    tierRequired: 3,
    sensorsRequired: [
      { type: "camera", label: "Camera", required: true },
      { type: "npu", label: "NPU", required: true },
      { type: "gps", label: "GPS", required: true },
    ],
    servicesRequired: ["video-pipeline", "mavlink-proxy"],
    suiteId: "inspection",
    requiresNpu: true,
    requiredModels: [
      { modelId: "defect_v1", required: true, purpose: "Defect detection (cracks, corrosion)" },
    ],
    configSchema: [
      { key: "inspection_distance", label: "Inspection Distance", type: "slider", default: 3, min: 1, max: 10, step: 0.5, unit: "m" },
      { key: "flight_speed", label: "Flight Speed", type: "slider", default: 1, min: 0.3, max: 3, step: 0.1, unit: "m/s" },
    ],
  },
};

/** Get all features of a specific type. */
export function getFeaturesByType(type: FeatureDef["type"]): FeatureDef[] {
  return Object.values(FEATURE_CATALOG).filter((f) => f.type === type);
}

/** Get all features of a specific category. */
export function getFeaturesByCategory(category: FeatureDef["category"]): FeatureDef[] {
  return Object.values(FEATURE_CATALOG).filter((f) => f.category === category);
}

/** Get the list of unique model IDs required by a set of features. */
export function getRequiredModels(featureIds: string[]): string[] {
  const models = new Set<string>();
  for (const id of featureIds) {
    const feat = FEATURE_CATALOG[id];
    if (feat?.requiredModels) {
      for (const m of feat.requiredModels) {
        if (m.required) models.add(m.modelId);
      }
    }
  }
  return Array.from(models);
}
