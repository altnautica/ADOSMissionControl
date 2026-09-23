// Exempt from 300 LOC soft rule: pure data table of frame layouts keyed by FRAME_CLASS/FRAME_TYPE
/**
 * Frame class/type → motor position/rotation data for ArduPilot.
 *
 * Each motor stores ArduPilot's roll and pitch mixer factors. Use
 * `motorBodyPosition` to turn them into a body-frame position; the factors
 * themselves are not screen coordinates.
 *
 * @license GPL-3.0-only
 */

// ── Types ─────────────────────────────────────────────────────

export interface MotorPosition {
  number: number;
  testOrder: number;
  rotation: "CW" | "CCW" | "?";
  /**
   * ArduPilot roll mixer factor, cos(angle + 90°) for a motor at `angle`
   * clockwise from the nose. Negative for motors on the right side.
   */
  roll: number;
  /** ArduPilot pitch mixer factor, cos(angle). Positive for motors ahead of centre. */
  pitch: number;
  /** True for yaw servos (e.g., Tri motor 7). Not counted as a motor. */
  isServo?: boolean;
}

export interface FrameLayout {
  frameClass: number;
  className: string;
  frameType: number;
  typeName: string;
  motors: MotorPosition[];
}

// ── Frame Class Names ─────────────────────────────────────────

export const FRAME_CLASS_NAMES: Record<number, string> = {
  0: "Undefined",
  1: "Quad",
  2: "Hexa",
  3: "Octa",
  4: "OctaQuad",
  5: "Y6",
  6: "Heli (Single)",
  7: "Tri",
  8: "SingleCopter",
  9: "CoaxCopter",
  10: "BiCopter",
  11: "Heli (Dual)",
  12: "DodecaHexa",
  13: "HeliQuad",
  14: "Deca",
};

export const FRAME_TYPE_NAMES: Record<number, string> = {
  0: "Plus",
  1: "X",
  2: "V",
  3: "H",
  4: "VTail",
  5: "ATail",
  6: "PlusRev",
  10: "Y6B",
  11: "Y6F",
  12: "BetaFlightX",
  13: "DJI X",
  14: "ClockwiseX",
  15: "I",
  16: "NYT Plus",
  17: "NYT X",
  18: "X Reversed",
};

// ── Frame Type Descriptions ───────────────────────────────────

export const FRAME_TYPE_DESCRIPTIONS: Record<number, string> = {
  0: "Motors at 0/90/180/270 degrees. Simple, symmetric.",
  1: "Motors at 45/135/225/315 degrees. Most common FPV layout. Camera has clear forward view.",
  2: "Front motors angled wider. Better forward visibility.",
  3: "Wide stance. More stable in wind, wider footprint.",
  4: "Rear motors angled inward (V shape). Mixed pitch/yaw on rear motors.",
  5: "Rear motors angled outward (A shape). Opposite of VTail.",
  6: "Plus layout with reversed motor directions.",
  10: "Y6 with bottom motors reversed.",
  11: "Y6 with front-heavy bias.",
  12: "Betaflight motor numbering. Same positions as X, different motor order.",
  13: "DJI motor numbering convention.",
  14: "X layout with clockwise motor numbering.",
  15: "I-beam layout. Motors in a line.",
  16: "NYT Plus configuration.",
  17: "NYT X configuration.",
  18: "X layout with reversed motor directions.",
};

// ── Frame Class Descriptions ─────────────────────────────────

export const FRAME_CLASS_DESCRIPTIONS: Record<number, string> = {
  0: "Not configured",
  1: "4 motors, standard multirotor",
  2: "6 motors, single-plane hexagonal",
  3: "8 motors, single-plane octagonal",
  4: "8 motors, coaxial pairs on 4 arms",
  5: "6 motors on 3 arms, coaxial pairs",
  6: "Traditional helicopter, single main rotor",
  7: "3 motors + 1 yaw servo",
  8: "Single motor with control vanes",
  9: "2 coaxial motors, no swashplate",
  10: "2 tilting motors",
  11: "Tandem or intermeshing dual-rotor helicopter",
  12: "12 motors, coaxial hex configuration",
  13: "4-rotor helicopter with collective pitch",
  14: "10 motors, single-plane decagonal",
};

// ── Frame Class Notes ────────────────────────────────────────

export const FRAME_CLASS_NOTES: Record<number, string> = {
  7: "ArduPilot ignores FRAME_TYPE for Tricopter. All types use the same motor layout.",
  5: "Most FRAME_TYPE values for Y6 use the same layout. Only Y6B (10) and Y6F (11) differ.",
};

// ── Layout Data (75 layouts from APMotorLayout.json) ──────────

