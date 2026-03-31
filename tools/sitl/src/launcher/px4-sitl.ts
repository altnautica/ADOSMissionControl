// px4-sitl.ts — PX4 SITL process launcher and lifecycle manager
// SPDX-License-Identifier: GPL-3.0-only

import { spawn, type ChildProcess } from 'node:child_process';
import { access, constants } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { homedir } from 'node:os';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Px4SitlConfig {
  px4Home: string;          // Path to PX4-Autopilot source (default ~/.px4)
  drones: number;           // Number of instances
  lat: number;              // Home latitude
  lon: number;              // Home longitude
  alt: number;              // Home altitude (default 0)
  heading: number;          // Home heading (default 0)
  speedup: number;          // Simulation speed (default 1)
  baseTcpPort: number;      // Base TCP port (default 14540, each instance +1)
}

export interface Px4SitlInstance {
  sysId: number;
  tcpPort: number;
  pid: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULTS: Px4SitlConfig = {
  px4Home: join(homedir(), '.px4'),
  drones: 1,
  lat: 12.9716,
  lon: 77.5946,
  alt: 0,
  heading: 0,
  speedup: 1,
  baseTcpPort: 14540,
};

const TCP_POLL_MS = 500;
const TCP_TIMEOUT_MS = 120_000;
const SIGKILL_TIMEOUT_MS = 5_000;

// ---------------------------------------------------------------------------
// Px4SitlLauncher
// ---------------------------------------------------------------------------

export class Px4SitlLauncher extends EventEmitter {
  private readonly config: Px4SitlConfig;
  private readonly children: ChildProcess[] = [];
  private instances: Px4SitlInstance[] = [];

  constructor(config: Partial<Px4SitlConfig> & Pick<Px4SitlConfig, 'lat' | 'lon'>) {
    super();
    this.config = { ...DEFAULTS, ...config };
  }

  /** Validate environment, spawn PX4 SITL processes, wait for TCP readiness. */
  async launch(): Promise<Px4SitlInstance[]> {
    const binaryPath = join(
      this.config.px4Home,
      'build',
      'px4_sitl_default',
      'bin',
      'px4',
    );

    const etcPath = join(
      this.config.px4Home,
      'build',
      'px4_sitl_default',
      'etc',
    );

    await access(binaryPath, constants.F_OK).catch(() => {
      throw new Error(
        `PX4 binary not found at ${binaryPath}. ` +
          `Run scripts/setup-px4.sh or set px4Home to the PX4-Autopilot source root.`,
      );
    });

    const { drones, lat, lon, alt, heading, speedup, baseTcpPort } = this.config;

    const ports: number[] = [];

    for (let i = 0; i < drones; i++) {
      const port = baseTcpPort + i;
      ports.push(port);

      const env: Record<string, string> = {
        ...process.env as Record<string, string>,
        PX4_SYS_AUTOSTART: '4001',
        PX4_SIM_MODEL: 'gz_x500',
        PX4_HOME_LAT: String(lat),
        PX4_HOME_LON: String(lon),
        PX4_HOME_ALT: String(alt),
        PX4_SIM_SPEED_FACTOR: String(speedup),
      };

      const args: string[] = [
        '-i', String(i),
        '-d', etcPath,
      ];

      const proc = spawn(binaryPath, args, {
        cwd: this.config.px4Home,
        stdio: ['ignore', 'pipe', 'pipe'],
        env,
      });

      this.children.push(proc);

      // Stream stdout / stderr line-by-line
      if (proc.stdout) {
        const rl = createInterface({ input: proc.stdout });
        rl.on('line', (line: string) => this.emit('stdout', `[px4:${i}] ${line}`));
      }
      if (proc.stderr) {
        const rl = createInterface({ input: proc.stderr });
        rl.on('line', (line: string) => this.emit('stderr', `[px4:${i}] ${line}`));
      }

      proc.on('exit', (code) => this.emit('exit', code ?? 1));
    }

    // Wait for every TCP port to become connectable
    await Promise.all(ports.map((p) => waitForTcpReady(p)));

    // Build instance metadata
    this.instances = ports.map((port, i) => ({
      sysId: i + 1,
      tcpPort: port,
      pid: this.children[i]?.pid ?? -1,
    }));

    this.emit('ready', { instances: this.instances });
    return this.instances;
  }

  /** Gracefully terminate all PX4 SITL child processes. */
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
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Poll a TCP port until a connection succeeds or the timeout expires.
 * Resolves when the port accepts a connection; rejects on timeout.
 */
function waitForTcpReady(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + TCP_TIMEOUT_MS;

    const attempt = () => {
      if (Date.now() > deadline) {
        reject(new Error(`TCP port ${port} not ready after ${TCP_TIMEOUT_MS}ms`));
        return;
      }

      const sock = createConnection({ port, host: '127.0.0.1' }, () => {
        sock.destroy();
        resolve();
      });

      sock.on('error', () => {
        sock.destroy();
        setTimeout(attempt, TCP_POLL_MS);
      });
    };

    attempt();
  });
}
