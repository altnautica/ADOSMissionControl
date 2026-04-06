/**
 * @module ados-blocks
 * @description Custom ADOS block definitions for the Blockly visual editor.
 * 46 blocks across 7 categories: Movement, Sensors, Camera, Logic, Events, Loops, Variables.
 * @license GPL-3.0-only
 */

import * as Blockly from "blockly";

// ── Movement Blocks (12) ────────────────────────────────────

Blockly.Blocks["ados_takeoff"] = {
  init(this: Blockly.Block) {
    this.appendDummyInput()
      .appendField("takeoff to")
      .appendField(new Blockly.FieldNumber(10, 1, 500, 1), "ALTITUDE")
      .appendField("m");
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setStyle("movement_blocks");
    this.setTooltip("Take off to the specified altitude in meters");
  },
};

Blockly.Blocks["ados_land"] = {
  init(this: Blockly.Block) {
    this.appendDummyInput().appendField("land");
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setStyle("movement_blocks");
    this.setTooltip("Land at the current position");
  },
};

Blockly.Blocks["ados_move_forward"] = {
  init(this: Blockly.Block) {
    this.appendDummyInput()
      .appendField("move forward")
      .appendField(new Blockly.FieldNumber(5, 0.5, 500, 0.5), "DISTANCE")
      .appendField("m");
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setStyle("movement_blocks");
    this.setTooltip("Move forward by the specified distance");
  },
};

Blockly.Blocks["ados_move_back"] = {
  init(this: Blockly.Block) {
    this.appendDummyInput()
      .appendField("move back")
      .appendField(new Blockly.FieldNumber(5, 0.5, 500, 0.5), "DISTANCE")
      .appendField("m");
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setStyle("movement_blocks");
    this.setTooltip("Move backward by the specified distance");
  },
};

Blockly.Blocks["ados_move_left"] = {
  init(this: Blockly.Block) {
    this.appendDummyInput()
      .appendField("move left")
      .appendField(new Blockly.FieldNumber(5, 0.5, 500, 0.5), "DISTANCE")
      .appendField("m");
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setStyle("movement_blocks");
    this.setTooltip("Move left by the specified distance");
  },
};

Blockly.Blocks["ados_move_right"] = {
  init(this: Blockly.Block) {
    this.appendDummyInput()
      .appendField("move right")
      .appendField(new Blockly.FieldNumber(5, 0.5, 500, 0.5), "DISTANCE")
      .appendField("m");
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setStyle("movement_blocks");
    this.setTooltip("Move right by the specified distance");
  },
};

Blockly.Blocks["ados_move_up"] = {
  init(this: Blockly.Block) {
    this.appendDummyInput()
      .appendField("move up")
      .appendField(new Blockly.FieldNumber(5, 0.5, 200, 0.5), "DISTANCE")
      .appendField("m");
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setStyle("movement_blocks");
    this.setTooltip("Ascend by the specified distance");
  },
};

Blockly.Blocks["ados_move_down"] = {
  init(this: Blockly.Block) {
    this.appendDummyInput()
      .appendField("move down")
      .appendField(new Blockly.FieldNumber(5, 0.5, 200, 0.5), "DISTANCE")
      .appendField("m");
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setStyle("movement_blocks");
    this.setTooltip("Descend by the specified distance");
  },
};

Blockly.Blocks["ados_rotate"] = {
  init(this: Blockly.Block) {
    this.appendDummyInput()
      .appendField("rotate")
      .appendField(new Blockly.FieldDropdown([["left", "LEFT"], ["right", "RIGHT"]]), "DIRECTION")
      .appendField(new Blockly.FieldNumber(90, 1, 360, 1), "DEGREES")
      .appendField("degrees");
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setStyle("movement_blocks");
    this.setTooltip("Rotate in the specified direction by degrees");
  },
};

Blockly.Blocks["ados_goto_gps"] = {
  init(this: Blockly.Block) {
    this.appendDummyInput()
      .appendField("go to GPS");
    this.appendDummyInput()
      .appendField("  lat")
      .appendField(new Blockly.FieldNumber(0, -90, 90, 0.000001), "LAT")
      .appendField("lon")
      .appendField(new Blockly.FieldNumber(0, -180, 180, 0.000001), "LON");
    this.appendDummyInput()
      .appendField("  alt")
      .appendField(new Blockly.FieldNumber(50, 1, 500, 1), "ALT")
      .appendField("m");
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setStyle("movement_blocks");
    this.setTooltip("Fly to a specific GPS coordinate");
  },
};

Blockly.Blocks["ados_set_speed"] = {
  init(this: Blockly.Block) {
    this.appendDummyInput()
      .appendField("set speed")
      .appendField(new Blockly.FieldNumber(5, 0.5, 30, 0.5), "SPEED")
      .appendField("m/s");
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setStyle("movement_blocks");
    this.setTooltip("Set the flight speed");
  },
};

Blockly.Blocks["ados_hover"] = {
  init(this: Blockly.Block) {
    this.appendDummyInput()
      .appendField("hover for")
      .appendField(new Blockly.FieldNumber(5, 1, 300, 1), "SECONDS")
      .appendField("seconds");
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setStyle("movement_blocks");
    this.setTooltip("Hold position for the specified duration");
  },
};

Blockly.Blocks["ados_return_home"] = {
  init(this: Blockly.Block) {
    this.appendDummyInput().appendField("return to home");
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setStyle("movement_blocks");
    this.setTooltip("Return to the launch position and land");
  },
};

// ── Sensor Blocks (10) ─────────────────────────────────────

function createSensorBlock(type: string, label: string, tooltip: string) {
  Blockly.Blocks[type] = {
    init(this: Blockly.Block) {
      this.appendDummyInput().appendField(label);
      this.setOutput(true, "Number");
      this.setStyle("sensor_blocks");
      this.setTooltip(tooltip);
    },
  };
}

