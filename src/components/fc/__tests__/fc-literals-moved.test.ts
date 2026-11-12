/**
 * @license GPL-3.0-only
 *
 * Configure panels read in the operator's language: the English sentences
 * these panels used to hard-code now come from locale keys, and every key
 * they use is translated in German.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

import en from "../../../../locales/en.json";
import de from "../../../../locales/de.json";

const FC = join(__dirname, "..");

const REMOVED: Record<string, string[]> = {
  "frame/FramePanel.tsx": ["Unrecognised (on this vehicle)", "This vehicle reports", "No motor layout", "will still be sent"],
  "inav/FwApproachPanel.tsx": [">unsaved<", "Relative to home", "\"Saving...\""],
  "inav/INavMissionPanel.tsx": ["iNav supports eight waypoint action types"],
  "inav/programming/LcProgrammingPanel.tsx": ["compiles to Logic Conditions"],
  "misc/LedPanel.tsx": ["Show current LED strip configuration", "command in the FC Console panel"],
  "motors/BfMotorTest.tsx": ["REMOVE ALL PROPELLERS"],
  "px4/Px4ActuatorTest.tsx": ["REMOVE ALL PROPELLERS", "The selected motor spins"],
  "motors/OutputsPanel.tsx": [">UNSAVED<"],
  "osd/DisplayPortOsdPanel.tsx": ["no OSD frames yet"],
  "osd/OsdScreenPreview.tsx": ["OSD PREVIEW"],
  "osd/OsdElementGrid.tsx": ["\"Saving...\"", "\"Save to FC\""],
  "security/signing/InboundSigningSection.tsx": ["Require signed telemetry"],
  "security/ExportKeyModal.tsx": ["to continue."],
  "streams/StreamRatesPanel.tsx": [">not present<"],
  "comms/TelRadioPanel.tsx": ["No live radio telemetry", "\"Vehicle System ID\""],
  "flight-modes/FlightModesHeader.tsx": [" unsaved\n"],
  "frame/ActuatorPanel.tsx": ["\"Saving...\""],
  "firmware/FirmwarePanel.tsx": ["Flash firmware via USB DFU"],
  "firmware/FirmwareBackupRestore.tsx": ["\"Flash Firmware\"", "Downloading parameters"],
  "pid/PidTuningPanel.tsx": ["\"ArduCopter rate PIDs"],
};

const KEYS = [
  "fcPanels.framePanel.typeUnknownNote",
  "fcPanels.fwApproachPanel.relativeToHome",
  "fcPanels.iNavMissionPanel.waypointActionsBody",
  "fcPanels.ledPanel.useLedCommand",
  "fcPanels.bfMotorTest.removePropellers",
  "fcPanels.px4ActuatorTest.testExplain",
  "fcPanels.inboundSigningSection.requireSignedBody",
  "fcPanels.exportKeyModal.typeToContinue",
  "fcPanels.telRadioPanel.noRadioTelemetry",
  "fcPanels.firmwarePanel.subtitle",
  "fcPanels.firmwareBackupRestore.flashFirmware",
  "fcPanels.pidTuningPanel.subtitleCopterPx4",
];

function lookup(table: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], table);
}

describe("components/fc literals", () => {
  it.each(Object.entries(REMOVED))("%s carries no moved English literal", (file, literals) => {
    const src = readFileSync(join(FC, file), "utf8");
    for (const literal of literals) expect(src).not.toContain(literal);
  });

  it("each new key exists and is translated in German", () => {
    for (const key of KEYS) {
      expect(typeof lookup(en, key)).toBe("string");
      expect(lookup(de, key)).not.toBe(lookup(en, key));
    }
  });
});
