/**
 * Built-in sample scripts shown under the "Samples" group in the Scripts
 * library. These give a new user (and especially demo-mode evaluators)
 * something working to read and copy from on their very first launch.
 *
 * Covers 4 scripting tiers defined by DEC-056:
 *   - Python SDK (primary path)
 *   - Blockly visual editor (workspace JSON)
 *   - YAML missions
 *   - Tello-style text commands
 *
 * All samples are GPL-3.0-only along with the rest of the GCS.
 *
 * The same files are shipped on disk at `ADOSDroneAgent/samples/` so
 * power users running a real agent can grab them directly.
 *
 * @license GPL-3.0-only
 */

import type { ScriptInfo } from "./types";

// ── Python SDK samples (simple → advanced) ─────────────────────────

const HELLO_DRONE_PY = `"""Sample 1 — Hello drone.

The smallest possible ADOS SDK script. Connects to the local agent,
prints current telemetry, and exits. No motion, no state changes.

Run with: ados run hello_drone.py
"""

from ados import Drone


def main() -> None:
    drone = Drone.connect()
    print(f"Connected: {drone.vehicle_info}")
    print(f"Battery:   {drone.battery:.0f}%")
    print(f"GPS fix:   {drone.gps_fix_type}  sats={drone.satellites}")
    print(f"Position:  {drone.gps_lat:.6f}, {drone.gps_lon:.6f}")
    print(f"Altitude:  {drone.altitude:.1f} m")
    print(f"Armed:     {drone.is_armed}")


if __name__ == "__main__":
    main()
`;

const TAKEOFF_LAND_PY = `"""Sample 2 — Takeoff, hover, land.

Simplest actual flight. Waits for GPS lock, arms, takes off to 5 m,
hovers for 10 seconds, then lands. Respects the failsafe pre-checks.

Run with: ados run takeoff_land.py
"""

import asyncio
from ados import Drone


async def main() -> None:
    drone = await Drone.connect_async()

    await drone.wait_for_gps_lock()
    print("GPS ok, arming")

    await drone.arm()
    await drone.takeoff(altitude=5.0)

    print("Hovering 10s")
    await asyncio.sleep(10)

    await drone.land()
    print("Landed")


if __name__ == "__main__":
    asyncio.run(main())
`;

const SQUARE_MISSION_PY = `"""Sample 3 — Fly a 20 m square.

Shows loop-based flight control. The drone takes off, flies four
edges of a square using relative motion commands, then returns to
launch. Good starting point for understanding move + rotate.

Run with: ados run square_mission.py
"""

import asyncio
from ados import Drone


SIDE_LENGTH_M = 20
ALTITUDE_M = 5


async def main() -> None:
    drone = await Drone.connect_async()
    await drone.wait_for_gps_lock()

    await drone.arm()
    await drone.takeoff(ALTITUDE_M)

    for edge in range(4):
        print(f"Edge {edge + 1}/4")
        await drone.move_forward(SIDE_LENGTH_M)
        await drone.rotate_cw(90)

    await drone.return_to_launch()
    await drone.wait_until_disarmed()
    print("Mission complete")


if __name__ == "__main__":
    asyncio.run(main())
`;

