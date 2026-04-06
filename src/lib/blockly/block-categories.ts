/**
 * @module block-categories
 * @description Blockly toolbox category definitions for the ADOS visual editor.
 * @license GPL-3.0-only
 */

export interface ToolboxCategory {
  kind: "category";
  name: string;
  categorystyle: string;
  contents: ToolboxBlock[];
}

interface ToolboxBlock {
  kind: "block";
  type: string;
  fields?: Record<string, unknown>;
}

export const toolboxCategories: { kind: "categoryToolbox"; contents: ToolboxCategory[] } = {
  kind: "categoryToolbox",
  contents: [
    {
      kind: "category",
      name: "Movement",
      categorystyle: "movement_category",
      contents: [
        { kind: "block", type: "ados_takeoff", fields: { ALTITUDE: 10 } },
        { kind: "block", type: "ados_land" },
        { kind: "block", type: "ados_move_forward", fields: { DISTANCE: 5 } },
        { kind: "block", type: "ados_move_back", fields: { DISTANCE: 5 } },
        { kind: "block", type: "ados_move_left", fields: { DISTANCE: 5 } },
        { kind: "block", type: "ados_move_right", fields: { DISTANCE: 5 } },
        { kind: "block", type: "ados_move_up", fields: { DISTANCE: 5 } },
        { kind: "block", type: "ados_move_down", fields: { DISTANCE: 5 } },
        { kind: "block", type: "ados_rotate", fields: { DIRECTION: "LEFT", DEGREES: 90 } },
        { kind: "block", type: "ados_goto_gps" },
        { kind: "block", type: "ados_set_speed", fields: { SPEED: 5 } },
        { kind: "block", type: "ados_hover", fields: { SECONDS: 5 } },
        { kind: "block", type: "ados_return_home" },
      ],
    },
    {
      kind: "category",
      name: "Sensors",
      categorystyle: "sensor_category",
      contents: [
        { kind: "block", type: "ados_get_altitude" },
        { kind: "block", type: "ados_get_battery" },
        { kind: "block", type: "ados_get_gps_lat" },
        { kind: "block", type: "ados_get_gps_lon" },
        { kind: "block", type: "ados_get_heading" },
        { kind: "block", type: "ados_get_speed" },
        { kind: "block", type: "ados_get_distance_home" },
        { kind: "block", type: "ados_get_satellites" },
        { kind: "block", type: "ados_get_signal" },
        { kind: "block", type: "ados_is_armed" },
      ],
    },
    {
      kind: "category",
      name: "Camera",
      categorystyle: "camera_category",
      contents: [
        { kind: "block", type: "ados_take_photo" },
        { kind: "block", type: "ados_start_recording" },
        { kind: "block", type: "ados_stop_recording" },
        { kind: "block", type: "ados_set_camera_angle", fields: { ANGLE: -90 } },
      ],
    },
    {
      kind: "category",
      name: "Logic",
      categorystyle: "logic_category",
      contents: [
        { kind: "block", type: "controls_if" },
        { kind: "block", type: "logic_compare" },
        { kind: "block", type: "logic_operation" },
        { kind: "block", type: "logic_negate" },
        { kind: "block", type: "logic_boolean" },
        { kind: "block", type: "ados_compare_sensor" },
        { kind: "block", type: "ados_wait_until" },
        { kind: "block", type: "ados_print" },
      ],
    },
    {
      kind: "category",
      name: "Events",
      categorystyle: "event_category",
      contents: [
        { kind: "block", type: "ados_on_takeoff" },
        { kind: "block", type: "ados_on_land" },
        { kind: "block", type: "ados_on_low_battery" },
        { kind: "block", type: "ados_on_waypoint_reached" },
        { kind: "block", type: "ados_on_geofence" },
      ],
    },
    {
      kind: "category",
      name: "Loops",
      categorystyle: "loop_category",
      contents: [
        { kind: "block", type: "controls_repeat_ext" },
        { kind: "block", type: "controls_whileUntil" },
        { kind: "block", type: "ados_repeat_forever" },
        { kind: "block", type: "ados_wait_seconds", fields: { SECONDS: 1 } },
      ],
    },
    {
      kind: "category",
      name: "Variables",
      categorystyle: "variable_category",
      contents: [
        { kind: "block", type: "variables_get" },
        { kind: "block", type: "variables_set" },
        { kind: "block", type: "math_number" },
        { kind: "block", type: "text" },
        { kind: "block", type: "math_arithmetic" },
      ],
    },
  ],
};