const LAYOUTS: FrameLayout[] = [
  // ── QUAD (Class 1) ────────────────────────────────
  { frameClass: 1, className: "Quad", frameType: 0, typeName: "Plus",
    motors: [
      { number: 1, testOrder: 2, rotation: "CCW", roll: -0.5, pitch: 0 },
      { number: 2, testOrder: 4, rotation: "CCW", roll: 0.5, pitch: 0 },
      { number: 3, testOrder: 1, rotation: "CW", roll: 0, pitch: 0.5 },
      { number: 4, testOrder: 3, rotation: "CW", roll: 0, pitch: -0.5 },
    ],
  },
  { frameClass: 1, className: "Quad", frameType: 1, typeName: "X",
    motors: [
      { number: 1, testOrder: 1, rotation: "CCW", roll: -0.5, pitch: 0.5 },
      { number: 2, testOrder: 3, rotation: "CCW", roll: 0.5, pitch: -0.5 },
      { number: 3, testOrder: 4, rotation: "CW", roll: 0.5, pitch: 0.5 },
      { number: 4, testOrder: 2, rotation: "CW", roll: -0.5, pitch: -0.5 },
    ],
  },
  { frameClass: 1, className: "Quad", frameType: 2, typeName: "V",
    motors: [
      { number: 1, testOrder: 1, rotation: "CCW", roll: -0.5, pitch: 0.5 },
      { number: 2, testOrder: 3, rotation: "CCW", roll: 0.5, pitch: -0.5 },
      { number: 3, testOrder: 4, rotation: "CW", roll: 0.5, pitch: 0.5 },
      { number: 4, testOrder: 2, rotation: "CW", roll: -0.5, pitch: -0.5 },
    ],
  },
  { frameClass: 1, className: "Quad", frameType: 3, typeName: "H",
    motors: [
      { number: 1, testOrder: 1, rotation: "CW", roll: -0.5, pitch: 0.5 },
      { number: 2, testOrder: 3, rotation: "CW", roll: 0.5, pitch: -0.5 },
      { number: 3, testOrder: 4, rotation: "CCW", roll: 0.5, pitch: 0.5 },
      { number: 4, testOrder: 2, rotation: "CCW", roll: -0.5, pitch: -0.5 },
    ],
  },
  { frameClass: 1, className: "Quad", frameType: 4, typeName: "VTail",
    motors: [
      { number: 1, testOrder: 1, rotation: "?", roll: -0.5, pitch: 0.266 },
      { number: 2, testOrder: 3, rotation: "CW", roll: 0, pitch: -0.5 },
      { number: 3, testOrder: 4, rotation: "?", roll: 0.5, pitch: 0.266 },
      { number: 4, testOrder: 2, rotation: "CCW", roll: 0, pitch: -0.5 },
    ],
  },
  { frameClass: 1, className: "Quad", frameType: 5, typeName: "ATail",
    motors: [
      { number: 1, testOrder: 1, rotation: "?", roll: -0.5, pitch: 0.266 },
      { number: 2, testOrder: 3, rotation: "CCW", roll: 0, pitch: -0.5 },
      { number: 3, testOrder: 4, rotation: "?", roll: 0.5, pitch: 0.266 },
      { number: 4, testOrder: 2, rotation: "CW", roll: 0, pitch: -0.5 },
    ],
  },
  { frameClass: 1, className: "Quad", frameType: 6, typeName: "PlusRev",
    motors: [
      { number: 1, testOrder: 2, rotation: "CW", roll: -0.5, pitch: 0 },
      { number: 2, testOrder: 4, rotation: "CW", roll: 0.5, pitch: 0 },
      { number: 3, testOrder: 1, rotation: "CCW", roll: 0, pitch: 0.5 },
      { number: 4, testOrder: 3, rotation: "CCW", roll: 0, pitch: -0.5 },
    ],
  },
  { frameClass: 1, className: "Quad", frameType: 12, typeName: "BetaFlightX",
    motors: [
      { number: 1, testOrder: 2, rotation: "CW", roll: -0.5, pitch: -0.5 },
      { number: 2, testOrder: 1, rotation: "CCW", roll: -0.5, pitch: 0.5 },
      { number: 3, testOrder: 3, rotation: "CCW", roll: 0.5, pitch: -0.5 },
      { number: 4, testOrder: 4, rotation: "CW", roll: 0.5, pitch: 0.5 },
    ],
  },
  { frameClass: 1, className: "Quad", frameType: 13, typeName: "DJI X",
    motors: [
      { number: 1, testOrder: 1, rotation: "CCW", roll: -0.5, pitch: 0.5 },
      { number: 2, testOrder: 4, rotation: "CW", roll: 0.5, pitch: 0.5 },
      { number: 3, testOrder: 3, rotation: "CCW", roll: 0.5, pitch: -0.5 },
      { number: 4, testOrder: 2, rotation: "CW", roll: -0.5, pitch: -0.5 },
    ],
  },
  { frameClass: 1, className: "Quad", frameType: 14, typeName: "ClockwiseX",
    motors: [
      { number: 1, testOrder: 1, rotation: "CCW", roll: -0.5, pitch: 0.5 },
      { number: 2, testOrder: 2, rotation: "CW", roll: -0.5, pitch: -0.5 },
      { number: 3, testOrder: 3, rotation: "CCW", roll: 0.5, pitch: -0.5 },
      { number: 4, testOrder: 4, rotation: "CW", roll: 0.5, pitch: 0.5 },
    ],
  },
  { frameClass: 1, className: "Quad", frameType: 16, typeName: "NYT Plus",
    motors: [
      { number: 1, testOrder: 2, rotation: "?", roll: -0.5, pitch: 0 },
      { number: 2, testOrder: 4, rotation: "?", roll: 0.5, pitch: 0 },
      { number: 3, testOrder: 1, rotation: "?", roll: 0, pitch: 0.5 },
      { number: 4, testOrder: 3, rotation: "?", roll: 0, pitch: -0.5 },
    ],
  },
  { frameClass: 1, className: "Quad", frameType: 17, typeName: "NYT X",
    motors: [
      { number: 1, testOrder: 1, rotation: "?", roll: -0.5, pitch: 0.5 },
      { number: 2, testOrder: 3, rotation: "?", roll: 0.5, pitch: -0.5 },
      { number: 3, testOrder: 4, rotation: "?", roll: 0.5, pitch: 0.5 },
      { number: 4, testOrder: 2, rotation: "?", roll: -0.5, pitch: -0.5 },
    ],
  },
  { frameClass: 1, className: "Quad", frameType: 18, typeName: "X Reversed",
    motors: [
      { number: 1, testOrder: 2, rotation: "CCW", roll: -0.5, pitch: -0.5 },
      { number: 2, testOrder: 1, rotation: "CW", roll: -0.5, pitch: 0.5 },
      { number: 3, testOrder: 3, rotation: "CW", roll: 0.5, pitch: -0.5 },
      { number: 4, testOrder: 4, rotation: "CCW", roll: 0.5, pitch: 0.5 },
    ],
  },

  // ── HEXA (Class 2) ────────────────────────────────
  { frameClass: 2, className: "Hexa", frameType: 0, typeName: "Plus",
    motors: [
      { number: 1, testOrder: 1, rotation: "CW", roll: 0, pitch: 0.5 },
      { number: 2, testOrder: 4, rotation: "CCW", roll: 0, pitch: -0.5 },
      { number: 3, testOrder: 5, rotation: "CW", roll: 0.5, pitch: -0.25 },
      { number: 4, testOrder: 2, rotation: "CCW", roll: -0.5, pitch: 0.25 },
      { number: 5, testOrder: 6, rotation: "CCW", roll: 0.5, pitch: 0.25 },
      { number: 6, testOrder: 3, rotation: "CW", roll: -0.5, pitch: -0.25 },
    ],
  },
  { frameClass: 2, className: "Hexa", frameType: 1, typeName: "X",
    motors: [
      { number: 1, testOrder: 2, rotation: "CW", roll: -0.5, pitch: 0 },
      { number: 2, testOrder: 5, rotation: "CCW", roll: 0.5, pitch: 0 },
      { number: 3, testOrder: 6, rotation: "CW", roll: 0.25, pitch: 0.5 },
      { number: 4, testOrder: 3, rotation: "CCW", roll: -0.25, pitch: -0.5 },
      { number: 5, testOrder: 1, rotation: "CCW", roll: -0.25, pitch: 0.5 },
      { number: 6, testOrder: 4, rotation: "CW", roll: 0.25, pitch: -0.5 },
    ],
  },
  { frameClass: 2, className: "Hexa", frameType: 3, typeName: "H",
    motors: [
      { number: 1, testOrder: 2, rotation: "CW", roll: -0.5, pitch: 0 },
      { number: 2, testOrder: 5, rotation: "CCW", roll: 0.5, pitch: 0 },
      { number: 3, testOrder: 6, rotation: "CW", roll: 0.5, pitch: 0.5 },
      { number: 4, testOrder: 3, rotation: "CCW", roll: -0.5, pitch: -0.5 },
      { number: 5, testOrder: 1, rotation: "CCW", roll: -0.5, pitch: 0.5 },
      { number: 6, testOrder: 4, rotation: "CW", roll: 0.5, pitch: -0.5 },
    ],
  },
  { frameClass: 2, className: "Hexa", frameType: 13, typeName: "DJI X",
    motors: [
      { number: 1, testOrder: 1, rotation: "CCW", roll: -0.25, pitch: 0.5 },
      { number: 2, testOrder: 6, rotation: "CW", roll: 0.25, pitch: 0.5 },
      { number: 3, testOrder: 5, rotation: "CCW", roll: 0.5, pitch: 0 },
      { number: 4, testOrder: 4, rotation: "CW", roll: 0.25, pitch: -0.5 },
      { number: 5, testOrder: 3, rotation: "CCW", roll: -0.25, pitch: -0.5 },
      { number: 6, testOrder: 2, rotation: "CW", roll: -0.5, pitch: 0 },
    ],
  },
  { frameClass: 2, className: "Hexa", frameType: 14, typeName: "ClockwiseX",
    motors: [
      { number: 1, testOrder: 1, rotation: "CCW", roll: -0.25, pitch: 0.5 },
      { number: 2, testOrder: 2, rotation: "CW", roll: -0.5, pitch: 0 },
      { number: 3, testOrder: 3, rotation: "CCW", roll: -0.25, pitch: -0.5 },
      { number: 4, testOrder: 4, rotation: "CW", roll: 0.25, pitch: -0.5 },
      { number: 5, testOrder: 5, rotation: "CCW", roll: 0.5, pitch: 0 },
      { number: 6, testOrder: 6, rotation: "CW", roll: 0.25, pitch: 0.5 },
    ],
  },

  // ── OCTA (Class 3) ────────────────────────────────
  { frameClass: 3, className: "Octa", frameType: 0, typeName: "Plus",
    motors: [
      { number: 1, testOrder: 1, rotation: "CW", roll: 0, pitch: 0.5 },
      { number: 2, testOrder: 5, rotation: "CW", roll: 0, pitch: -0.5 },
      { number: 3, testOrder: 2, rotation: "CCW", roll: -0.3535, pitch: 0.3535 },
      { number: 4, testOrder: 4, rotation: "CCW", roll: -0.3535, pitch: -0.3535 },
      { number: 5, testOrder: 8, rotation: "CCW", roll: 0.3535, pitch: 0.3535 },
      { number: 6, testOrder: 6, rotation: "CCW", roll: 0.3535, pitch: -0.3535 },
      { number: 7, testOrder: 7, rotation: "CW", roll: 0.5, pitch: 0 },
      { number: 8, testOrder: 3, rotation: "CW", roll: -0.5, pitch: 0 },
    ],
  },
  { frameClass: 3, className: "Octa", frameType: 1, typeName: "X",
    motors: [
      { number: 1, testOrder: 1, rotation: "CW", roll: -0.2071, pitch: 0.5 },
      { number: 2, testOrder: 5, rotation: "CW", roll: 0.2071, pitch: -0.5 },
      { number: 3, testOrder: 2, rotation: "CCW", roll: -0.5, pitch: 0.2071 },
      { number: 4, testOrder: 4, rotation: "CCW", roll: -0.2071, pitch: -0.5 },
      { number: 5, testOrder: 8, rotation: "CCW", roll: 0.2071, pitch: 0.5 },
      { number: 6, testOrder: 6, rotation: "CCW", roll: 0.5, pitch: -0.2071 },
      { number: 7, testOrder: 7, rotation: "CW", roll: 0.5, pitch: 0.2071 },
      { number: 8, testOrder: 3, rotation: "CW", roll: -0.5, pitch: -0.2071 },
    ],
  },
  { frameClass: 3, className: "Octa", frameType: 2, typeName: "V",
    motors: [
      { number: 1, testOrder: 7, rotation: "CW", roll: 0.415, pitch: 0.17 },
      { number: 2, testOrder: 3, rotation: "CW", roll: -0.335, pitch: -0.16 },
      { number: 3, testOrder: 6, rotation: "CCW", roll: 0.335, pitch: -0.16 },
      { number: 4, testOrder: 4, rotation: "CCW", roll: -0.25, pitch: -0.5 },
      { number: 5, testOrder: 8, rotation: "CCW", roll: 0.5, pitch: 0.5 },
      { number: 6, testOrder: 2, rotation: "CCW", roll: -0.415, pitch: 0.17 },
      { number: 7, testOrder: 1, rotation: "CW", roll: -0.5, pitch: 0.5 },
      { number: 8, testOrder: 5, rotation: "CW", roll: 0.25, pitch: -0.5 },
    ],
  },
  { frameClass: 3, className: "Octa", frameType: 3, typeName: "H",
    motors: [
      { number: 1, testOrder: 1, rotation: "CW", roll: -0.5, pitch: 0.5 },
      { number: 2, testOrder: 5, rotation: "CW", roll: 0.5, pitch: -0.5 },
      { number: 3, testOrder: 2, rotation: "CCW", roll: -0.5, pitch: 0.1665 },
      { number: 4, testOrder: 4, rotation: "CCW", roll: -0.5, pitch: -0.5 },
      { number: 5, testOrder: 8, rotation: "CCW", roll: 0.5, pitch: 0.5 },
      { number: 6, testOrder: 6, rotation: "CCW", roll: 0.5, pitch: -0.1665 },
      { number: 7, testOrder: 7, rotation: "CW", roll: 0.5, pitch: 0.1665 },
      { number: 8, testOrder: 3, rotation: "CW", roll: -0.5, pitch: -0.1665 },
    ],
  },
  { frameClass: 3, className: "Octa", frameType: 13, typeName: "DJI X",
    motors: [
      { number: 1, testOrder: 1, rotation: "CCW", roll: -0.2071, pitch: 0.5 },
      { number: 2, testOrder: 8, rotation: "CW", roll: 0.2071, pitch: 0.5 },
      { number: 3, testOrder: 7, rotation: "CCW", roll: 0.5, pitch: 0.2071 },
      { number: 4, testOrder: 6, rotation: "CW", roll: 0.5, pitch: -0.2071 },
      { number: 5, testOrder: 5, rotation: "CCW", roll: 0.2071, pitch: -0.5 },
      { number: 6, testOrder: 4, rotation: "CW", roll: -0.2071, pitch: -0.5 },
      { number: 7, testOrder: 3, rotation: "CCW", roll: -0.5, pitch: -0.2071 },
      { number: 8, testOrder: 2, rotation: "CW", roll: -0.5, pitch: 0.2071 },
    ],
  },
  { frameClass: 3, className: "Octa", frameType: 14, typeName: "ClockwiseX",
    motors: [
      { number: 1, testOrder: 1, rotation: "CCW", roll: -0.2071, pitch: 0.5 },
      { number: 2, testOrder: 2, rotation: "CW", roll: -0.5, pitch: 0.2071 },
      { number: 3, testOrder: 3, rotation: "CCW", roll: -0.5, pitch: -0.2071 },
      { number: 4, testOrder: 4, rotation: "CW", roll: -0.2071, pitch: -0.5 },
      { number: 5, testOrder: 5, rotation: "CCW", roll: 0.2071, pitch: -0.5 },
      { number: 6, testOrder: 6, rotation: "CW", roll: 0.5, pitch: -0.2071 },
      { number: 7, testOrder: 7, rotation: "CCW", roll: 0.5, pitch: 0.2071 },
      { number: 8, testOrder: 8, rotation: "CW", roll: 0.2071, pitch: 0.5 },
    ],
  },
  { frameClass: 3, className: "Octa", frameType: 15, typeName: "I",
    motors: [
      { number: 1, testOrder: 5, rotation: "CW", roll: 0.1665, pitch: -0.5 },
      { number: 2, testOrder: 1, rotation: "CW", roll: -0.1665, pitch: 0.5 },
      { number: 3, testOrder: 6, rotation: "CCW", roll: 0.5, pitch: -0.5 },
      { number: 4, testOrder: 8, rotation: "CCW", roll: 0.1665, pitch: 0.5 },
      { number: 5, testOrder: 4, rotation: "CCW", roll: -0.1665, pitch: -0.5 },
      { number: 6, testOrder: 2, rotation: "CCW", roll: -0.5, pitch: 0.5 },
      { number: 7, testOrder: 3, rotation: "CW", roll: -0.5, pitch: -0.5 },
      { number: 8, testOrder: 7, rotation: "CW", roll: 0.5, pitch: 0.5 },
    ],
  },

  // ── OCTAQUAD (Class 4) ────────────────────────────────
  { frameClass: 4, className: "OctaQuad", frameType: 0, typeName: "Plus",
    motors: [
      { number: 1, testOrder: 1, rotation: "CCW", roll: 0, pitch: 0.5 },
      { number: 2, testOrder: 7, rotation: "CW", roll: 0.5, pitch: 0 },
      { number: 3, testOrder: 5, rotation: "CCW", roll: 0, pitch: -0.5 },
      { number: 4, testOrder: 3, rotation: "CW", roll: -0.5, pitch: 0 },
      { number: 5, testOrder: 8, rotation: "CCW", roll: 0.5, pitch: 0 },
      { number: 6, testOrder: 2, rotation: "CW", roll: 0, pitch: 0.5 },
      { number: 7, testOrder: 4, rotation: "CCW", roll: -0.5, pitch: 0 },
      { number: 8, testOrder: 6, rotation: "CW", roll: 0, pitch: -0.5 },
    ],
  },
  { frameClass: 4, className: "OctaQuad", frameType: 1, typeName: "X",
    motors: [
      { number: 1, testOrder: 1, rotation: "CCW", roll: -0.5, pitch: 0.5 },
      { number: 2, testOrder: 7, rotation: "CW", roll: 0.5, pitch: 0.5 },
      { number: 3, testOrder: 5, rotation: "CCW", roll: 0.5, pitch: -0.5 },
      { number: 4, testOrder: 3, rotation: "CW", roll: -0.5, pitch: -0.5 },
      { number: 5, testOrder: 8, rotation: "CCW", roll: 0.5, pitch: 0.5 },
      { number: 6, testOrder: 2, rotation: "CW", roll: -0.5, pitch: 0.5 },
      { number: 7, testOrder: 4, rotation: "CCW", roll: -0.5, pitch: -0.5 },
      { number: 8, testOrder: 6, rotation: "CW", roll: 0.5, pitch: -0.5 },
    ],
  },
  { frameClass: 4, className: "OctaQuad", frameType: 2, typeName: "V",
    motors: [
      { number: 1, testOrder: 1, rotation: "CCW", roll: -0.5, pitch: 0.5 },
      { number: 2, testOrder: 7, rotation: "CW", roll: 0.5, pitch: 0.5 },
      { number: 3, testOrder: 5, rotation: "CCW", roll: 0.5, pitch: -0.5 },
      { number: 4, testOrder: 3, rotation: "CW", roll: -0.5, pitch: -0.5 },
      { number: 5, testOrder: 8, rotation: "CCW", roll: 0.5, pitch: 0.5 },
      { number: 6, testOrder: 2, rotation: "CW", roll: -0.5, pitch: 0.5 },
      { number: 7, testOrder: 4, rotation: "CCW", roll: -0.5, pitch: -0.5 },
      { number: 8, testOrder: 6, rotation: "CW", roll: 0.5, pitch: -0.5 },
    ],
  },
  { frameClass: 4, className: "OctaQuad", frameType: 3, typeName: "H",
    motors: [
      { number: 1, testOrder: 1, rotation: "CW", roll: -0.5, pitch: 0.5 },
      { number: 2, testOrder: 7, rotation: "CCW", roll: 0.5, pitch: 0.5 },
      { number: 3, testOrder: 5, rotation: "CW", roll: 0.5, pitch: -0.5 },
      { number: 4, testOrder: 3, rotation: "CCW", roll: -0.5, pitch: -0.5 },
      { number: 5, testOrder: 8, rotation: "CW", roll: 0.5, pitch: 0.5 },
      { number: 6, testOrder: 2, rotation: "CCW", roll: -0.5, pitch: 0.5 },
      { number: 7, testOrder: 4, rotation: "CW", roll: -0.5, pitch: -0.5 },
      { number: 8, testOrder: 6, rotation: "CCW", roll: 0.5, pitch: -0.5 },
    ],
  },
  { frameClass: 4, className: "OctaQuad", frameType: 12, typeName: "BetaFlightX",
    motors: [
      { number: 1, testOrder: 3, rotation: "CW", roll: -0.5, pitch: -0.5 },
      { number: 2, testOrder: 1, rotation: "CCW", roll: -0.5, pitch: 0.5 },
      { number: 3, testOrder: 5, rotation: "CCW", roll: 0.5, pitch: -0.5 },
      { number: 4, testOrder: 7, rotation: "CW", roll: 0.5, pitch: 0.5 },
      { number: 5, testOrder: 4, rotation: "CCW", roll: -0.5, pitch: -0.5 },
      { number: 6, testOrder: 2, rotation: "CW", roll: -0.5, pitch: 0.5 },
      { number: 7, testOrder: 6, rotation: "CW", roll: 0.5, pitch: -0.5 },
      { number: 8, testOrder: 8, rotation: "CCW", roll: 0.5, pitch: 0.5 },
    ],
  },
  { frameClass: 4, className: "OctaQuad", frameType: 14, typeName: "ClockwiseX",
    motors: [
      { number: 1, testOrder: 1, rotation: "CCW", roll: -0.5, pitch: 0.5 },
      { number: 2, testOrder: 2, rotation: "CW", roll: -0.5, pitch: 0.5 },
      { number: 3, testOrder: 3, rotation: "CW", roll: -0.5, pitch: -0.5 },
      { number: 4, testOrder: 4, rotation: "CCW", roll: -0.5, pitch: -0.5 },
      { number: 5, testOrder: 5, rotation: "CCW", roll: 0.5, pitch: -0.5 },
      { number: 6, testOrder: 6, rotation: "CW", roll: 0.5, pitch: -0.5 },
      { number: 7, testOrder: 7, rotation: "CW", roll: 0.5, pitch: 0.5 },
      { number: 8, testOrder: 8, rotation: "CCW", roll: 0.5, pitch: 0.5 },
    ],
  },
  { frameClass: 4, className: "OctaQuad", frameType: 18, typeName: "X Reversed",
    motors: [
      { number: 1, testOrder: 3, rotation: "CCW", roll: -0.5, pitch: -0.5 },
      { number: 2, testOrder: 1, rotation: "CW", roll: -0.5, pitch: 0.5 },
      { number: 3, testOrder: 5, rotation: "CW", roll: 0.5, pitch: -0.5 },
      { number: 4, testOrder: 7, rotation: "CCW", roll: 0.5, pitch: 0.5 },
      { number: 5, testOrder: 4, rotation: "CW", roll: -0.5, pitch: -0.5 },
      { number: 6, testOrder: 2, rotation: "CCW", roll: -0.5, pitch: 0.5 },
      { number: 7, testOrder: 6, rotation: "CCW", roll: 0.5, pitch: -0.5 },
      { number: 8, testOrder: 8, rotation: "CW", roll: 0.5, pitch: 0.5 },
    ],
  },

  // ── Y6 (Class 5) ────────────────────────────────
  { frameClass: 5, className: "Y6", frameType: 0, typeName: "Default",
    motors: [
      { number: 1, testOrder: 2, rotation: "CCW", roll: -0.5, pitch: 0.2498 },
      { number: 2, testOrder: 5, rotation: "CW", roll: 0.5, pitch: 0.2498 },
      { number: 3, testOrder: 6, rotation: "CCW", roll: 0.5, pitch: 0.2498 },
      { number: 4, testOrder: 4, rotation: "CW", roll: 0, pitch: -0.5 },
      { number: 5, testOrder: 1, rotation: "CW", roll: -0.5, pitch: 0.2498 },
      { number: 6, testOrder: 3, rotation: "CCW", roll: 0, pitch: -0.5 },
    ],
  },
  { frameClass: 5, className: "Y6", frameType: 1, typeName: "Default",
    motors: [
      { number: 1, testOrder: 2, rotation: "CCW", roll: -0.5, pitch: 0.2498 },
      { number: 2, testOrder: 5, rotation: "CW", roll: 0.5, pitch: 0.2498 },
      { number: 3, testOrder: 6, rotation: "CCW", roll: 0.5, pitch: 0.2498 },
      { number: 4, testOrder: 4, rotation: "CW", roll: 0, pitch: -0.5 },
      { number: 5, testOrder: 1, rotation: "CW", roll: -0.5, pitch: 0.2498 },
      { number: 6, testOrder: 3, rotation: "CCW", roll: 0, pitch: -0.5 },
    ],
  },
  { frameClass: 5, className: "Y6", frameType: 2, typeName: "Default",
    motors: [
      { number: 1, testOrder: 2, rotation: "CCW", roll: -0.5, pitch: 0.2498 },
      { number: 2, testOrder: 5, rotation: "CW", roll: 0.5, pitch: 0.2498 },
      { number: 3, testOrder: 6, rotation: "CCW", roll: 0.5, pitch: 0.2498 },
      { number: 4, testOrder: 4, rotation: "CW", roll: 0, pitch: -0.5 },
      { number: 5, testOrder: 1, rotation: "CW", roll: -0.5, pitch: 0.2498 },
      { number: 6, testOrder: 3, rotation: "CCW", roll: 0, pitch: -0.5 },
    ],
  },
  { frameClass: 5, className: "Y6", frameType: 3, typeName: "Default",
    motors: [
      { number: 1, testOrder: 2, rotation: "CCW", roll: -0.5, pitch: 0.2498 },
      { number: 2, testOrder: 5, rotation: "CW", roll: 0.5, pitch: 0.2498 },
      { number: 3, testOrder: 6, rotation: "CCW", roll: 0.5, pitch: 0.2498 },
      { number: 4, testOrder: 4, rotation: "CW", roll: 0, pitch: -0.5 },
      { number: 5, testOrder: 1, rotation: "CW", roll: -0.5, pitch: 0.2498 },
      { number: 6, testOrder: 3, rotation: "CCW", roll: 0, pitch: -0.5 },
    ],
  },
  { frameClass: 5, className: "Y6", frameType: 4, typeName: "Default",
    motors: [
      { number: 1, testOrder: 2, rotation: "CCW", roll: -0.5, pitch: 0.2498 },
      { number: 2, testOrder: 5, rotation: "CW", roll: 0.5, pitch: 0.2498 },
      { number: 3, testOrder: 6, rotation: "CCW", roll: 0.5, pitch: 0.2498 },
      { number: 4, testOrder: 4, rotation: "CW", roll: 0, pitch: -0.5 },
      { number: 5, testOrder: 1, rotation: "CW", roll: -0.5, pitch: 0.2498 },
      { number: 6, testOrder: 3, rotation: "CCW", roll: 0, pitch: -0.5 },
    ],
  },
  { frameClass: 5, className: "Y6", frameType: 5, typeName: "Default",
    motors: [
      { number: 1, testOrder: 2, rotation: "CCW", roll: -0.5, pitch: 0.2498 },
      { number: 2, testOrder: 5, rotation: "CW", roll: 0.5, pitch: 0.2498 },
      { number: 3, testOrder: 6, rotation: "CCW", roll: 0.5, pitch: 0.2498 },
      { number: 4, testOrder: 4, rotation: "CW", roll: 0, pitch: -0.5 },
      { number: 5, testOrder: 1, rotation: "CW", roll: -0.5, pitch: 0.2498 },
      { number: 6, testOrder: 3, rotation: "CCW", roll: 0, pitch: -0.5 },
    ],
  },
  { frameClass: 5, className: "Y6", frameType: 6, typeName: "Default",
    motors: [
      { number: 1, testOrder: 2, rotation: "CCW", roll: -0.5, pitch: 0.2498 },
      { number: 2, testOrder: 5, rotation: "CW", roll: 0.5, pitch: 0.2498 },
      { number: 3, testOrder: 6, rotation: "CCW", roll: 0.5, pitch: 0.2498 },
      { number: 4, testOrder: 4, rotation: "CW", roll: 0, pitch: -0.5 },
      { number: 5, testOrder: 1, rotation: "CW", roll: -0.5, pitch: 0.2498 },
      { number: 6, testOrder: 3, rotation: "CCW", roll: 0, pitch: -0.5 },
    ],
  },
  { frameClass: 5, className: "Y6", frameType: 7, typeName: "Default",
    motors: [
      { number: 1, testOrder: 2, rotation: "CCW", roll: -0.5, pitch: 0.2498 },
      { number: 2, testOrder: 5, rotation: "CW", roll: 0.5, pitch: 0.2498 },
      { number: 3, testOrder: 6, rotation: "CCW", roll: 0.5, pitch: 0.2498 },
      { number: 4, testOrder: 4, rotation: "CW", roll: 0, pitch: -0.5 },
      { number: 5, testOrder: 1, rotation: "CW", roll: -0.5, pitch: 0.2498 },
      { number: 6, testOrder: 3, rotation: "CCW", roll: 0, pitch: -0.5 },
    ],
  },
  { frameClass: 5, className: "Y6", frameType: 8, typeName: "Default",
    motors: [
      { number: 1, testOrder: 2, rotation: "CCW", roll: -0.5, pitch: 0.2498 },
      { number: 2, testOrder: 5, rotation: "CW", roll: 0.5, pitch: 0.2498 },
      { number: 3, testOrder: 6, rotation: "CCW", roll: 0.5, pitch: 0.2498 },
      { number: 4, testOrder: 4, rotation: "CW", roll: 0, pitch: -0.5 },
      { number: 5, testOrder: 1, rotation: "CW", roll: -0.5, pitch: 0.2498 },
      { number: 6, testOrder: 3, rotation: "CCW", roll: 0, pitch: -0.5 },
    ],
  },
  { frameClass: 5, className: "Y6", frameType: 9, typeName: "Default",
    motors: [
      { number: 1, testOrder: 2, rotation: "CCW", roll: -0.5, pitch: 0.2498 },
      { number: 2, testOrder: 5, rotation: "CW", roll: 0.5, pitch: 0.2498 },
      { number: 3, testOrder: 6, rotation: "CCW", roll: 0.5, pitch: 0.2498 },
      { number: 4, testOrder: 4, rotation: "CW", roll: 0, pitch: -0.5 },
      { number: 5, testOrder: 1, rotation: "CW", roll: -0.5, pitch: 0.2498 },
      { number: 6, testOrder: 3, rotation: "CCW", roll: 0, pitch: -0.5 },
    ],
  },
  { frameClass: 5, className: "Y6", frameType: 10, typeName: "Y6B",
    motors: [
      { number: 1, testOrder: 1, rotation: "CW", roll: -0.5, pitch: 0.25 },
      { number: 2, testOrder: 2, rotation: "CCW", roll: -0.5, pitch: 0.25 },
      { number: 3, testOrder: 3, rotation: "CW", roll: 0, pitch: -0.5 },
      { number: 4, testOrder: 4, rotation: "CCW", roll: 0, pitch: -0.5 },
      { number: 5, testOrder: 5, rotation: "CW", roll: 0.5, pitch: 0.25 },
      { number: 6, testOrder: 6, rotation: "CCW", roll: 0.5, pitch: 0.25 },
    ],
  },
  { frameClass: 5, className: "Y6", frameType: 11, typeName: "Y6F",
    motors: [
      { number: 1, testOrder: 3, rotation: "CCW", roll: 0, pitch: -0.5 },
      { number: 2, testOrder: 1, rotation: "CCW", roll: -0.5, pitch: 0.25 },
      { number: 3, testOrder: 5, rotation: "CCW", roll: 0.5, pitch: 0.25 },
      { number: 4, testOrder: 4, rotation: "CW", roll: 0, pitch: -0.5 },
      { number: 5, testOrder: 2, rotation: "CW", roll: -0.5, pitch: 0.25 },
      { number: 6, testOrder: 6, rotation: "CW", roll: 0.5, pitch: 0.25 },
    ],
  },
  { frameClass: 5, className: "Y6", frameType: 12, typeName: "Default",
    motors: [
      { number: 1, testOrder: 2, rotation: "CCW", roll: -0.5, pitch: 0.2498 },
      { number: 2, testOrder: 5, rotation: "CW", roll: 0.5, pitch: 0.2498 },
      { number: 3, testOrder: 6, rotation: "CCW", roll: 0.5, pitch: 0.2498 },
      { number: 4, testOrder: 4, rotation: "CW", roll: 0, pitch: -0.5 },
      { number: 5, testOrder: 1, rotation: "CW", roll: -0.5, pitch: 0.2498 },
      { number: 6, testOrder: 3, rotation: "CCW", roll: 0, pitch: -0.5 },
    ],
  },
  { frameClass: 5, className: "Y6", frameType: 13, typeName: "Default",
    motors: [
      { number: 1, testOrder: 2, rotation: "CCW", roll: -0.5, pitch: 0.2498 },
      { number: 2, testOrder: 5, rotation: "CW", roll: 0.5, pitch: 0.2498 },
      { number: 3, testOrder: 6, rotation: "CCW", roll: 0.5, pitch: 0.2498 },
      { number: 4, testOrder: 4, rotation: "CW", roll: 0, pitch: -0.5 },
      { number: 5, testOrder: 1, rotation: "CW", roll: -0.5, pitch: 0.2498 },
      { number: 6, testOrder: 3, rotation: "CCW", roll: 0, pitch: -0.5 },
    ],
  },
  { frameClass: 5, className: "Y6", frameType: 14, typeName: "Default",
    motors: [
      { number: 1, testOrder: 2, rotation: "CCW", roll: -0.5, pitch: 0.2498 },
      { number: 2, testOrder: 5, rotation: "CW", roll: 0.5, pitch: 0.2498 },
      { number: 3, testOrder: 6, rotation: "CCW", roll: 0.5, pitch: 0.2498 },
      { number: 4, testOrder: 4, rotation: "CW", roll: 0, pitch: -0.5 },
      { number: 5, testOrder: 1, rotation: "CW", roll: -0.5, pitch: 0.2498 },
      { number: 6, testOrder: 3, rotation: "CCW", roll: 0, pitch: -0.5 },
    ],
  },
  { frameClass: 5, className: "Y6", frameType: 15, typeName: "Default",
    motors: [
      { number: 1, testOrder: 2, rotation: "CCW", roll: -0.5, pitch: 0.2498 },
      { number: 2, testOrder: 5, rotation: "CW", roll: 0.5, pitch: 0.2498 },
      { number: 3, testOrder: 6, rotation: "CCW", roll: 0.5, pitch: 0.2498 },
      { number: 4, testOrder: 4, rotation: "CW", roll: 0, pitch: -0.5 },
      { number: 5, testOrder: 1, rotation: "CW", roll: -0.5, pitch: 0.2498 },
      { number: 6, testOrder: 3, rotation: "CCW", roll: 0, pitch: -0.5 },
    ],
  },
  { frameClass: 5, className: "Y6", frameType: 16, typeName: "Default",
    motors: [
      { number: 1, testOrder: 2, rotation: "CCW", roll: -0.5, pitch: 0.2498 },
      { number: 2, testOrder: 5, rotation: "CW", roll: 0.5, pitch: 0.2498 },
      { number: 3, testOrder: 6, rotation: "CCW", roll: 0.5, pitch: 0.2498 },
      { number: 4, testOrder: 4, rotation: "CW", roll: 0, pitch: -0.5 },
      { number: 5, testOrder: 1, rotation: "CW", roll: -0.5, pitch: 0.2498 },
      { number: 6, testOrder: 3, rotation: "CCW", roll: 0, pitch: -0.5 },
    ],
  },
  { frameClass: 5, className: "Y6", frameType: 17, typeName: "Default",
    motors: [
      { number: 1, testOrder: 2, rotation: "CCW", roll: -0.5, pitch: 0.2498 },
      { number: 2, testOrder: 5, rotation: "CW", roll: 0.5, pitch: 0.2498 },
      { number: 3, testOrder: 6, rotation: "CCW", roll: 0.5, pitch: 0.2498 },
      { number: 4, testOrder: 4, rotation: "CW", roll: 0, pitch: -0.5 },
      { number: 5, testOrder: 1, rotation: "CW", roll: -0.5, pitch: 0.2498 },
      { number: 6, testOrder: 3, rotation: "CCW", roll: 0, pitch: -0.5 },
    ],
  },
  { frameClass: 5, className: "Y6", frameType: 18, typeName: "Default",
    motors: [
      { number: 1, testOrder: 2, rotation: "CCW", roll: -0.5, pitch: 0.2498 },
      { number: 2, testOrder: 5, rotation: "CW", roll: 0.5, pitch: 0.2498 },
      { number: 3, testOrder: 6, rotation: "CCW", roll: 0.5, pitch: 0.2498 },
      { number: 4, testOrder: 4, rotation: "CW", roll: 0, pitch: -0.5 },
      { number: 5, testOrder: 1, rotation: "CW", roll: -0.5, pitch: 0.2498 },
      { number: 6, testOrder: 3, rotation: "CCW", roll: 0, pitch: -0.5 },
    ],
  },

  // ── TRI (Class 7) ────────────────────────────────
  { frameClass: 7, className: "Tri", frameType: 0, typeName: "Default",
    motors: [
      { number: 1, testOrder: 1, rotation: "?", roll: -1, pitch: 0.5 },
      { number: 2, testOrder: 4, rotation: "?", roll: 1, pitch: 0.5 },
      { number: 4, testOrder: 2, rotation: "?", roll: 0, pitch: -1 },
      { number: 7, testOrder: 3, rotation: "?", roll: 0, pitch: 0, isServo: true },
    ],
  },
  { frameClass: 7, className: "Tri", frameType: 1, typeName: "Default",
    motors: [
      { number: 1, testOrder: 1, rotation: "?", roll: -1, pitch: 0.5 },
      { number: 2, testOrder: 4, rotation: "?", roll: 1, pitch: 0.5 },
      { number: 4, testOrder: 2, rotation: "?", roll: 0, pitch: -1 },
      { number: 7, testOrder: 3, rotation: "?", roll: 0, pitch: 0, isServo: true },
    ],
  },
  { frameClass: 7, className: "Tri", frameType: 2, typeName: "Default",
    motors: [
      { number: 1, testOrder: 1, rotation: "?", roll: -1, pitch: 0.5 },
      { number: 2, testOrder: 4, rotation: "?", roll: 1, pitch: 0.5 },
      { number: 4, testOrder: 2, rotation: "?", roll: 0, pitch: -1 },
      { number: 7, testOrder: 3, rotation: "?", roll: 0, pitch: 0, isServo: true },
    ],
  },
  { frameClass: 7, className: "Tri", frameType: 3, typeName: "Default",
    motors: [
      { number: 1, testOrder: 1, rotation: "?", roll: -1, pitch: 0.5 },
      { number: 2, testOrder: 4, rotation: "?", roll: 1, pitch: 0.5 },
      { number: 4, testOrder: 2, rotation: "?", roll: 0, pitch: -1 },
      { number: 7, testOrder: 3, rotation: "?", roll: 0, pitch: 0, isServo: true },
    ],
  },
  { frameClass: 7, className: "Tri", frameType: 4, typeName: "Default",
    motors: [
      { number: 1, testOrder: 1, rotation: "?", roll: -1, pitch: 0.5 },
      { number: 2, testOrder: 4, rotation: "?", roll: 1, pitch: 0.5 },
      { number: 4, testOrder: 2, rotation: "?", roll: 0, pitch: -1 },
      { number: 7, testOrder: 3, rotation: "?", roll: 0, pitch: 0, isServo: true },
    ],
  },
  { frameClass: 7, className: "Tri", frameType: 5, typeName: "Default",
    motors: [
      { number: 1, testOrder: 1, rotation: "?", roll: -1, pitch: 0.5 },
      { number: 2, testOrder: 4, rotation: "?", roll: 1, pitch: 0.5 },
      { number: 4, testOrder: 2, rotation: "?", roll: 0, pitch: -1 },
      { number: 7, testOrder: 3, rotation: "?", roll: 0, pitch: 0, isServo: true },
    ],
  },
  { frameClass: 7, className: "Tri", frameType: 6, typeName: "Pitch Reversed",
    motors: [
      { number: 1, testOrder: 3, rotation: "?", roll: -1, pitch: -0.5 },
      { number: 2, testOrder: 4, rotation: "?", roll: 1, pitch: -0.5 },
      { number: 4, testOrder: 1, rotation: "?", roll: 0, pitch: 1 },
      { number: 7, testOrder: 2, rotation: "?", roll: 0, pitch: 0, isServo: true },
    ],
  },
  { frameClass: 7, className: "Tri", frameType: 7, typeName: "Default",
    motors: [
      { number: 1, testOrder: 1, rotation: "?", roll: -1, pitch: 0.5 },
      { number: 2, testOrder: 4, rotation: "?", roll: 1, pitch: 0.5 },
      { number: 4, testOrder: 2, rotation: "?", roll: 0, pitch: -1 },
      { number: 7, testOrder: 3, rotation: "?", roll: 0, pitch: 0, isServo: true },
    ],
  },
  { frameClass: 7, className: "Tri", frameType: 8, typeName: "Default",
    motors: [
      { number: 1, testOrder: 1, rotation: "?", roll: -1, pitch: 0.5 },
      { number: 2, testOrder: 4, rotation: "?", roll: 1, pitch: 0.5 },
      { number: 4, testOrder: 2, rotation: "?", roll: 0, pitch: -1 },
      { number: 7, testOrder: 3, rotation: "?", roll: 0, pitch: 0, isServo: true },
    ],
  },
  { frameClass: 7, className: "Tri", frameType: 9, typeName: "Default",
    motors: [
      { number: 1, testOrder: 1, rotation: "?", roll: -1, pitch: 0.5 },
      { number: 2, testOrder: 4, rotation: "?", roll: 1, pitch: 0.5 },
      { number: 4, testOrder: 2, rotation: "?", roll: 0, pitch: -1 },
      { number: 7, testOrder: 3, rotation: "?", roll: 0, pitch: 0, isServo: true },
    ],
  },
  { frameClass: 7, className: "Tri", frameType: 10, typeName: "Default",
    motors: [
      { number: 1, testOrder: 1, rotation: "?", roll: -1, pitch: 0.5 },
      { number: 2, testOrder: 4, rotation: "?", roll: 1, pitch: 0.5 },
      { number: 4, testOrder: 2, rotation: "?", roll: 0, pitch: -1 },
      { number: 7, testOrder: 3, rotation: "?", roll: 0, pitch: 0, isServo: true },
    ],
  },
  { frameClass: 7, className: "Tri", frameType: 11, typeName: "Default",
    motors: [
      { number: 1, testOrder: 1, rotation: "?", roll: -1, pitch: 0.5 },
      { number: 2, testOrder: 4, rotation: "?", roll: 1, pitch: 0.5 },
      { number: 4, testOrder: 2, rotation: "?", roll: 0, pitch: -1 },
      { number: 7, testOrder: 3, rotation: "?", roll: 0, pitch: 0, isServo: true },
    ],
  },
  { frameClass: 7, className: "Tri", frameType: 12, typeName: "Default",
    motors: [
      { number: 1, testOrder: 1, rotation: "?", roll: -1, pitch: 0.5 },
      { number: 2, testOrder: 4, rotation: "?", roll: 1, pitch: 0.5 },
      { number: 4, testOrder: 2, rotation: "?", roll: 0, pitch: -1 },
      { number: 7, testOrder: 3, rotation: "?", roll: 0, pitch: 0, isServo: true },
    ],
  },
  { frameClass: 7, className: "Tri", frameType: 13, typeName: "Default",
    motors: [
      { number: 1, testOrder: 1, rotation: "?", roll: -1, pitch: 0.5 },
      { number: 2, testOrder: 4, rotation: "?", roll: 1, pitch: 0.5 },
      { number: 4, testOrder: 2, rotation: "?", roll: 0, pitch: -1 },
      { number: 7, testOrder: 3, rotation: "?", roll: 0, pitch: 0, isServo: true },
    ],
  },
  { frameClass: 7, className: "Tri", frameType: 14, typeName: "Default",
    motors: [
      { number: 1, testOrder: 1, rotation: "?", roll: -1, pitch: 0.5 },
      { number: 2, testOrder: 4, rotation: "?", roll: 1, pitch: 0.5 },
      { number: 4, testOrder: 2, rotation: "?", roll: 0, pitch: -1 },
      { number: 7, testOrder: 3, rotation: "?", roll: 0, pitch: 0, isServo: true },
    ],
  },
  { frameClass: 7, className: "Tri", frameType: 15, typeName: "Default",
    motors: [
      { number: 1, testOrder: 1, rotation: "?", roll: -1, pitch: 0.5 },
      { number: 2, testOrder: 4, rotation: "?", roll: 1, pitch: 0.5 },
      { number: 4, testOrder: 2, rotation: "?", roll: 0, pitch: -1 },
      { number: 7, testOrder: 3, rotation: "?", roll: 0, pitch: 0, isServo: true },
    ],
  },
  { frameClass: 7, className: "Tri", frameType: 16, typeName: "Default",
    motors: [
      { number: 1, testOrder: 1, rotation: "?", roll: -1, pitch: 0.5 },
      { number: 2, testOrder: 4, rotation: "?", roll: 1, pitch: 0.5 },
      { number: 4, testOrder: 2, rotation: "?", roll: 0, pitch: -1 },
      { number: 7, testOrder: 3, rotation: "?", roll: 0, pitch: 0, isServo: true },
    ],
  },
  { frameClass: 7, className: "Tri", frameType: 17, typeName: "Default",
    motors: [
      { number: 1, testOrder: 1, rotation: "?", roll: -1, pitch: 0.5 },
      { number: 2, testOrder: 4, rotation: "?", roll: 1, pitch: 0.5 },
      { number: 4, testOrder: 2, rotation: "?", roll: 0, pitch: -1 },
      { number: 7, testOrder: 3, rotation: "?", roll: 0, pitch: 0, isServo: true },
    ],
  },
  { frameClass: 7, className: "Tri", frameType: 18, typeName: "Default",
    motors: [
      { number: 1, testOrder: 1, rotation: "?", roll: -1, pitch: 0.5 },
      { number: 2, testOrder: 4, rotation: "?", roll: 1, pitch: 0.5 },
      { number: 4, testOrder: 2, rotation: "?", roll: 0, pitch: -1 },
      { number: 7, testOrder: 3, rotation: "?", roll: 0, pitch: 0, isServo: true },
    ],
  },

  // ── DODECAHEXA (Class 12) ────────────────────────────────
  { frameClass: 12, className: "DodecaHexa", frameType: 0, typeName: "Plus",
    motors: [
      { number: 1, testOrder: 1, rotation: "CCW", roll: 0, pitch: 0.5 },
      { number: 2, testOrder: 2, rotation: "CW", roll: 0, pitch: 0.5 },
      { number: 3, testOrder: 3, rotation: "CW", roll: -0.5, pitch: 0.25 },
      { number: 4, testOrder: 4, rotation: "CCW", roll: -0.5, pitch: 0.25 },
      { number: 5, testOrder: 5, rotation: "CCW", roll: -0.5, pitch: -0.25 },
      { number: 6, testOrder: 6, rotation: "CW", roll: -0.5, pitch: -0.25 },
      { number: 7, testOrder: 7, rotation: "CW", roll: 0, pitch: -0.5 },
      { number: 8, testOrder: 8, rotation: "CCW", roll: 0, pitch: -0.5 },
      { number: 9, testOrder: 9, rotation: "CCW", roll: 0.5, pitch: -0.25 },
      { number: 10, testOrder: 10, rotation: "CW", roll: 0.5, pitch: -0.25 },
      { number: 11, testOrder: 11, rotation: "CW", roll: 0.5, pitch: 0.25 },
      { number: 12, testOrder: 12, rotation: "CCW", roll: 0.5, pitch: 0.25 },
    ],
  },
  { frameClass: 12, className: "DodecaHexa", frameType: 1, typeName: "X",
    motors: [
      { number: 1, testOrder: 1, rotation: "CCW", roll: -0.25, pitch: 0.5 },
      { number: 2, testOrder: 2, rotation: "CW", roll: -0.25, pitch: 0.5 },
      { number: 3, testOrder: 3, rotation: "CW", roll: -0.5, pitch: 0 },
      { number: 4, testOrder: 4, rotation: "CCW", roll: -0.5, pitch: 0 },
      { number: 5, testOrder: 5, rotation: "CCW", roll: -0.25, pitch: -0.5 },
      { number: 6, testOrder: 6, rotation: "CW", roll: -0.25, pitch: -0.5 },
      { number: 7, testOrder: 7, rotation: "CW", roll: 0.25, pitch: -0.5 },
      { number: 8, testOrder: 8, rotation: "CCW", roll: 0.25, pitch: -0.5 },
      { number: 9, testOrder: 9, rotation: "CCW", roll: 0.5, pitch: 0 },
      { number: 10, testOrder: 10, rotation: "CW", roll: 0.5, pitch: 0 },
      { number: 11, testOrder: 11, rotation: "CW", roll: 0.25, pitch: 0.5 },
      { number: 12, testOrder: 12, rotation: "CCW", roll: 0.25, pitch: 0.5 },
    ],
  },

  // ── DECA (Class 14) ────────────────────────────────
  { frameClass: 14, className: "Deca", frameType: 0, typeName: "Plus",
    motors: [
      { number: 1, testOrder: 1, rotation: "CCW", roll: 0, pitch: 0.5 },
      { number: 2, testOrder: 2, rotation: "CW", roll: -0.309, pitch: 0.4045 },
      { number: 3, testOrder: 3, rotation: "CCW", roll: -0.5, pitch: 0.1545 },
      { number: 4, testOrder: 4, rotation: "CW", roll: -0.5, pitch: -0.1545 },
      { number: 5, testOrder: 5, rotation: "CCW", roll: -0.309, pitch: -0.4045 },
      { number: 6, testOrder: 6, rotation: "CW", roll: 0, pitch: -0.5 },
      { number: 7, testOrder: 7, rotation: "CCW", roll: 0.309, pitch: -0.4045 },
      { number: 8, testOrder: 8, rotation: "CW", roll: 0.5, pitch: -0.1545 },
      { number: 9, testOrder: 9, rotation: "CCW", roll: 0.5, pitch: 0.1545 },
      { number: 10, testOrder: 10, rotation: "CW", roll: 0.309, pitch: 0.4045 },
    ],
  },
  { frameClass: 14, className: "Deca", frameType: 1, typeName: "X/ClockwiseX",
    motors: [
      { number: 1, testOrder: 1, rotation: "CCW", roll: -0.1545, pitch: 0.5 },
      { number: 2, testOrder: 2, rotation: "CW", roll: -0.4045, pitch: 0.309 },
      { number: 3, testOrder: 3, rotation: "CCW", roll: -0.5, pitch: 0 },
      { number: 4, testOrder: 4, rotation: "CW", roll: -0.4045, pitch: -0.309 },
      { number: 5, testOrder: 5, rotation: "CCW", roll: -0.1545, pitch: -0.5 },
      { number: 6, testOrder: 6, rotation: "CW", roll: 0.1545, pitch: -0.5 },
      { number: 7, testOrder: 7, rotation: "CCW", roll: 0.4045, pitch: -0.309 },
      { number: 8, testOrder: 8, rotation: "CW", roll: 0.5, pitch: 0 },
      { number: 9, testOrder: 9, rotation: "CCW", roll: 0.4045, pitch: 0.309 },
      { number: 10, testOrder: 10, rotation: "CW", roll: 0.1545, pitch: 0.5 },
    ],
  },
  { frameClass: 14, className: "Deca", frameType: 14, typeName: "X/ClockwiseX",
    motors: [
      { number: 1, testOrder: 1, rotation: "CCW", roll: -0.1545, pitch: 0.5 },
      { number: 2, testOrder: 2, rotation: "CW", roll: -0.4045, pitch: 0.309 },
      { number: 3, testOrder: 3, rotation: "CCW", roll: -0.5, pitch: 0 },
      { number: 4, testOrder: 4, rotation: "CW", roll: -0.4045, pitch: -0.309 },
      { number: 5, testOrder: 5, rotation: "CCW", roll: -0.1545, pitch: -0.5 },
      { number: 6, testOrder: 6, rotation: "CW", roll: 0.1545, pitch: -0.5 },
      { number: 7, testOrder: 7, rotation: "CCW", roll: 0.4045, pitch: -0.309 },
      { number: 8, testOrder: 8, rotation: "CW", roll: 0.5, pitch: 0 },
      { number: 9, testOrder: 9, rotation: "CCW", roll: 0.4045, pitch: 0.309 },
      { number: 10, testOrder: 10, rotation: "CW", roll: 0.1545, pitch: 0.5 },
    ],
  },
];