const BATTERY_AWARE_SURVEY_PY = `"""Sample 4 — Battery-aware survey grid.

Advanced sample. Flies a lawn-mower survey grid over a polygon and
continuously monitors battery remaining. If battery drops below the
threshold it aborts the survey and returns to launch. Demonstrates
sensor reads, control flow, and graceful abort.

Run with: ados run battery_aware_survey.py
"""

import asyncio
from ados import Drone, patterns


POLYGON = [
    (12.9716, 77.5946),
    (12.9720, 77.5946),
    (12.9720, 77.5952),
    (12.9716, 77.5952),
]
ALTITUDE_M = 30
LINE_SPACING_M = 15
BATTERY_ABORT_PCT = 30


async def main() -> None:
    drone = await Drone.connect_async()
    await drone.wait_for_gps_lock()

    grid = patterns.survey_grid(
        polygon=POLYGON,
        altitude=ALTITUDE_M,
        line_spacing=LINE_SPACING_M,
    )
    print(f"Survey: {len(grid)} waypoints")

    await drone.arm()
    await drone.takeoff(ALTITUDE_M)

    for i, wp in enumerate(grid):
        if drone.battery < BATTERY_ABORT_PCT:
            print(f"Battery {drone.battery:.0f}% — aborting survey")
            break

        print(f"WP {i + 1}/{len(grid)}: lat={wp.lat:.6f} lon={wp.lon:.6f}")
        await drone.goto(wp.lat, wp.lon, ALTITUDE_M)
        await drone.capture_photo()

    await drone.return_to_launch()
    print("Done")


if __name__ == "__main__":
    asyncio.run(main())
`;

// ── Blockly samples — workspace JSON state ─────────────────────────
//
// These are simplified Blockly serialized workspace trees. The full
// BlocklyEditor component hydrates from this JSON on open.

const BLOCKLY_TAKEOFF_LAND = JSON.stringify(
  {
    blocks: {
      languageVersion: 0,
      blocks: [
        {
          type: "ados_takeoff",
          x: 40,
          y: 40,
          fields: { ALTITUDE: 5 },
          next: {
            block: {
              type: "controls_whileUntil",
              fields: { MODE: "WHILE" },
              inputs: {
                BOOL: {
                  block: {
                    type: "ados_compare_sensor",
                    fields: { SENSOR: "altitude", OP: "LT", VALUE: 4.8 },
                  },
                },
              },
              next: {
                block: {
                  type: "ados_wait_seconds",
                  fields: { SECONDS: 5 },
                  next: { block: { type: "ados_land" } },
                },
              },
            },
          },
        },
      ],
    },
  },
  null,
  2,
);

const BLOCKLY_SQUARE_PATTERN = JSON.stringify(
  {
    blocks: {
      languageVersion: 0,
      blocks: [
        {
          type: "ados_takeoff",
          x: 40,
          y: 40,
          fields: { ALTITUDE: 5 },
          next: {
            block: {
              type: "controls_repeat_ext",
              inputs: {
                TIMES: { block: { type: "math_number", fields: { NUM: 4 } } },
                DO: {
                  block: {
                    type: "ados_move_forward",
                    fields: { DISTANCE: 20 },
                    next: {
                      block: { type: "ados_rotate", fields: { DEGREES: 90, DIRECTION: "CW" } },
                    },
                  },
                },
              },
              next: { block: { type: "ados_return_home" } },
            },
          },
        },
      ],
    },
  },
  null,
  2,
);

const BLOCKLY_LOW_BATTERY_RTL = JSON.stringify(
  {
    blocks: {
      languageVersion: 0,
      blocks: [
        {
          type: "ados_on_low_battery",
          x: 40,
          y: 40,
          fields: { THRESHOLD: 25 },
          inputs: {
            DO: {
              block: {
                type: "ados_print",
                fields: { TEXT: "Low battery — returning home" },
                next: { block: { type: "ados_return_home" } },
              },
            },
          },
        },
      ],
    },
  },
  null,
  2,
);

// ── YAML mission samples ───────────────────────────────────────────

const YAML_SIMPLE_WAYPOINTS = `# Sample — Simple 3-waypoint mission
# Takeoff, hit three waypoints around Bangalore, return to launch.

mission:
  name: simple_waypoints
  default_speed: 5.0   # m/s
  rtl_on_complete: true

  waypoints:
    - type: takeoff
      altitude: 10

    - type: waypoint
      lat: 12.9716
      lon: 77.5946
      alt: 10

    - type: waypoint
      lat: 12.9720
      lon: 77.5950
      alt: 15

    - type: waypoint
      lat: 12.9716
      lon: 77.5952
      alt: 10

    - type: return_to_launch
`;

