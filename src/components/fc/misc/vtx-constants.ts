export const VTX_PARAM_NAMES = [
  "BF_VTX_TYPE",
  "BF_VTX_BAND",
  "BF_VTX_CHANNEL",
  "BF_VTX_POWER",
  "BF_VTX_PIT_MODE",
  "BF_VTX_FREQUENCY",
  "BF_VTX_LOW_POWER_DISARM",
] as const;

export const vtxParamNames = [...VTX_PARAM_NAMES];

/** Standard 5.8 GHz FPV bands — band name to channel frequencies (MHz) */
export const VTX_BANDS: Record<string, number[]> = {
  A: [5865, 5845, 5825, 5805, 5785, 5765, 5745, 5725],
  B: [5733, 5752, 5771, 5790, 5809, 5828, 5847, 5866],
  E: [5705, 5685, 5665, 5645, 5885, 5905, 5925, 5945],
  F: [5740, 5760, 5780, 5800, 5820, 5840, 5860, 5880],
  R: [5658, 5695, 5732, 5769, 5806, 5843, 5880, 5917],
};

/** Band index (1-based) to band letter */
export const BAND_INDEX_TO_LETTER: Record<number, string> = {
  1: "A",
  2: "B",
  3: "E",
  4: "F",
  5: "R",
};

export const BAND_LETTER_TO_INDEX: Record<string, number> = {
  A: 1,
  B: 2,
  E: 3,
  F: 4,
  R: 5,
};

/**
 * Betaflight vtxDevType_e (drivers/vtx_common.h). The FC detects the device
 * type; it is shown, never written.
 */
export const VTX_TYPE_LABELS: Record<number, string> = {
  0: "Unsupported",
  1: "RTC6705",
  3: "SmartAudio",
  4: "Tramp",
  5: "MSP",
  255: "No device detected",
};

/** Betaflight VTXDEV_UNKNOWN: no VTX device answered. */
export const VTX_TYPE_NONE = 255;

export const PIT_MODE_OPTIONS = [
  { value: "0", label: "0 — Off" },
  { value: "1", label: "1 — On (in-band)" },
  { value: "2", label: "2 — On (out-band)" },
];

export const LOW_POWER_DISARM_OPTIONS = [
  { value: "0", label: "0 — Off" },
  { value: "1", label: "1 — On" },
  { value: "2", label: "2 — Until first arm" },
];

export const BAND_NAMES = Object.keys(VTX_BANDS);
export const CHANNEL_COUNT = 8;