// ── Lookup ────────────────────────────────────────────────────

/** Key format: "class:type" e.g. "1:1" for Quad X. */
const layoutMap = new Map<string, FrameLayout>();
for (const layout of LAYOUTS) {
  layoutMap.set(`${layout.frameClass}:${layout.frameType}`, layout);
}

/**
 * Get motor layout for a frame class and type.
 * Falls back to type 0 (Plus) if specific type not found,
 * or null if frame class is entirely unknown.
 */
export function getMotorLayout(frameClass: number, frameType: number): FrameLayout | null {
  return layoutMap.get(`${frameClass}:${frameType}`)
    ?? layoutMap.get(`${frameClass}:0`)
    ?? null;
}

/** Get all available layouts. */
export function getAllLayouts(): FrameLayout[] {
  return LAYOUTS;
}

/**
 * Get available frame types for a given class.
 * Returns only types that have layout data, deduped by type number.
 */
export function getTypesForClass(frameClass: number): { value: number; name: string }[] {
  const seen = new Map<number, string>();
  for (const layout of LAYOUTS) {
    if (layout.frameClass === frameClass && !seen.has(layout.frameType)) {
      seen.set(layout.frameType, layout.typeName);
    }
  }
  return Array.from(seen.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([value, name]) => ({ value, name }));
}

