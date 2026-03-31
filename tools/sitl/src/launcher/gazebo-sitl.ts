// gazebo-sitl.ts — Gazebo Harmonic + ArduPilot SITL launcher
// SPDX-License-Identifier: GPL-3.0-only

import { spawn, type ChildProcess } from 'node:child_process';
import { access, constants } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface GazeboSitlConfig {
  ardupilotHome: string;
  gazeboPluginHome: string;
  world: string;                // SDF world file path
  vehicle: string;
  drones: number;
  lat: number;
  lon: number;
  alt: number;
  heading: number;
  speedup: number;
  baseTcpPort: number;
  headless: boolean;            // Run Gazebo without GUI (server only)
  extraArgs?: string[];
}

export interface GazeboSitlInstance {
  sysId: number;
  tcpPort: number;
  pid: number;
}

const DEFAULTS: GazeboSitlConfig = {
  ardupilotHome: join(homedir(), '.ardupilot'),
  gazeboPluginHome: join(homedir(), '.gazebo-ardupilot'),
  world: 'multi-copter',
  vehicle: 'ArduCopter',
  drones: 1,
  lat: 12.9716,
  lon: 77.5946,
  alt: 0,
  heading: 0,
  speedup: 1,
  baseTcpPort: 5760,
  headless: false,
};

const TCP_TIMEOUT_MS = 120_000;  // Gazebo takes longer to start
const SIGKILL_TIMEOUT_MS = 5_000;

export class GazeboSitlLauncher extends EventEmitter {
  private readonly config: GazeboSitlConfig;
  private readonly children: ChildProcess[] = [];
  private instances: GazeboSitlInstance[] = [];

  constructor(config: Partial<GazeboSitlConfig> & Pick<GazeboSitlConfig, 'lat' | 'lon'>) {
    super();
    this.config = { ...DEFAULTS, ...config };
  }

