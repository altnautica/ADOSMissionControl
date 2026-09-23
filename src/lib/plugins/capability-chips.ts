/**
 * @module CapabilityChips
 * @description Derives human-readable hardware-capability chips
 *   (Camera / NPU / IMU / Thermal / LIDAR) from what a plugin manifest
 *   explicitly declares: hardware-binding permissions, sensor
 *   registrations, inference permissions, the `hardware_requirements`
 *   block and the declared telemetry fields. Used by the plugin install
 *   dialog so operators can see at a glance what hardware a plugin needs.
 *   A chip is shown only on an explicit declaration, never inferred from a
 *   generic permission such as raw USB access or telemetry reads.
 *
 * @license GPL-3.0-only
 */

/**
 * Stable chip identifiers. Render order in the UI follows array order:
 * Camera, NPU, IMU, Thermal, LIDAR. Extending this list is a
 * cross-stack change: the agent-side capability catalog must declare
 * the matching permission first.
 */
export type CapabilityChipId = "camera" | "npu" | "imu" | "thermal" | "lidar";

export interface CapabilityChip {
  id: CapabilityChipId;
  label: string;
}

const ALL_CHIPS: Readonly<Record<CapabilityChipId, CapabilityChip>> = {
  camera: { id: "camera", label: "Camera" },
  npu: { id: "npu", label: "NPU" },
  imu: { id: "imu", label: "IMU" },
  thermal: { id: "thermal", label: "Thermal" },
  lidar: { id: "lidar", label: "LIDAR" },
};

// Render order. Independent of the input permission list so a plugin
// declaring permissions in any order still gets a consistent UI.
const RENDER_ORDER: readonly CapabilityChipId[] = [
  "camera",
  "npu",
  "imu",
  "thermal",
  "lidar",
];

/** Manifest declarations beyond the permission list that name hardware. */
export interface ChipDerivationContext {
  /** Declared vendor-binary attribution entries. An entry whose `name`
   * names a known NPU runtime (rknn, tensorrt, snpe, openvino) marks a
   * plugin that spawns an NPU inference helper. */
  vendorAttribution?: ReadonlyArray<{ name?: string }>;
  /** The manifest's `hardware_requirements` block. A non-empty `cameras`
   * entry is an explicit camera requirement. */
  hardwareRequirements?: { cameras?: string };
  /** The manifest's `telemetry_fields`. A `thermal` field means the plugin
   * publishes a thermal-sensor stream, so it needs a thermal camera. */
  telemetryFields?: ReadonlyArray<string>;
}

/** Permissions that bind or register a camera. */
const CAMERA_PERMISSIONS: readonly string[] = [
  "hardware.camera.csi",
  "hardware.usb.uvc",
  "sensor.camera.register",
  "mavlink.component.camera",
  "vision.frame.read",
];

/** Permissions that load a model onto, or stream through, the NPU. */
const NPU_PERMISSIONS: readonly string[] = [
  "vision.model.register",
  "compute.stream.open",
];

/** Lower-cased substrings that, when present in a vendor-attribution
 * name, mean the plugin is bundling an NPU runtime. Keep this list
 * tight: false positives surface a misleading NPU chip on plugins
 * that ship a non-NPU vendor binary. */
const NPU_VENDOR_HINTS: readonly string[] = [
  "rknn",
  "tensorrt",
  "snpe",
  "openvino",
];

/**
 * Resolve the chip set for a plugin's declared permissions. The
 * input array is the wire-shape `permissions` block from the manifest:
 * each entry is the canonical capability id (e.g. "hardware.usb.uvc").
 *
 * Returns chips in `RENDER_ORDER`. Unknown permission strings are
 * ignored: the install dialog still lists them in the raw permission
 * table.
 */
export function permissionsToChips(
  permissions: readonly string[],
  context: ChipDerivationContext = {},
): CapabilityChip[] {
  const declared = new Set(permissions);
  const found = new Set<CapabilityChipId>();

  if (
    CAMERA_PERMISSIONS.some((p) => declared.has(p)) ||
    (context.hardwareRequirements?.cameras ?? "").trim() !== ""
  ) {
    found.add("camera");
  }

  // `process.spawn` alone is not enough: a plugin can spawn a
  // non-inference helper. The NPU vendor attribution is the load-bearing
  // signal on that path.
  if (
    NPU_PERMISSIONS.some((p) => declared.has(p)) ||
    (declared.has("process.spawn") &&
      context.vendorAttribution?.some((entry) => {
        const lower = (entry.name ?? "").toLowerCase();
        return NPU_VENDOR_HINTS.some((hint) => lower.includes(hint));
      }))
  ) {
    found.add("npu");
  }

  if (declared.has("sensor.imu.register")) {
    found.add("imu");
  }

  if (context.telemetryFields?.includes("thermal")) {
    found.add("thermal");
  }

  if (declared.has("sensor.lidar.register")) {
    found.add("lidar");
  }

  return RENDER_ORDER.filter((id) => found.has(id)).map((id) => ALL_CHIPS[id]);
}