// ── Motor Count Helpers ──────────────────────────────────────

/** Count actual motors (excludes servos). */
export function getMotorCount(layout: FrameLayout): number {
  return layout.motors.filter((m) => !m.isServo).length;
}

/** Count servos in a layout. */
export function getServoCount(layout: FrameLayout): number {
  return layout.motors.filter((m) => m.isServo).length;
}

/** Format motor count as human-readable string, e.g. "3 motors + 1 servo". */
export function formatMotorCount(layout: FrameLayout): string {
  const motors = getMotorCount(layout);
  const servos = getServoCount(layout);
  if (servos === 0) return `${motors} motors`;
  return `${motors} motor${motors !== 1 ? "s" : ""} + ${servos} servo${servos !== 1 ? "s" : ""}`;
}

// ── Geometry ─────────────────────────────────────────────────

/**
 * Body-frame position of a motor, in mixer-factor units: `forward` toward the
 * nose and `right` toward the right wing. The roll factor is negated because
 * ArduPilot's roll factor is -sin(angle), negative on the right.
 */
export function motorBodyPosition(motor: MotorPosition): { forward: number; right: number } {
  return { forward: motor.pitch, right: -motor.roll };
}

// ── Dedup Helpers ────────────────────────────────────────────

export interface UniqueFrameType {
  /** The representative frame type value (lowest number in the group). */
  value: number;
  /** Display name for this type. */
  name: string;
  /** Optional description from FRAME_TYPE_DESCRIPTIONS. */
  description?: string;
  /** All frame type numbers that share the same motor data. */
  duplicateTypes: number[];
}