createSensorBlock("ados_get_altitude", "altitude (m)", "Current altitude in meters AGL");
createSensorBlock("ados_get_battery", "battery (%)", "Current battery percentage");
createSensorBlock("ados_get_gps_lat", "GPS latitude", "Current GPS latitude");
createSensorBlock("ados_get_gps_lon", "GPS longitude", "Current GPS longitude");
createSensorBlock("ados_get_heading", "heading (deg)", "Current heading in degrees (0-360)");
createSensorBlock("ados_get_speed", "speed (m/s)", "Current ground speed");
createSensorBlock("ados_get_distance_home", "distance to home (m)", "Distance from home position in meters");
createSensorBlock("ados_get_satellites", "GPS satellites", "Number of GPS satellites visible");
createSensorBlock("ados_get_signal", "signal strength (%)", "Radio signal strength percentage");

Blockly.Blocks["ados_is_armed"] = {
  init(this: Blockly.Block) {
    this.appendDummyInput().appendField("is armed?");
    this.setOutput(true, "Boolean");
    this.setStyle("sensor_blocks");
    this.setTooltip("Returns true if the drone is armed");
  },
};

// ── Camera Blocks (4) ──────────────────────────────────────

Blockly.Blocks["ados_take_photo"] = {
  init(this: Blockly.Block) {
    this.appendDummyInput().appendField("take photo");
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setStyle("camera_blocks");
    this.setTooltip("Capture a single photo");
  },
};

Blockly.Blocks["ados_start_recording"] = {
  init(this: Blockly.Block) {
    this.appendDummyInput().appendField("start video recording");
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setStyle("camera_blocks");
    this.setTooltip("Start recording video");
  },
};

Blockly.Blocks["ados_stop_recording"] = {
  init(this: Blockly.Block) {
    this.appendDummyInput().appendField("stop video recording");
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setStyle("camera_blocks");
    this.setTooltip("Stop recording video");
  },
};

Blockly.Blocks["ados_set_camera_angle"] = {
  init(this: Blockly.Block) {
    this.appendDummyInput()
      .appendField("set camera angle")
      .appendField(new Blockly.FieldNumber(-90, -90, 30, 5), "ANGLE")
      .appendField("degrees");
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setStyle("camera_blocks");
    this.setTooltip("Set the gimbal camera angle (-90 = straight down, 0 = horizon)");
  },
};

// ── Logic Blocks (3 custom + Blockly built-ins) ────────────

Blockly.Blocks["ados_wait_until"] = {
  init(this: Blockly.Block) {
    this.appendValueInput("CONDITION")
      .setCheck("Boolean")
      .appendField("wait until");
    this.appendDummyInput()
      .appendField("timeout")
      .appendField(new Blockly.FieldNumber(30, 1, 300, 1), "TIMEOUT")
      .appendField("s");
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setStyle("logic_blocks");
    this.setTooltip("Wait until the condition is true or timeout expires");
  },
};

Blockly.Blocks["ados_compare_sensor"] = {
  init(this: Blockly.Block) {
    this.appendValueInput("SENSOR")
      .setCheck("Number")
      .appendField("check");
    this.appendDummyInput()
      .appendField(new Blockly.FieldDropdown([
        [">", "GT"], ["<", "LT"], [">=", "GTE"], ["<=", "LTE"], ["==", "EQ"],
      ]), "OP")
      .appendField(new Blockly.FieldNumber(0), "VALUE");
    this.setOutput(true, "Boolean");
    this.setStyle("logic_blocks");
    this.setTooltip("Compare a sensor value against a threshold");
  },
};

// ── Event Blocks (5) ───────────────────────────────────────

function createEventBlock(type: string, label: string, tooltip: string) {
  Blockly.Blocks[type] = {
    init(this: Blockly.Block) {
      this.appendDummyInput().appendField(label);
      this.appendStatementInput("DO").appendField("do");
      this.setStyle("event_blocks");
      this.setTooltip(tooltip);
    },
  };
}

createEventBlock("ados_on_takeoff", "when takeoff", "Run this code when the drone takes off");
createEventBlock("ados_on_land", "when landed", "Run this code when the drone lands");
createEventBlock("ados_on_low_battery", "when battery low", "Run this code when battery drops below 20%");
createEventBlock("ados_on_waypoint_reached", "when waypoint reached", "Run this code when a waypoint is reached");
createEventBlock("ados_on_geofence", "when geofence breached", "Run this code when geofence boundary is crossed");

// ── Loop Blocks (2 custom + Blockly built-ins) ────────────

Blockly.Blocks["ados_wait_seconds"] = {
  init(this: Blockly.Block) {
    this.appendDummyInput()
      .appendField("wait")
      .appendField(new Blockly.FieldNumber(1, 0.1, 300, 0.1), "SECONDS")
      .appendField("seconds");
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setStyle("loop_blocks");
    this.setTooltip("Pause execution for the specified duration");
  },
};

Blockly.Blocks["ados_repeat_forever"] = {
  init(this: Blockly.Block) {
    this.appendDummyInput().appendField("repeat forever");
    this.appendStatementInput("DO").appendField("do");
    this.setPreviousStatement(true, null);
    this.setStyle("loop_blocks");
    this.setTooltip("Repeat the contained blocks forever (until mission ends)");
  },
};

// ── Print / Debug ──────────────────────────────────────────

Blockly.Blocks["ados_print"] = {
  init(this: Blockly.Block) {
    this.appendValueInput("TEXT")
      .appendField("print");
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setStyle("logic_blocks");
    this.setTooltip("Print a message to the script console");
  },
};
