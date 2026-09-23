/**
 * @module protocol/fc-firmware-label
 * @description Map the agent-reported FC firmware identity to a human display
 * name. The agent surfaces two related fields: `fc_firmware` (the canonical
 * family, which distinguishes the two MAVLink stacks ArduPilot vs PX4) and the
 * older `fc_variant` (only ever "betaflight" / "inav" for an MSP FC). Prefer
 * `fc_firmware`; fall back to `fc_variant` so an older agent still names its
 * MSP FC. Returns `undefined` when neither identifies a family, so callers can
 * omit the label rather than render "Unknown".
 * @license GPL-3.0-only
 */

/**
 * Human-readable firmware name from the agent's FC identity fields.
 *
 * @param fcFirmware canonical family ("ardupilot" | "px4" | "betaflight" |
 *   "inav" | "unknown"); ArduPilot handlers may report the vehicle-suffixed
 *   form ("ardupilot-copter" etc.), which is normalised to "ArduPilot".
 * @param fcVariant legacy MSP variant ("betaflight" | "inav"), used only when
 *   `fcFirmware` is absent/unknown.
 * @returns the display name, or `undefined` when the family is not identified.
 */
export function fcFirmwareLabel(
  fcFirmware: string | null | undefined,
  fcVariant?: string | null | undefined,
): string | undefined {
  const raw = (fcFirmware ?? "").trim().toLowerCase();
  const primary = firmwareTokenToLabel(raw);
  if (primary) return primary;
  // fcFirmware absent or "unknown": fall back to the MSP-only variant field.
  return firmwareTokenToLabel((fcVariant ?? "").trim().toLowerCase());
}

/**
 * The firmware · airframe flavor a node surface shows for an FC ("ArduPilot ·
 * VTOL", "PX4", "Betaflight"), or `undefined` when the family is not
 * identified.
 */
export function fcFlavorLabel(
  fcFirmware: string | null | undefined,
  fcVariant: string | null | undefined,
  frameType: string | null | undefined,
): string | undefined {
  const name = fcFirmwareLabel(fcFirmware, fcVariant);
  if (!name) return undefined;
  return frameType ? `${name} · ${frameType}` : name;
}

function firmwareTokenToLabel(token: string): string | undefined {
  if (token.startsWith("ardupilot")) return "ArduPilot";
  switch (token) {
    case "px4":
      return "PX4";
    case "betaflight":
      return "Betaflight";
    case "inav":
      return "iNav";
    default:
      return undefined;
  }
}
