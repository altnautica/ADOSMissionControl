// index.ts — CLI entry point for altnautica-sitl
// SPDX-License-Identifier: GPL-3.0-only

import { SitlLauncher, type SitlConfig } from './launcher/sitl.js';
import { GazeboSitlLauncher } from './launcher/gazebo-sitl.js';
import { TcpWsBridge } from './bridge/tcp-ws.js';
import {
  Dashboard,
  parseHeartbeat,
  parseGlobalPositionInt,
} from './dashboard/terminal.js';
import { resolvePreset } from './presets/resolve.js';
import { listPresets } from './presets/presets.js';
import { getScenario, listScenarios } from './presets/scenarios.js';

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

interface CliArgs {
  drones: number;
  wsPort: number;
  lat: number;
  lon: number;
  speedup: number;
  wind?: { speed: number; direction: number };
  ardupilotHome?: string;
  vehicle: string;
  noDashboard: boolean;
  preset?: string;
  listPresets: boolean;
  scenario?: string;
  listScenarios: boolean;
  withGazebo: boolean;
  gazeboWorld: string;
  gazeboHeadless: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    drones: 1,
    wsPort: 5760,
    lat: 12.9716,
    lon: 77.5946,
    speedup: 1,
    vehicle: 'ArduCopter',
    noDashboard: false,
    listPresets: false,
    listScenarios: false,
    withGazebo: false,
    gazeboWorld: 'multi-copter',
    gazeboHeadless: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];

    switch (arg) {
      case '--drones':
        args.drones = parseInt(next, 10);
        i++;
        break;
      case '--ws-port':
        args.wsPort = parseInt(next, 10);
        i++;
        break;
      case '--lat':
        args.lat = parseFloat(next);
        i++;
        break;
      case '--lon':
        args.lon = parseFloat(next);
        i++;
        break;
      case '--speedup':
        args.speedup = parseFloat(next);
        i++;
        break;
      case '--wind': {
        const [speed, dir] = next.split(',').map(Number);
        args.wind = { speed, direction: dir };
        i++;
        break;
      }
      case '--ardupilot':
        args.ardupilotHome = next;
        i++;
        break;
      case '--vehicle':
        args.vehicle = next;
        i++;
        break;
      case '--no-dashboard':
        args.noDashboard = true;
        break;
      case '--preset':
        args.preset = next;
        i++;
        break;
      case '--list-presets':
        args.listPresets = true;
        break;
      case '--scenario':
        args.scenario = next;
        i++;
        break;
      case '--list-scenarios':
        args.listScenarios = true;
        break;
      case '--with-gazebo':
        args.withGazebo = true;
        break;
      case '--gazebo-world':
        args.gazeboWorld = next;
        i++;
        break;
      case '--gazebo-headless':
        args.gazeboHeadless = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
      default:
        console.error(`Unknown argument: ${arg}`);
        printHelp();
        process.exit(1);
    }
  }

  return args;
}

