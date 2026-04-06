/**
 * @module ados-python-generator
 * @description Blockly to Python code generator for ADOS drone blocks.
 * Generates clean, runnable Python using the ADOS SDK.
 * @license GPL-3.0-only
 */

import { pythonGenerator, Order } from "blockly/python";
import type { Block } from "blockly";

// ── Movement Generators ────────────────────────────────────

pythonGenerator.forBlock["ados_takeoff"] = function (block: Block) {
  const alt = block.getFieldValue("ALTITUDE");
  return `await drone.takeoff(${alt})\n`;
};

pythonGenerator.forBlock["ados_land"] = function () {
  return `await drone.land()\n`;
};

pythonGenerator.forBlock["ados_move_forward"] = function (block: Block) {
  const dist = block.getFieldValue("DISTANCE");
  return `await drone.move_forward(${dist})\n`;
};

pythonGenerator.forBlock["ados_move_back"] = function (block: Block) {
  const dist = block.getFieldValue("DISTANCE");
  return `await drone.move_back(${dist})\n`;
};

pythonGenerator.forBlock["ados_move_left"] = function (block: Block) {
  const dist = block.getFieldValue("DISTANCE");
  return `await drone.move_left(${dist})\n`;
};

pythonGenerator.forBlock["ados_move_right"] = function (block: Block) {
  const dist = block.getFieldValue("DISTANCE");
  return `await drone.move_right(${dist})\n`;
};

pythonGenerator.forBlock["ados_move_up"] = function (block: Block) {
  const dist = block.getFieldValue("DISTANCE");
  return `await drone.move_up(${dist})\n`;
};

pythonGenerator.forBlock["ados_move_down"] = function (block: Block) {
  const dist = block.getFieldValue("DISTANCE");
  return `await drone.move_down(${dist})\n`;
};

pythonGenerator.forBlock["ados_rotate"] = function (block: Block) {
  const dir = block.getFieldValue("DIRECTION");
  const deg = block.getFieldValue("DEGREES");
  const fn = dir === "LEFT" ? "rotate_left" : "rotate_right";
  return `await drone.${fn}(${deg})\n`;
};

pythonGenerator.forBlock["ados_goto_gps"] = function (block: Block) {
  const lat = block.getFieldValue("LAT");
  const lon = block.getFieldValue("LON");
  const alt = block.getFieldValue("ALT");
  return `await drone.goto(${lat}, ${lon}, ${alt})\n`;
};

pythonGenerator.forBlock["ados_set_speed"] = function (block: Block) {
  const speed = block.getFieldValue("SPEED");
  return `await drone.set_speed(${speed})\n`;
};

pythonGenerator.forBlock["ados_hover"] = function (block: Block) {
  const secs = block.getFieldValue("SECONDS");
  return `await drone.hover(${secs})\n`;
};

pythonGenerator.forBlock["ados_return_home"] = function () {
  return `await drone.return_home()\n`;
};

// ── Sensor Generators ──────────────────────────────────────

function sensorGenerator(prop: string) {
  return function (): [string, number] {
    return [`drone.${prop}`, Order.MEMBER];
  };
}

pythonGenerator.forBlock["ados_get_altitude"] = sensorGenerator("altitude");
pythonGenerator.forBlock["ados_get_battery"] = sensorGenerator("battery");
pythonGenerator.forBlock["ados_get_gps_lat"] = sensorGenerator("gps_lat");
pythonGenerator.forBlock["ados_get_gps_lon"] = sensorGenerator("gps_lon");
pythonGenerator.forBlock["ados_get_heading"] = sensorGenerator("heading");
pythonGenerator.forBlock["ados_get_speed"] = sensorGenerator("speed");
pythonGenerator.forBlock["ados_get_distance_home"] = sensorGenerator("distance_home");
pythonGenerator.forBlock["ados_get_satellites"] = sensorGenerator("satellites");
pythonGenerator.forBlock["ados_get_signal"] = sensorGenerator("signal_strength");

pythonGenerator.forBlock["ados_is_armed"] = function (): [string, number] {
  return ["drone.is_armed", Order.MEMBER];
};

// ── Camera Generators ──────────────────────────────────────

pythonGenerator.forBlock["ados_take_photo"] = function () {
  return `await drone.camera.take_photo()\n`;
};

pythonGenerator.forBlock["ados_start_recording"] = function () {
  return `await drone.camera.start_recording()\n`;
};

