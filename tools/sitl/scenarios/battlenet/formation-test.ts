// formation-test.ts — BattleNet formation flying accuracy test
// SPDX-License-Identifier: GPL-3.0-only
//
// Tests: line abreast, echelon right, wedge, diamond, column formations
// Verifies: followers maintain position relative to leader within tolerance
//
// Usage: npx tsx scenarios/battlenet/formation-test.ts [--port 5760] [--drones 5]

import { MavlinkClient, sleep, haversineDistance, offsetPosition } from './lib/mavlink-client.js';

// Formation types with relative offsets (meters) from leader
// Positive X = East, Positive Y = North
const FORMATIONS: Record<string, { name: string; offsets: { north: number; east: number }[] }> = {
  'line-abreast': {
    name: 'Line Abreast',
    offsets: [
      { north: 0, east: 0 },     // Leader
      { north: 0, east: -15 },   // Left 1
      { north: 0, east: 15 },    // Right 1
      { north: 0, east: -30 },   // Left 2
      { north: 0, east: 30 },    // Right 2
    ],
  },
  'echelon-right': {
    name: 'Echelon Right',
    offsets: [
      { north: 0, east: 0 },
      { north: -10, east: 10 },
      { north: -20, east: 20 },
      { north: -30, east: 30 },
      { north: -40, east: 40 },
    ],
  },
  'wedge': {
    name: 'Wedge',
    offsets: [
      { north: 0, east: 0 },
      { north: -10, east: -10 },
      { north: -10, east: 10 },
      { north: -20, east: -20 },
      { north: -20, east: 20 },
    ],
  },
  'diamond': {
    name: 'Diamond',
    offsets: [
      { north: 0, east: 0 },     // Point
      { north: -15, east: -10 }, // Left wing
      { north: -15, east: 10 },  // Right wing
      { north: -30, east: 0 },   // Tail
      { north: -15, east: 0 },   // Center
    ],
  },
  'column': {
    name: 'Column',
    offsets: [
      { north: 0, east: 0 },
      { north: -15, east: 0 },
      { north: -30, east: 0 },
      { north: -45, east: 0 },
      { north: -60, east: 0 },
    ],
  },
};

const TOLERANCE_M = 5; // Formation accuracy tolerance in meters
const FORMATION_ALT = 30; // Altitude in meters

async function parseCliArgs(): Promise<{ port: number; drones: number }> {
  let port = 5760;
  let drones = 5;
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === '--port') port = parseInt(process.argv[++i], 10);
    if (process.argv[i] === '--drones') drones = parseInt(process.argv[++i], 10);
  }
  return { port, drones };
}

async function testFormation(
  client: MavlinkClient,
  formationType: string,
  sysIds: number[],
  baseLat: number,
  baseLon: number,
): Promise<{ passed: boolean; maxError: number; errors: number[] }> {
  const formation = FORMATIONS[formationType];
  if (!formation) throw new Error(`Unknown formation: ${formationType}`);

  const droneCount = Math.min(sysIds.length, formation.offsets.length);
  console.log(`\n--- Testing ${formation.name} formation (${droneCount} drones) ---`);

  // Send GUIDED waypoints to position each drone
  for (let i = 0; i < droneCount; i++) {
    const offset = formation.offsets[i];
    const target = offsetPosition(baseLat, baseLon, offset.north, offset.east);
    await client.flyTo(sysIds[i], target.lat, target.lon, FORMATION_ALT);
    console.log(`[${sysIds[i]}] Target: ${offset.north}m N, ${offset.east}m E`);
  }

  // Wait for drones to settle (20 seconds)
  console.log('Waiting 20s for formation to stabilize...');
  await sleep(20_000);

  // Measure accuracy
  const errors: number[] = [];
  for (let i = 0; i < droneCount; i++) {
    const offset = formation.offsets[i];
    const expected = offsetPosition(baseLat, baseLon, offset.north, offset.east);
    const actual = client.getPosition(sysIds[i]);

    if (!actual) {
      console.log(`[${sysIds[i]}] No position data!`);
      errors.push(999);
      continue;
    }

    const error = haversineDistance(expected.lat, expected.lon, actual.lat, actual.lon);
    errors.push(error);
    const status = error <= TOLERANCE_M ? 'PASS' : 'FAIL';
    console.log(`[${sysIds[i]}] Error: ${error.toFixed(1)}m [${status}]`);
  }

  const maxError = Math.max(...errors);
  const passed = maxError <= TOLERANCE_M;
  console.log(`${formation.name}: ${passed ? 'PASSED' : 'FAILED'} (max error: ${maxError.toFixed(1)}m, tolerance: ${TOLERANCE_M}m)`);

  return { passed, maxError, errors };
}

async function main(): Promise<void> {
  const { port, drones } = await parseCliArgs();
  const client = new MavlinkClient(`ws://localhost:${port}`);

  console.log('=== BattleNet Formation Test ===\n');

  try {
    await client.connect();
    await client.waitForDrones(drones);

    const sysIds = Array.from({ length: drones }, (_, i) => i + 1);
    const baseLat = 12.9716;
    const baseLon = 77.5946;

    // Arm and takeoff all drones
    await client.armAndTakeoffAll(sysIds, FORMATION_ALT);
    await sleep(5000);

    // Test each formation
    const results: Record<string, { passed: boolean; maxError: number }> = {};

    for (const formationType of Object.keys(FORMATIONS)) {
      const result = await testFormation(client, formationType, sysIds, baseLat, baseLon);
      results[formationType] = result;
      await sleep(3000); // Brief pause between formations
    }

    // Summary
    console.log('\n=== Formation Test Results ===');
    let allPassed = true;
    for (const [type, result] of Object.entries(results)) {
      const status = result.passed ? 'PASS' : 'FAIL';
      console.log(`  ${FORMATIONS[type].name.padEnd(20)} ${status}  (max error: ${result.maxError.toFixed(1)}m)`);
      if (!result.passed) allPassed = false;
    }
    console.log(`\nOverall: ${allPassed ? 'ALL PASSED' : 'SOME FAILED'}`);

    // Land all drones
    console.log('\nLanding all drones...');
    for (const id of sysIds) {
      await client.setMode(id, 9); // LAND
      await sleep(500);
    }

    process.exit(allPassed ? 0 : 1);
  } finally {
    client.disconnect();
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
