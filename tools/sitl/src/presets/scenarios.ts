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
}

// ---------------------------------------------------------------------------
// Scenario definitions
// ---------------------------------------------------------------------------

const SCENARIOS: Scenario[] = [
  {
    id: 'single-debug',
    name: 'Single Debug',
    description: 'Single drone for debugging and development.',
    preset: '7in-ados-reference',
    drones: 1,
    lat: 12.9716,
    lon: 77.5946,
    speedup: 1,
  },

  {
    id: 'formation-5',
    name: 'Formation (5)',
    description: 'Five-drone formation for multi-vehicle testing.',
    preset: '7in-ados-reference',
    drones: 5,
    lat: 12.9716,
    lon: 77.5946,
    speedup: 1,
  },

  {
    id: 'swarm-8',
    name: 'Swarm (8)',
    description: 'Eight-drone swarm for fleet management testing.',
    drones: 8,
    lat: 12.9716,
    lon: 77.5946,
    speedup: 1,
  },

  {
    id: 'wind-stress',
    name: 'Wind Stress',
    description: 'Wind stress test for navigation stability.',
    preset: '7in-long-range',
    drones: 3,
    lat: 12.9716,
    lon: 77.5946,
    speedup: 1,
    wind: { speed: 15, direction: 270 },
  },

  {
    id: 'battlenet-strike',
    name: 'BattleNet Strike',
    description: 'BattleNet strike formation with staggered altitudes.',
    preset: '7in-ados-reference',
    drones: 5,
    lat: 12.9716,
    lon: 77.5946,
    speedup: 1,
  },

  {
    id: 'long-range-mission',
    name: 'Long Range Mission',
    description: 'Long-range mission at 2x simulation speed.',
    preset: '7in-long-range',
    drones: 1,
    lat: 12.9716,
    lon: 77.5946,
    speedup: 2,
  },

  {
    id: 'heavy-lift-ops',
    name: 'Heavy Lift Ops',
    description: 'Heavy-lift cargo operations with mild wind.',
    preset: '10in-heavy-lifter',
    drones: 3,
    lat: 12.9716,
    lon: 77.5946,
    speedup: 1,
    wind: { speed: 5, direction: 180 },
  },

  {
    id: 'px4-validation',
    name: 'PX4 Validation',
    description: 'PX4 protocol validation with multiple vehicles.',
    drones: 3,
    lat: 12.9716,
    lon: 77.5946,
    speedup: 1,
  },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Get a scenario by ID. Returns undefined if not found. */
export function getScenario(id: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.id === id);
}

/** List all available scenarios. */
export function listScenarios(): Scenario[] {
  return SCENARIOS;
}

/** List all valid scenario IDs. */
export function listScenarioIds(): string[] {
  return SCENARIOS.map((s) => s.id);
}
