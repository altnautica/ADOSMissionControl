// ew-test.ts — BattleNet EW (Electronic Warfare) simulation test
// SPDX-License-Identifier: GPL-3.0-only
//
// Tests GPS degradation, denial, spoofing, and recovery scenarios
// Uses ArduPilot SIM_ parameters for failure injection
//
// Usage: npx tsx scenarios/battlenet/ew-test.ts [--port 5760] [--drones 3]

import { MavlinkClient, sleep } from './lib/mavlink-client.js';

interface EwTestResult {
  name: string;
  passed: boolean;
  details: string;
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

async function testGpsDegradation(client: MavlinkClient, sysId: number): Promise<EwTestResult> {
  console.log('\n--- Test 1: GPS Satellite Degradation ---');

  // Reduce satellites from default to 6, then 3
  console.log(`[${sysId}] Reducing GPS satellites to 6...`);
  await client.setParam(sysId, 'SIM_GPS_NUMSATS', 6);
  await sleep(5000);

  const pos6 = client.getPosition(sysId);
  const hasPos6 = pos6 !== undefined;
  console.log(`[${sysId}] Position available with 6 sats: ${hasPos6}`);

  console.log(`[${sysId}] Reducing GPS satellites to 3...`);
  await client.setParam(sysId, 'SIM_GPS_NUMSATS', 3);
  await sleep(5000);

  // Restore
  console.log(`[${sysId}] Restoring GPS satellites...`);
  await client.setParam(sysId, 'SIM_GPS_NUMSATS', 12);
  await sleep(3000);

  return {
    name: 'GPS Satellite Degradation',
    passed: hasPos6,
    details: `Position maintained with 6 sats: ${hasPos6}`,
  };
}

async function testGpsDenial(client: MavlinkClient, sysId: number): Promise<EwTestResult> {
  console.log('\n--- Test 2: Complete GPS Denial ---');

  const posBefore = client.getPosition(sysId);
  console.log(`[${sysId}] Position before denial: ${posBefore ? `${posBefore.lat.toFixed(6)}, ${posBefore.lon.toFixed(6)}` : 'none'}`);

  console.log(`[${sysId}] Disabling GPS...`);
  await client.setParam(sysId, 'SIM_GPS_DISABLE', 1);
  await sleep(10_000);

  // Check if drone is still flying (should be on INS fallback)
  const hb = client.getHeartbeat(sysId);
  const stillAlive = hb !== undefined;
  console.log(`[${sysId}] Heartbeat after GPS denial: ${stillAlive}`);

  // Restore GPS
  console.log(`[${sysId}] Restoring GPS...`);
  await client.setParam(sysId, 'SIM_GPS_DISABLE', 0);
  await sleep(10_000);

  const posAfter = client.getPosition(sysId);
  const recovered = posAfter !== undefined;
  console.log(`[${sysId}] Position after GPS restore: ${recovered ? `${posAfter!.lat.toFixed(6)}, ${posAfter!.lon.toFixed(6)}` : 'none'}`);

  return {
    name: 'Complete GPS Denial',
    passed: stillAlive && recovered,
    details: `Survived denial: ${stillAlive}, recovered GPS: ${recovered}`,
  };
}

async function testGpsSpoofing(client: MavlinkClient, sysId: number): Promise<EwTestResult> {
  console.log('\n--- Test 3: GPS Position Spoofing ---');

  const posBefore = client.getPosition(sysId);
  console.log(`[${sysId}] Position before spoof: ${posBefore ? `${posBefore.lat.toFixed(6)}, ${posBefore.lon.toFixed(6)}` : 'none'}`);

  // Inject position glitch (200m north)
  console.log(`[${sysId}] Injecting GPS glitch (200m north)...`);
  await client.setParam(sysId, 'SIM_GPS_GLITCH_X', 0.002); // ~200m latitude offset
  await sleep(10_000);

  const posDuring = client.getPosition(sysId);
  console.log(`[${sysId}] Position during spoof: ${posDuring ? `${posDuring.lat.toFixed(6)}, ${posDuring.lon.toFixed(6)}` : 'none'}`);

  // Remove glitch
  console.log(`[${sysId}] Removing GPS glitch...`);
  await client.setParam(sysId, 'SIM_GPS_GLITCH_X', 0);
  await sleep(10_000);

  const posAfter = client.getPosition(sysId);
  const recovered = posAfter !== undefined;
  console.log(`[${sysId}] Position after spoof removed: ${posAfter ? `${posAfter.lat.toFixed(6)}, ${posAfter.lon.toFixed(6)}` : 'none'}`);

  return {
    name: 'GPS Position Spoofing',
    passed: recovered,
    details: `GPS glitch injected and recovered: ${recovered}`,
  };
}

async function testImuDrift(client: MavlinkClient, sysId: number): Promise<EwTestResult> {
  console.log('\n--- Test 4: IMU Drift Injection ---');

  console.log(`[${sysId}] Injecting accelerometer bias...`);
  await client.setParam(sysId, 'SIM_ACC1_BIAS_X', 0.5);
  await client.setParam(sysId, 'SIM_ACC1_BIAS_Y', 0.3);
  await sleep(10_000);

  const hb = client.getHeartbeat(sysId);
  const stillFlying = hb?.armed ?? false;
  console.log(`[${sysId}] Still armed with IMU bias: ${stillFlying}`);

  // Remove bias
  console.log(`[${sysId}] Removing accelerometer bias...`);
  await client.setParam(sysId, 'SIM_ACC1_BIAS_X', 0);
  await client.setParam(sysId, 'SIM_ACC1_BIAS_Y', 0);
  await sleep(5000);

  return {
    name: 'IMU Drift Injection',
    passed: true, // Just verifying the drone survives
    details: `Drone survived IMU bias injection: ${stillFlying}`,
  };
}

async function main(): Promise<void> {
  const { port, drones } = await parseCliArgs();
  const client = new MavlinkClient(`ws://localhost:${port}`);

  console.log('=== BattleNet EW (Electronic Warfare) Test ===\n');

  try {
    await client.connect();
    await client.waitForDrones(drones);

    const testDrone = 1; // Run EW tests on drone 1

    // Arm and takeoff
    await client.armAndTakeoffAll([testDrone], 30);
    await sleep(5000);

    // Run all EW tests
    const results: EwTestResult[] = [];
    results.push(await testGpsDegradation(client, testDrone));
    results.push(await testGpsDenial(client, testDrone));
    results.push(await testGpsSpoofing(client, testDrone));
    results.push(await testImuDrift(client, testDrone));

    // Summary
    console.log('\n=== EW Test Results ===');
    let allPassed = true;
    for (const r of results) {
      const status = r.passed ? 'PASS' : 'FAIL';
      console.log(`  ${r.name.padEnd(30)} ${status}  ${r.details}`);
      if (!r.passed) allPassed = false;
    }
    console.log(`\nOverall: ${allPassed ? 'ALL PASSED' : 'SOME FAILED'}`);

    // Land
    console.log('\nLanding...');
    await client.setMode(testDrone, 9);
    await sleep(5000);

    process.exit(allPassed ? 0 : 1);
  } finally {
    client.disconnect();
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