  async launch(): Promise<GazeboSitlInstance[]> {
    // Resolve world file path
    const worldPath = this.resolveWorldPath(this.config.world);
    await access(worldPath, constants.F_OK).catch(() => {
      throw new Error(`World file not found: ${worldPath}`);
    });

    // Verify ArduPilot is available
    const simVehiclePath = join(this.config.ardupilotHome, 'Tools', 'autotest', 'sim_vehicle.py');
    await access(simVehiclePath, constants.F_OK).catch(() => {
      throw new Error(`sim_vehicle.py not found at ${simVehiclePath}. Run setup-ardupilot.sh first.`);
    });

    // Step 1: Launch Gazebo server
    const gzArgs = this.config.headless
      ? ['sim', '-s', '-r', worldPath]
      : ['sim', '-r', worldPath];

    const gzProc = spawn('gz', gzArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        GZ_SIM_SYSTEM_PLUGIN_PATH: `${this.config.gazeboPluginHome}/build:${process.env.GZ_SIM_SYSTEM_PLUGIN_PATH || ''}`,
        GZ_SIM_RESOURCE_PATH: `${this.config.gazeboPluginHome}/models:${this.config.gazeboPluginHome}/worlds:${process.env.GZ_SIM_RESOURCE_PATH || ''}`,
      },
    });

    this.children.push(gzProc);

    if (gzProc.stdout) {
      const rl = createInterface({ input: gzProc.stdout });
      rl.on('line', (line: string) => this.emit('stdout', `[Gazebo] ${line}`));
    }
    if (gzProc.stderr) {
      const rl = createInterface({ input: gzProc.stderr });
      rl.on('line', (line: string) => this.emit('stderr', `[Gazebo] ${line}`));
    }

    // Wait for Gazebo to initialize (poll gz topic list)
    this.emit('stdout', 'Waiting for Gazebo to start...');
    await this.waitForGazebo();

    // Step 2: Launch ArduPilot SITL with Gazebo backend
    const { vehicle, drones, lat, lon, alt, heading, speedup, baseTcpPort } = this.config;
    const homeStr = `${lat},${lon},${alt},${heading}`;

    const sitlArgs: string[] = [
      simVehiclePath,
      '-v', vehicle,
      '--no-mavproxy',
      '-l', homeStr,
      '--speedup', String(speedup),
      '-f', 'gazebo-iris',
      '--model', 'JSON',
    ];

    // TCP output ports
    const ports: number[] = [];
    for (let i = 0; i < drones; i++) {
      const port = baseTcpPort + i * 10;
      ports.push(port);
      sitlArgs.push(`--out=tcpin:0.0.0.0:${port}`);
    }

    if (drones > 1) {
      sitlArgs.push('--count', String(drones), '--auto-sysid');
    }

    if (this.config.extraArgs?.length) {
      sitlArgs.push(...this.config.extraArgs);
    }

    const sitlProc = spawn('python3', sitlArgs, {
      cwd: this.config.ardupilotHome,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.children.push(sitlProc);

    if (sitlProc.stdout) {
      const rl = createInterface({ input: sitlProc.stdout });
      rl.on('line', (line: string) => this.emit('stdout', `[SITL] ${line}`));
    }
    if (sitlProc.stderr) {
      const rl = createInterface({ input: sitlProc.stderr });
      rl.on('line', (line: string) => this.emit('stderr', `[SITL] ${line}`));
    }

    // Wait for SITL TCP ports
    await Promise.all(ports.map((p) => waitForTcpReady(p, TCP_TIMEOUT_MS)));

    this.instances = ports.map((port, i) => ({
      sysId: i + 1,
      tcpPort: port,
      pid: sitlProc.pid ?? -1,
    }));

    this.emit('ready', { instances: this.instances });
    return this.instances;
  }

  async shutdown(): Promise<void> {
    const killPromises = this.children.map(
      (child) =>
        new Promise<void>((resolve) => {
          if (!child.pid || child.killed) {
            resolve();
            return;
          }
          const forceKill = setTimeout(() => {
            try { child.kill('SIGKILL'); } catch { /* already dead */ }
          }, SIGKILL_TIMEOUT_MS);
          child.once('exit', () => {
            clearTimeout(forceKill);
            resolve();
          });
          child.kill('SIGTERM');
        }),
    );
    await Promise.all(killPromises);
    this.children.length = 0;
    this.instances = [];
  }

  private resolveWorldPath(world: string): string {
    // If it's an absolute path or has .sdf extension, use as-is
    if (world.startsWith('/') || world.endsWith('.sdf')) {
      return world;
    }
    // Otherwise look in our gazebo/worlds/ directory
    const scriptDir = new URL('.', import.meta.url).pathname;
    return join(scriptDir, '..', '..', 'gazebo', 'worlds', `${world}.sdf`);
  }

  private async waitForGazebo(): Promise<void> {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      try {
        const proc = spawn('gz', ['topic', '-l'], { stdio: ['ignore', 'pipe', 'pipe'] });
        const output = await new Promise<string>((resolve) => {
          let data = '';
          proc.stdout?.on('data', (chunk: Buffer) => { data += chunk.toString(); });
          proc.on('close', () => resolve(data));
        });
        if (output.includes('/clock')) {
          this.emit('stdout', 'Gazebo is ready.');
          return;
        }
      } catch {
        // Gazebo not ready yet
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error('Gazebo failed to start within 60 seconds');
  }
}

function waitForTcpReady(port: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const attempt = () => {
      if (Date.now() > deadline) {
        reject(new Error(`TCP port ${port} not ready after ${timeoutMs}ms`));
        return;
      }
      const sock = createConnection({ port, host: '127.0.0.1' }, () => {
        sock.destroy();
        resolve();
      });
      sock.on('error', () => {
        sock.destroy();
        setTimeout(attempt, 500);
      });
    };
    attempt();
  });
}