/** Serialize motor data for comparison (ignores frameType/typeName). */
function motorDataKey(layout: FrameLayout): string {
  return layout.motors
    .map((m) => `${m.number}:${m.testOrder}:${m.rotation}:${m.roll}:${m.pitch}:${m.isServo ?? false}`)
    .sort()
    .join("|");
}

/**
 * Get unique frame types for a class, grouping types with identical motor data.
 * Collapses e.g. Tri from 19 entries to 2 (Default + Pitch Reversed),
 * and Y6 from 19 entries to 3 (Default + Y6B + Y6F).
 */
export function getUniqueTypesForClass(frameClass: number): UniqueFrameType[] {
  const classLayouts = LAYOUTS.filter((l) => l.frameClass === frameClass);
  if (classLayouts.length === 0) return [];

  // Group by motor data fingerprint
  const groups = new Map<string, FrameLayout[]>();
  for (const layout of classLayouts) {
    const key = motorDataKey(layout);
    const existing = groups.get(key);
    if (existing) {
      existing.push(layout);
    } else {
      groups.set(key, [layout]);
    }
  }

  // Convert to UniqueFrameType entries
  const result: UniqueFrameType[] = [];
  for (const layouts of groups.values()) {
    // Sort by frame type number, use the lowest as representative
    layouts.sort((a, b) => a.frameType - b.frameType);
    const rep = layouts[0];
    result.push({
      value: rep.frameType,
      name: rep.typeName,
      description: FRAME_TYPE_DESCRIPTIONS[rep.frameType],
      duplicateTypes: layouts.map((l) => l.frameType),
    });
  }

  return result.sort((a, b) => a.value - b.value);
}