function printHelp(): void {
  console.log(`
altnautica-sitl — ArduPilot SITL launcher + TCP→WebSocket bridge

Usage:
  npx tsx src/index.ts [options]

Options:
  --drones <N>        Number of ArduCopter instances (default: 1)
  --ws-port <port>    WebSocket port for GCS connection (default: 5760)
  --lat <degrees>     Home latitude (default: 12.9716 — Bangalore)
  --lon <degrees>     Home longitude (default: 77.5946)
  --speedup <N>       Simulation speed multiplier (default: 1)
  --wind <spd,dir>    Wind speed (m/s) and direction (degrees)
  --ardupilot <path>  Path to ArduPilot source (default: ~/.ardupilot)
  --vehicle <type>    Vehicle type: ArduCopter, ArduPlane, ArduRover (default: ArduCopter)
  --preset <id>       Use a build preset (sets frame, params, vehicle)
  --list-presets      List all available build presets and exit
  --scenario <id>     Use a named test scenario (sets drones, preset, location, wind, speedup)
  --list-scenarios    List all available test scenarios and exit
  --no-dashboard      Disable terminal dashboard (log to stdout instead)
  -h, --help          Show this help

Examples:
  npx tsx src/index.ts                                # Single drone, Bangalore
  npx tsx src/index.ts --drones 3                     # Three drones
  npx tsx src/index.ts --preset 7in-long-range        # 7" LR build preset
  npx tsx src/index.ts --preset 10in-heavy-lifter     # Hexa heavy lifter
  npx tsx src/index.ts --list-presets                  # Show all presets
  npx tsx src/index.ts --scenario wind-stress          # Named test scenario
  npx tsx src/index.ts --list-scenarios                # Show all scenarios
  npx tsx src/index.ts --wind 5,180                   # 5 m/s wind from south
  npx tsx src/index.ts --lat 28.6139 --lon 77.2090    # New Delhi
`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function printPresets(): void {
  const presets = listPresets();
  console.log('\nAvailable build presets:\n');
  console.log(
    '  ' +
    'ID'.padEnd(24) +
    'Name'.padEnd(24) +
    'Frame'.padEnd(8) +
    'Motors'.padEnd(20) +
    'Cells'.padEnd(6) +
    'GPS',
  );
  console.log('  ' + '-'.repeat(86));
  for (const p of presets) {
    const motorCount = p.components.find((c) => c.type === 'motor')?.count ?? '?';
    const motorStr = `${motorCount}× ${p.specs.motorSize} ${p.specs.motorKv}KV`;
    console.log(
      '  ' +
      p.id.padEnd(24) +
      p.name.padEnd(24) +
      p.sitl.frame.padEnd(8) +
      motorStr.padEnd(20) +
      `${p.specs.cells}S`.padEnd(6) +
      (p.specs.hasGps ? 'Yes' : 'No'),
    );
  }
  console.log('');
}

function printScenarios(): void {
  const scenarios = listScenarios();
  console.log('\nAvailable test scenarios:\n');
  console.log(
    '  ' +
    'ID'.padEnd(24) +
    'Name'.padEnd(22) +
    'Drones'.padEnd(8) +
    'Preset'.padEnd(22) +
    'Description',
  );
  console.log('  ' + '-'.repeat(100));
  for (const s of scenarios) {
    console.log(
      '  ' +
      s.id.padEnd(24) +
      s.name.padEnd(22) +
      String(s.drones).padEnd(8) +
      (s.preset ?? '(default quad)').padEnd(22) +
      s.description,
    );
  }
  console.log('');
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv);

  // --- List presets --------------------------------------------------------
  if (cli.listPresets) {
    printPresets();
    process.exit(0);
  }

  // --- List scenarios ------------------------------------------------------
  if (cli.listScenarios) {
    printScenarios();
    process.exit(0);
  }

  // --- Resolve scenario (if specified) -------------------------------------
  if (cli.scenario) {
    const scenario = getScenario(cli.scenario);
    if (!scenario) {
      const ids = listScenarios().map((s) => s.id).join(', ');
      console.error(`\nUnknown scenario: "${cli.scenario}"\nAvailable scenarios: ${ids}\n`);
      process.exit(1);
    }
    cli.drones = scenario.drones;
    cli.lat = scenario.lat;
    cli.lon = scenario.lon;
    cli.speedup = scenario.speedup;
    if (scenario.wind) cli.wind = scenario.wind;
    if (scenario.preset) cli.preset = scenario.preset;
    if (scenario.vehicle) cli.vehicle = scenario.vehicle;
    if (scenario.withGazebo) cli.withGazebo = true;
    if (scenario.gazeboWorld) cli.gazeboWorld = scenario.gazeboWorld;
  }

  // --- Resolve preset (if specified) ---------------------------------------
  let presetName: string | undefined;
  let presetExtraArgs: string[] = [];

  if (cli.preset) {
    try {
      const resolved = resolvePreset(cli.preset);
      presetName = resolved.preset.name;
      presetExtraArgs = resolved.extraArgs;
      // Preset can override vehicle type
      cli.vehicle = resolved.vehicle;
    } catch (err) {
      console.error(`\n${(err as Error).message}\n`);
      process.exit(1);
    }
  }

  // --- Dashboard (optional) -----------------------------------------------
  const dashboard = cli.noDashboard
    ? null
    : new Dashboard({
        wsPort: cli.wsPort,
        vehicle: cli.vehicle,
        speedup: cli.speedup,
        presetName,
      });

  const log = (msg: string) => {
    if (dashboard) {
      dashboard.addLog(msg);
    } else {
      const ts = new Date().toLocaleTimeString('en-IN', { hour12: false });
      console.log(`[${ts}] ${msg}`);
    }
  };

  // --- SITL Launcher ------------------------------------------------------
  const baseLauncherConfig = {
    lat: cli.lat,
    lon: cli.lon,
    drones: cli.drones,
    speedup: cli.speedup,
    vehicle: cli.vehicle,
    wind: cli.wind,
    baseTcpPort: cli.wsPort,
    extraArgs: presetExtraArgs.length > 0 ? presetExtraArgs : undefined,
    ...(cli.ardupilotHome ? { ardupilotHome: cli.ardupilotHome } : {}),
  };

  const launcher = cli.withGazebo
    ? new GazeboSitlLauncher({
        ...baseLauncherConfig,
        world: cli.gazeboWorld,
        headless: cli.gazeboHeadless,
      })
    : new SitlLauncher(baseLauncherConfig);

  launcher.on('stdout', (line: string) => {
    // Only log interesting lines, filter out noisy sim output
    if (line.includes('Ready to fly') || line.includes('APM:') || line.includes('EKF') || line.includes('[Gazebo]') || line.includes('[SITL]')) {
      log(`SITL: ${line.trim()}`);
    }
  });

  launcher.on('stderr', (line: string) => {
    log(`SITL stderr: ${line.trim()}`);
  });

  const presetLabel = presetName ? ` [${presetName}]` : '';
  log(`Launching ${cli.vehicle} SITL (${cli.drones} drone${cli.drones > 1 ? 's' : ''})${presetLabel}...`);
  log(`Home: ${cli.lat.toFixed(4)}, ${cli.lon.toFixed(4)} | Speed: ${cli.speedup}x`);
  if (cli.wind) {
    log(`Wind: ${cli.wind.speed} m/s from ${cli.wind.direction}°`);
  }

  if (dashboard) {
    dashboard.start();
  }

  let instances;
  try {
    instances = await launcher.launch();
  } catch (err) {
    if (dashboard) dashboard.stop();
    console.error(`\nFailed to launch SITL: ${(err as Error).message}`);
    console.error('\nHave you run the setup script?');
    console.error('  cd tools/sitl && bash scripts/setup-ardupilot.sh\n');
    process.exit(1);
  }

  for (const inst of instances) {
    log(`Drone ${inst.sysId} ready on TCP port ${inst.tcpPort} (pid ${inst.pid})`);
  }

  // --- TCP→WS Bridge ------------------------------------------------------
  const bridge = new TcpWsBridge({
    wsPort: cli.wsPort,
    tcpInstances: instances.map((inst) => ({
      host: '127.0.0.1',
      port: inst.tcpPort,
      sysId: inst.sysId,
    })),
  });

  bridge.on('tcp-connected', ({ sysId, port }) => {
    log(`TCP bridge connected to 127.0.0.1:${port} (sysid=${sysId})`);
  });

  bridge.on('tcp-disconnected', ({ sysId }) => {
    log(`TCP disconnected (sysid=${sysId}), reconnecting...`);
  });

  bridge.on('ws-client-connected', ({ remoteAddress }) => {
    log(`GCS connected from ${remoteAddress}`);
    if (dashboard) dashboard.updateClientCount(bridge.wsClientCount);
  });

  bridge.on('ws-client-disconnected', ({ remoteAddress }) => {
    log(`GCS disconnected: ${remoteAddress}`);
    if (dashboard) dashboard.updateClientCount(bridge.wsClientCount);
  });

  // Peek at TCP data for dashboard drone state
  bridge.on('data', ({ sysId, data }) => {
    if (!dashboard) return;

    const hb = parseHeartbeat(data);
    if (hb) {
      dashboard.updateDroneState(hb.sysId, {
        mode: hb.mode,
        armed: hb.armed,
      });
    }

    const pos = parseGlobalPositionInt(data);
    if (pos) {
      dashboard.updateDroneState(pos.sysId, {
        lat: pos.lat,
        lon: pos.lon,
      });
    }
  });

  bridge.on('error', (err) => {
    // Suppress ECONNREFUSED during TCP reconnect (expected during SITL startup)
    if ((err as NodeJS.ErrnoException).code === 'ECONNREFUSED') return;
    log(`Bridge error: ${err.message}`);
  });

  bridge.start();

  // Print connection info block
  log('');
  log('=== ADOS SITL Ready ===');
  log('');
  log('MAVLink connections:');
  for (const inst of instances) {
    log(`  Drone #${inst.sysId}:  ws://localhost:${inst.tcpPort}`);
  }
  if (cli.withGazebo) {
    log('');
    log('Video (Gazebo camera):');
    log('  WHEP:      http://localhost:8889/gazebo-cam/whep');
    log('  WebSocket: ws://localhost:3001/ws/stream/gazebo-cam');
    log('  RTSP:      rtsp://localhost:8554/gazebo-cam');
  }
  log('');
  log('GCS:           http://localhost:4000');
  if (cli.withGazebo && !cli.gazeboHeadless) {
    log('Gazebo GUI:    (window should be open)');
  } else if (cli.withGazebo) {
    log('Gazebo GUI:    run "gz sim -g" to open');
  }
  log('');

  // --- Signal handling (clean shutdown) -----------------------------------
  let shuttingDown = false;

  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;

    log('Shutting down...');
    bridge.shutdown();
    await launcher.shutdown();
    if (dashboard) dashboard.stop();

    console.log('\nAll SITL processes stopped. Goodbye.');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