const YAML_SURVEY_GRID = `# Sample — Lawn-mower survey grid
# Uses the survey suite pattern generator. Flies a grid over the
# polygon at 30 m AGL with 15 m line spacing and 75% overlap.

mission:
  name: survey_demo
  suite: survey

  pattern:
    type: survey_grid
    polygon:
      - { lat: 12.9716, lon: 77.5946 }
      - { lat: 12.9720, lon: 77.5946 }
      - { lat: 12.9720, lon: 77.5952 }
      - { lat: 12.9716, lon: 77.5952 }
    altitude: 30
    line_spacing: 15
    overlap_front: 0.80
    overlap_side: 0.75
    heading: 0

  camera:
    trigger: distance
    trigger_distance: 10

  actions:
    on_start: takeoff
    on_complete: return_to_launch
`;

// ── Tello-style text command samples ───────────────────────────────

const TEXT_BASIC = `# Sample — basic text command routine
# Each line is a single Tello-style command. Runs top-to-bottom.

arm
takeoff
up 100
forward 200
ccw 90
forward 200
land
`;

const TEXT_DEMO_ROUTINE = `# Sample — short demo routine for live audiences
# 30-second showcase. Requires open area, props on, battery > 50%.

battery?
arm
takeoff
up 150
cw 360
down 50
forward 100
back 100
ccw 180
land
`;

// ── Sample catalog ─────────────────────────────────────────────────

const now = () => new Date().toISOString();

/**
 * All built-in samples exposed as ScriptInfo records. The `suite`
 * field is used as a group label by the existing ScriptLibrary.
 */
export function getBuiltInSamples(): ScriptInfo[] {
  return [
    // Python — simple → advanced
    {
      id: "sample-py-1",
      name: "01 — Hello drone.py",
      content: HELLO_DRONE_PY,
      suite: "Samples · Python",
      lastModified: now(),
    },
    {
      id: "sample-py-2",
      name: "02 — Takeoff and land.py",
      content: TAKEOFF_LAND_PY,
      suite: "Samples · Python",
      lastModified: now(),
    },
    {
      id: "sample-py-3",
      name: "03 — Square mission.py",
      content: SQUARE_MISSION_PY,
      suite: "Samples · Python",
      lastModified: now(),
    },
    {
      id: "sample-py-4",
      name: "04 — Battery-aware survey.py",
      content: BATTERY_AWARE_SURVEY_PY,
      suite: "Samples · Python",
      lastModified: now(),
    },

    // Blockly
    {
      id: "sample-blk-1",
      name: "01 — Takeoff and land.blockly",
      content: BLOCKLY_TAKEOFF_LAND,
      suite: "Samples · Blockly",
      lastModified: now(),
    },
    {
      id: "sample-blk-2",
      name: "02 — Square pattern.blockly",
      content: BLOCKLY_SQUARE_PATTERN,
      suite: "Samples · Blockly",
      lastModified: now(),
    },
    {
      id: "sample-blk-3",
      name: "03 — Low battery RTL.blockly",
      content: BLOCKLY_LOW_BATTERY_RTL,
      suite: "Samples · Blockly",
      lastModified: now(),
    },

    // YAML missions
    {
      id: "sample-yml-1",
      name: "01 — Simple waypoints.yaml",
      content: YAML_SIMPLE_WAYPOINTS,
      suite: "Samples · YAML",
      lastModified: now(),
    },
    {
      id: "sample-yml-2",
      name: "02 — Survey grid.yaml",
      content: YAML_SURVEY_GRID,
      suite: "Samples · YAML",
      lastModified: now(),
    },

    // Text command samples
    {
      id: "sample-txt-1",
      name: "01 — Basic routine.txt",
      content: TEXT_BASIC,
      suite: "Samples · Text",
      lastModified: now(),
    },
    {
      id: "sample-txt-2",
      name: "02 — Demo routine.txt",
      content: TEXT_DEMO_ROUTINE,
      suite: "Samples · Text",
      lastModified: now(),
    },
  ];
}
