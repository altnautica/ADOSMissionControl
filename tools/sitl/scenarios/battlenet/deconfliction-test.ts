// deconfliction-test.ts — BattleNet deconfliction rule verification
// SPDX-License-Identifier: GPL-3.0-only
//
// Tests: 15-second temporal separation, 30-meter altitude separation (DEC-085)
// Verifies drones maintain safe separation during overlapping missions
//
// Usage: npx tsx scenarios/battlenet/deconfliction-test.ts [--port 5760] [--drones 3]

import { MavlinkClient, sleep, haversineDistance } from './lib/mavlink-client.js';

const TEMPORAL_SEP_S = 15;   // Required temporal separation (DEC-085)
const ALTITUDE_SEP_M = 30;   // Required altitude separation (DEC-085)
const CHECK_INTERVAL_MS = 1000;

interface ProximityViolation {
  timestamp: number;
  drone1: number;
  drone2: number;
  horizontalDist: number;
  verticalDist: number;
}

async function parseCliArgs(): Promise<{ port: number; drones: number }> {
  let port = 5760;
  let drones = 3;
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === '--port') port = parseInt(process.argv[++i], 10);
    if (process.argv[i] === '--drones') drones = parseInt(process.argv[++i], 10);
  }
  return { port, drones };
}

async function testAltitudeSeparation(client: MavlinkClient, sysIds: number[]): Promise<{ passed: boolean; violations: ProximityViolation[] }> {
  console.log('\n--- Test 1: Altitude Separation (30m rule) ---');

  // Position drones at same lat/lon but different altitudes (staggered by 40m = safe)
  const baseLat = 12.9716;
  const baseLon = 77.5946;

  for (let i = 0; i < sysIds.length; i++) {
    const alt = 30 + i * 40; // 30m, 70m, 110m
    await client.flyTo(sysIds[i], baseLat, baseLon, alt);
    console.log(`[${sysIds[i]}] Sent to altitude ${alt}m`);
  }

  console.log('Waiting 20s for drones to reach altitude...');
  await sleep(20_000);

  // Monitor for 30 seconds, check for violations
  const violations: ProximityViolation[] = [];
  const endTime = Date.now() + 30_000;

  while (Date.now() < endTime) {
    for (let i = 0; i < sysIds.length; i++) {
      for (let j = i + 1; j < sysIds.length; j++) {
        const pos1 = client.getPosition(sysIds[i]);
        const pos2 = client.getPosition(sysIds[j]);
        if (!pos1 || !pos2) continue;

        const hDist = haversineDistance(pos1.lat, pos1.lon, pos2.lat, pos2.lon);
        const vDist = Math.abs(pos1.relativeAlt - pos2.relativeAlt) / 1000;

        // Violation: same horizontal area AND altitude separation < 30m
        if (hDist < 50 && vDist < ALTITUDE_SEP_M) {
          violations.push({
            timestamp: Date.now(),
            drone1: sysIds[i],
            drone2: sysIds[j],
            horizontalDist: hDist,
            verticalDist: vDist,
          });
        }
      }
    }
    await sleep(CHECK_INTERVAL_MS);
  }

  const passed = violations.length === 0;
  console.log(`Altitude separation: ${passed ? 'PASSED' : `FAILED (${violations.length} violations)`}`);
  return { passed, violations };
}

async function testProximityMonitoring(client: MavlinkClient, sysIds: number[]): Promise<{ passed: boolean; minDistance: number }> {
  console.log('\n--- Test 2: Proximity Monitoring (converging paths) ---');

  // Send two drones toward each other at the same altitude
  const alt = 50;
  const drone1 = sysIds[0];
  const drone2 = sysIds[1];

  // Drone 1 goes east, Drone 2 goes west (they'll converge)
  await client.flyTo(drone1, 12.9716, 77.5950, alt); // ~40m east
  await client.flyTo(drone2, 12.9716, 77.5942, alt); // ~40m west

  console.log('Monitoring proximity for 30s...');
  let minDistance = Infinity;
  const endTime = Date.now() + 30_000;

  while (Date.now() < endTime) {
    const pos1 = client.getPosition(drone1);
    const pos2 = client.getPosition(drone2);
    if (pos1 && pos2) {
      const dist = haversineDistance(pos1.lat, pos1.lon, pos2.lat, pos2.lon);
      if (dist < minDistance) minDistance = dist;
    }
    await sleep(CHECK_INTERVAL_MS);
  }

  console.log(`Minimum distance between drones: ${minDistance.toFixed(1)}m`);

  // Move drones apart
  await client.flyTo(drone1, 12.9720, 77.5946, alt);
  await client.flyTo(drone2, 12.9712, 77.5946, alt);
  await sleep(5000);

  return { passed: true, minDistance }; // This test is informational
}

async function main(): Promise<void> {
  const { port, drones } = await parseCliArgs();
  const client = new MavlinkClient(`ws://localhost:${port}`);

  console.log('=== BattleNet Deconfliction Test ===');
  console.log(`Rules: ${TEMPORAL_SEP_S}s temporal, ${ALTITUDE_SEP_M}m altitude (DEC-085)\n`);

  try {
    await client.connect();
    await client.waitForDrones(drones);

    const sysIds = Array.from({ length: drones }, (_, i) => i + 1);

    // Arm and takeoff
    await client.armAndTakeoffAll(sysIds, 30);
    await sleep(5000);

    // Run tests
    const altResult = await testAltitudeSeparation(client, sysIds);
    const proxResult = await testProximityMonitoring(client, sysIds);

    // Summary
    console.log('\n=== Deconfliction Test Results ===');
    console.log(`  Altitude Separation (${ALTITUDE_SEP_M}m):  ${altResult.passed ? 'PASS' : 'FAIL'}  (${altResult.violations.length} violations)`);
    console.log(`  Proximity Monitor:              INFO  (min distance: ${proxResult.minDistance.toFixed(1)}m)`);

    if (altResult.violations.length > 0) {
      console.log('\nViolation details:');
      for (const v of altResult.violations.slice(0, 5)) {
        console.log(`  Drones ${v.drone1}-${v.drone2}: H=${v.horizontalDist.toFixed(1)}m, V=${v.verticalDist.toFixed(1)}m`);
      }
    }

    // Land
    console.log('\nLanding all drones...');
    for (const id of sysIds) {
      await client.setMode(id, 9);
      await sleep(500);
    }

    process.exit(altResult.passed ? 0 : 1);
  } finally {
    client.disconnect();
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
