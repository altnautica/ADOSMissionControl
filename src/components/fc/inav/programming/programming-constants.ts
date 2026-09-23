/**
 * @module fc/inav/programming/programming-constants
 * @description iNav Programming framework vocabulary — logic-condition
 * operations and operand-source types, matching the firmware enums
 * (logicOperation_e, logicOperandType_e). Values 0..56 for operations
 * (57 is the LAST sentinel, not an operation); operand types 0..7.
 * @license GPL-3.0-only
 */

/** logicOperation_e — operation applied to operands A and B. */
export const LOGIC_OPERATIONS: Record<number, string> = {
  0: "TRUE",
  1: "EQUAL",
  2: "GREATER_THAN",
  3: "LOWER_THAN",
  4: "LOW",
  5: "MID",
  6: "HIGH",
  7: "AND",
  8: "OR",
  9: "XOR",
  10: "NAND",
  11: "NOR",
  12: "NOT",
  13: "STICKY",
  14: "ADD",
  15: "SUB",
  16: "MUL",
  17: "DIV",
  18: "GVAR_SET",
  19: "GVAR_INC",
  20: "GVAR_DEC",
  21: "PORT_SET",
  22: "OVERRIDE_ARMING_SAFETY",
  23: "OVERRIDE_THROTTLE_SCALE",
  24: "SWAP_ROLL_YAW",
  25: "SET_VTX_POWER_LEVEL",
  26: "INVERT_ROLL",
  27: "INVERT_PITCH",
  28: "INVERT_YAW",
  29: "OVERRIDE_THROTTLE",
  30: "SET_VTX_BAND",
  31: "SET_VTX_CHANNEL",
  32: "SET_OSD_LAYOUT",
  33: "SIN",
  34: "COS",
  35: "TAN",
  36: "MAP_INPUT",
  37: "MAP_OUTPUT",
  38: "RC_CHANNEL_OVERRIDE",
  39: "SET_HEADING_TARGET",
  40: "MODULUS",
  41: "LOITER_OVERRIDE",
  42: "SET_PROFILE",
  43: "MIN",
  44: "MAX",
  45: "FLIGHT_AXIS_ANGLE_OVERRIDE",
  46: "FLIGHT_AXIS_RATE_OVERRIDE",
  47: "EDGE",
  48: "DELAY",
  49: "TIMER",
  50: "DELTA",
  51: "APPROX_EQUAL",
  52: "LED_PIN_PWM",
  53: "DISABLE_GPS_FIX",
  54: "RESET_MAG_CALIBRATION",
  55: "SET_GIMBAL_SENSITIVITY",
  56: "OVERRIDE_MIN_GROUND_SPEED",
};

/** logicOperandType_e — where an operand's value comes from. */
export const LOGIC_OPERAND_TYPES: Record<number, string> = {
  0: "VALUE",
  1: "RC_CHANNEL",
  2: "FLIGHT",
  3: "FLIGHT_MODE",
  4: "LOGIC_CONDITION",
  5: "GVAR",
  6: "PROGRAMMING_PID",
  7: "WAYPOINTS",
};

export const LOGIC_OPERATION_OPTIONS = Object.entries(LOGIC_OPERATIONS).map(([k, v]) => ({
  value: k,
  label: v,
}));

export const LOGIC_OPERAND_TYPE_OPTIONS = Object.entries(LOGIC_OPERAND_TYPES).map(([k, v]) => ({
  value: k,
  label: v,
}));

/** Activator choices: -1 runs the condition unconditionally; 0..63 gate it on that logic condition. */
export const LOGIC_ACTIVATOR_OPTIONS = [
  { value: "-1", label: "Always" },
  ...Array.from({ length: 64 }, (_, i) => ({ value: String(i), label: `While LC ${i}` })),
];
