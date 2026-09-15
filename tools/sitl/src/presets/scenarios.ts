// presets/scenarios.ts — Named test scenarios for common SITL testing workflows
// SPDX-License-Identifier: GPL-3.0-only

export interface Scenario {
  id: string;
  name: string;
  description: string;
  /** Build preset ID to use (from presets.ts). If omitted, uses default quad. */
  preset?: string;
  drones: number;
  lat: number;
  lon: number;
  speedup: number;
  wind?: { speed: number; direction: number };
  /** Vehicle type override. Only needed if not using a preset. */
  vehicle?: string;
  /** Launch with Gazebo 3D visualization. */
  withGazebo?: boolean;
  /** Gazebo world file name (without .sdf). */
  gazeboWorld?: string;
}

// Georeferenced origin of the real-terrain tile (from gazebo_terrain_generator).
const TERRAIN_REAL_LAT = 13.0233;
const TERRAIN_REAL_LON = 77.6676;

// Default origin for the non-Gazebo SITL scenarios.
const DEFAULT_SITL_LAT = 12.9716;
const DEFAULT_SITL_LON = 77.5946;

// ---------------------------------------------------------------------------
// Scenario definitions
// ---------------------------------------------------------------------------

const SCENARIOS: Scenario[] = [
  // --- Gazebo scenarios (real terrain) ---
  {
    id: 'terrain-gazebo',
    name: 'Real Terrain 3D',
    description: 'Real-world terrain with satellite imagery, 3D buildings, and camera feed.',
    preset: '7in-ados-reference',
    drones: 1,
    lat: TERRAIN_REAL_LAT,
    lon: TERRAIN_REAL_LON,
    speedup: 1,
    withGazebo: true,
    gazeboWorld: 'terrain-real',
  },

  {
    id: 'gazebo-urban',
    name: 'Urban 3D',
    description: 'Urban environment with buildings for inspection testing.',
    preset: '7in-ados-reference',
    drones: 1,
    lat: TERRAIN_REAL_LAT,
    lon: TERRAIN_REAL_LON,
    speedup: 1,
    withGazebo: true,
    gazeboWorld: 'urban-environment',
  },

  {
    id: 'gazebo-agriculture',
    name: 'Agriculture 3D',
    description: 'Agricultural field for spray/survey suite testing.',
    preset: '7in-ados-reference',
    drones: 1,
    lat: TERRAIN_REAL_LAT,
    lon: TERRAIN_REAL_LON,
    speedup: 1,
    withGazebo: true,
    gazeboWorld: 'agricultural-field',
  },

  // --- Plain SITL scenarios (no Gazebo, faster startup) ---
  {
    id: 'single-debug',
    name: 'Single Debug',
    description: 'Single drone for debugging and development. No 3D visualization.',
    preset: '7in-ados-reference',
    drones: 1,
    lat: DEFAULT_SITL_LAT,
    lon: DEFAULT_SITL_LON,
    speedup: 1,
  },

  {
    id: 'formation-5',
    name: 'Formation (5)',
    description: 'Five-drone formation for multi-vehicle testing.',
    preset: '7in-ados-reference',
    drones: 5,
    lat: DEFAULT_SITL_LAT,
    lon: DEFAULT_SITL_LON,
    speedup: 1,
  },

  {
    id: 'swarm-8',
    name: 'Swarm (8)',
    description: 'Eight-drone swarm for fleet management testing.',
    drones: 8,
    lat: DEFAULT_SITL_LAT,
    lon: DEFAULT_SITL_LON,
    speedup: 1,
  },

  {
    id: 'wind-stress',
    name: 'Wind Stress',
    description: 'Wind stress test for navigation stability.',
    preset: '7in-long-range',
    drones: 3,
    lat: DEFAULT_SITL_LAT,
    lon: DEFAULT_SITL_LON,
    speedup: 1,
    wind: { speed: 15, direction: 270 },
  },

  {
    id: 'long-range-mission',
    name: 'Long Range Mission',
    description: 'Long-range mission at 2x simulation speed.',
    preset: '7in-long-range',
    drones: 1,
    lat: DEFAULT_SITL_LAT,
    lon: DEFAULT_SITL_LON,
    speedup: 2,
  },

  {
    id: 'heavy-lift-ops',
    name: 'Heavy Lift Ops',
    description: 'Heavy-lift cargo operations with mild wind.',
    preset: '10in-heavy-lifter',
    drones: 3,
    lat: DEFAULT_SITL_LAT,
    lon: DEFAULT_SITL_LON,
    speedup: 1,
    wind: { speed: 5, direction: 180 },
  },

  {
    id: 'px4-validation',
    name: 'PX4 Validation',
    description: 'PX4 protocol validation with multiple vehicles.',
    drones: 3,
    lat: DEFAULT_SITL_LAT,
    lon: DEFAULT_SITL_LON,
    speedup: 1,
  },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getScenario(id: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.id === id);
}

export function listScenarios(): Scenario[] {
  return SCENARIOS;
}

export function listScenarioIds(): string[] {
  return SCENARIOS.map((s) => s.id);
}