pythonGenerator.forBlock["ados_stop_recording"] = function () {
  return `await drone.camera.stop_recording()\n`;
};

pythonGenerator.forBlock["ados_set_camera_angle"] = function (block: Block) {
  const angle = block.getFieldValue("ANGLE");
  return `await drone.camera.set_angle(${angle})\n`;
};

// ── Logic Generators ───────────────────────────────────────

pythonGenerator.forBlock["ados_wait_until"] = function (block: Block) {
  const condition = pythonGenerator.valueToCode(block, "CONDITION", Order.NONE) || "True";
  const timeout = block.getFieldValue("TIMEOUT");
  return `await drone.wait_until(lambda: ${condition}, timeout=${timeout})\n`;
};

pythonGenerator.forBlock["ados_compare_sensor"] = function (block: Block): [string, number] {
  const sensor = pythonGenerator.valueToCode(block, "SENSOR", Order.NONE) || "0";
  const op = block.getFieldValue("OP");
  const value = block.getFieldValue("VALUE");
  const opMap: Record<string, string> = {
    GT: ">", LT: "<", GTE: ">=", LTE: "<=", EQ: "==",
  };
  return [`${sensor} ${opMap[op]} ${value}`, Order.RELATIONAL];
};

// ── Event Generators ───────────────────────────────────────

function eventGenerator(eventName: string) {
  return function (block: Block) {
    const body = pythonGenerator.statementToCode(block, "DO") || "    pass\n";
    return `@drone.on("${eventName}")\nasync def on_${eventName}():\n${body}\n`;
  };
}

pythonGenerator.forBlock["ados_on_takeoff"] = eventGenerator("takeoff");
pythonGenerator.forBlock["ados_on_land"] = eventGenerator("land");
pythonGenerator.forBlock["ados_on_low_battery"] = eventGenerator("low_battery");
pythonGenerator.forBlock["ados_on_waypoint_reached"] = eventGenerator("waypoint_reached");
pythonGenerator.forBlock["ados_on_geofence"] = eventGenerator("geofence_breach");

// ── Loop Generators ────────────────────────────────────────

pythonGenerator.forBlock["ados_wait_seconds"] = function (block: Block) {
  const secs = block.getFieldValue("SECONDS");
  return `await drone.wait(${secs})\n`;
};

pythonGenerator.forBlock["ados_repeat_forever"] = function (block: Block) {
  const body = pythonGenerator.statementToCode(block, "DO") || "    pass\n";
  return `while True:\n${body}`;
};

// ── Print / Debug ──────────────────────────────────────────

pythonGenerator.forBlock["ados_print"] = function (block: Block) {
  const text = pythonGenerator.valueToCode(block, "TEXT", Order.NONE) || '""';
  return `print(${text})\n`;
};

/**
 * Generate a complete Python script from the workspace, wrapped with
 * the standard ADOS imports and async main() boilerplate.
 */
export function generateScript(workspace: { /* Blockly.Workspace */ getAllBlocks: (ordered: boolean) => unknown[] }): string {
  const rawCode = pythonGenerator.workspaceToCode(workspace as never);

  if (!rawCode.trim()) {
    return `"""ADOS Script (generated from Blockly)"""\nfrom ados import drone\n\nasync def main():\n    pass\n\nmain()\n`;
  }

  // Separate event handlers (top-level @drone.on decorators) from sequential code
  const lines = rawCode.split("\n");
  const eventBlocks: string[] = [];
  const mainLines: string[] = [];
  let inEvent = false;

  for (const line of lines) {
    if (line.startsWith('@drone.on("')) {
      inEvent = true;
      eventBlocks.push(line);
    } else if (inEvent && (line.startsWith("async def on_") || line.startsWith("    "))) {
      eventBlocks.push(line);
      if (line === "") inEvent = false;
    } else {
      inEvent = false;
      if (line.trim()) mainLines.push(line);
    }
  }

  const parts = [`"""ADOS Script (generated from Blockly)"""\nfrom ados import drone\n`];

  if (eventBlocks.length > 0) {
    parts.push(eventBlocks.join("\n") + "\n");
  }

  parts.push("async def main():");
  if (mainLines.length > 0) {
    for (const line of mainLines) {
      parts.push(`    ${line}`);
    }
  } else {
    parts.push("    pass");
  }
  parts.push("\nmain()\n");

  return parts.join("\n");
}
