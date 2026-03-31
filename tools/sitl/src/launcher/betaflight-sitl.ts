// betaflight-sitl.ts — Betaflight SITL process launcher and lifecycle manager
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

export interface BetaflightSitlConfig {
  betaflightHome: string;   // Path to betaflight source (default ~/.betaflight)
  tcpPort: number;          // MSP TCP port (default 5761)
}

export interface BetaflightSitlInstance {
  sysId: number;
  tcpPort: number;
  pid: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULTS: BetaflightSitlConfig = {
  betaflightHome: join(homedir(), '.betaflight'),
  tcpPort: 5761,
};

const TCP_POLL_MS = 500;
const TCP_TIMEOUT_MS = 30_000;
const SIGKILL_TIMEOUT_MS = 5_000;

// ---------------------------------------------------------------------------
// BetaflightSitlLauncher
// ---------------------------------------------------------------------------

export class BetaflightSitlLauncher extends EventEmitter {
  private readonly config: BetaflightSitlConfig;
  private child: ChildProcess | null = null;
  private instance: BetaflightSitlInstance | null = null;

  constructor(config?: Partial<BetaflightSitlConfig>) {
    super();
    this.config = { ...DEFAULTS, ...config };
  }

  /** Validate environment, spawn Betaflight SITL, wait for MSP TCP readiness. */
  async launch(): Promise<BetaflightSitlInstance[]> {
    const binaryPath = join(
      this.config.betaflightHome,
      'obj',
      'main',
      'betaflight_SITL.elf',
    );

    await access(binaryPath, constants.F_OK).catch(() => {
      throw new Error(
        `Betaflight SITL binary not found at ${binaryPath}. ` +
          `Run scripts/setup-betaflight.sh or set betaflightHome to the betaflight source root.`,
      );
    });

    const proc = spawn(binaryPath, [], {
      cwd: this.config.betaflightHome,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.child = proc;

    // Stream stdout / stderr line-by-line
    if (proc.stdout) {
      const rl = createInterface({ input: proc.stdout });
      rl.on('line', (line: string) => this.emit('stdout', line));
    }
    if (proc.stderr) {
      const rl = createInterface({ input: proc.stderr });
      rl.on('line', (line: string) => this.emit('stderr', line));
    }

    proc.on('exit', (code) => this.emit('exit', code ?? 1));

    // Wait for MSP TCP port
    await waitForTcpReady(this.config.tcpPort);

    this.instance = {
      sysId: 1,
      tcpPort: this.config.tcpPort,
      pid: proc.pid ?? -1,
    };

    this.emit('ready', { instances: [this.instance] });
    return [this.instance];
  }

  /** Gracefully terminate the Betaflight SITL process. */
  async shutdown(): Promise<void> {
    if (!this.child || !this.child.pid || this.child.killed) {
      this.child = null;
      this.instance = null;
      return;
    }

    await new Promise<void>((resolve) => {
      const forceKill = setTimeout(() => {
        try { this.child?.kill('SIGKILL'); } catch { /* already dead */ }
      }, SIGKILL_TIMEOUT_MS);

      this.child!.once('exit', () => {
        clearTimeout(forceKill);
        resolve();
      });

      this.child!.kill('SIGTERM');
    });

    this.child = null;
    this.instance = null;
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
