#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-only
// cli.ts — MAVLink UDP/TCP ↔ WebSocket bridge CLI entry point

import { UdpWsBridge, type UdpMode } from './udp-ws.js';
import { TcpWsBridge } from './tcp-ws.js';
import type { Bridge } from './types.js';
import { DEFAULT_WS_HOST, bridgeUrl, createBridgeToken, isLoopbackOrigin } from './ws-guard.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_WS_PORT = 14551;

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

type InputProto = 'udp-listen' | 'udp-target' | 'tcp';

interface InputSpec {
  proto: InputProto;
  host: string;
  port: number;
}

interface CliArgs {
  input?: string;
  wsPort: number;
  wsHost: string;
  allowedOrigins: string[];
  help: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    wsPort: DEFAULT_WS_PORT,
    wsHost: DEFAULT_WS_HOST,
    allowedOrigins: [],
    help: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];

    switch (arg) {
      case '--in':
      case '--input':
        args.input = next;
        i++;
        break;
      case '--ws':
      case '--ws-port':
        args.wsPort = parseInt(next, 10);
        i++;
        break;
      case '--ws-host':
        args.wsHost = next;
        i++;
        break;
      case '--allow-origin':
        args.allowedOrigins.push(next);
        i++;
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      default:
        console.error(`Unknown argument: ${arg}`);
        printHelp();
        process.exit(1);
    }
  }

  return args;
}

function parseInputSpec(spec: string): InputSpec {
  // Format: <proto>:<host>:<port>. Split proto off the front, then the port off
  // the back, so IPv6 host literals (which contain colons) survive intact.
  const sep = spec.indexOf(':');
  if (sep === -1) {
    throw new Error(`Invalid --in spec "${spec}". Expected <proto>:<host>:<port>.`);
  }
  const protoToken = spec.slice(0, sep).toLowerCase();
  const rest = spec.slice(sep + 1);

  const lastColon = rest.lastIndexOf(':');
  if (lastColon === -1) {
    throw new Error(`Invalid --in spec "${spec}". Missing port. Expected <proto>:<host>:<port>.`);
  }
  const host = rest.slice(0, lastColon);
  const port = parseInt(rest.slice(lastColon + 1), 10);
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid --in spec "${spec}". Host or port is malformed.`);
  }

  let proto: InputProto;
  switch (protoToken) {
    case 'udp':
    case 'udpin':
      proto = 'udp-listen';
      break;
    case 'udpout':
      proto = 'udp-target';
      break;
    case 'tcp':
      proto = 'tcp';
      break;
    default:
      throw new Error(
        `Unknown protocol "${protoToken}" in --in spec. Use udp, udpin, udpout, or tcp.`,
      );
  }

  return { proto, host, port };
}

function printHelp(): void {
  console.log(`
mavlink-bridge — MAVLink UDP/TCP ↔ WebSocket bridge for browser-based GCS

Browsers cannot open raw UDP or TCP sockets. This tool exposes a MAVLink UDP or
TCP endpoint as a WebSocket the browser ground control station can dial. It
relays raw bytes both ways and does no MAVLink parsing.

Usage:
  mavlink-bridge --in <spec> [--ws <port>] [--ws-host <addr>] [--allow-origin <origin>]

Options:
  --in <spec>             Input endpoint to bridge. One of:
                            udp:HOST:PORT     listen on HOST:PORT and learn the
                                              peer once, from the first MAVLink
                                              datagram sent from a local address
                                              (MAVProxy --out=udp:HOST:PORT)
                            udpin:HOST:PORT   same as udp: (explicit listen)
                            udpout:HOST:PORT  send to a fixed HOST:PORT from the start
                            tcp:HOST:PORT     connect out to a TCP server
  --ws <port>             WebSocket listen port for the GCS (default: ${DEFAULT_WS_PORT})
  --ws-host <addr>        WebSocket bind address (default: ${DEFAULT_WS_HOST}, this
                          machine only). Use 0.0.0.0 to accept other hosts.
  --allow-origin <origin> Also accept a GCS page served from this exact origin,
                          e.g. https://gcs.example.com (repeatable). Pages
                          served from localhost / 127.0.0.1 are always accepted.
  -h, --help              Show this help

Every run prints a random token. The GCS must connect with it:
  ws://127.0.0.1:${DEFAULT_WS_PORT}/?token=<token>
Connections without the token, or from a web page on any other origin, are
refused.

Examples:
  # Listen for ArduPilot/MAVProxy UDP output, serve it to the GCS
  mavlink-bridge --in udp:0.0.0.0:14550 --ws 14551
  #   mavproxy.py --master=/dev/ttyUSB0 --out=udp:127.0.0.1:14550
  #   then point the GCS at the printed ws://127.0.0.1:14551/?token=... URL

  # Bridge a TCP MAVLink server (e.g. a SITL instance on 5760)
  mavlink-bridge --in tcp:127.0.0.1:5760 --ws 14551

  # Send to a fixed UDP target
  mavlink-bridge --in udpout:127.0.0.1:14550 --ws 14551
`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function logError(err: Error, log: (msg: string) => void): void {
  const code = (err as NodeJS.ErrnoException).code;
  // ECONNREFUSED is expected while a TCP target is still starting up.
  if (code === 'ECONNREFUSED') return;
  log(`Bridge error: ${err.message}`);
}

function main(): void {
  const cli = parseArgs(process.argv);

  if (cli.help) {
    printHelp();
    process.exit(0);
  }

  if (!cli.input) {
    console.error('Error: --in <spec> is required.\n');
    printHelp();
    process.exit(1);
  }

  if (!Number.isInteger(cli.wsPort) || cli.wsPort < 1 || cli.wsPort > 65535) {
    console.error(`Error: invalid --ws port "${cli.wsPort}".`);
    process.exit(1);
  }

  if (!cli.wsHost) {
    console.error('Error: --ws-host needs an address.');
    process.exit(1);
  }

  for (const origin of cli.allowedOrigins) {
    let parsed: URL | null = null;
    try {
      parsed = new URL(origin);
    } catch {
      // reported below
    }
    if (!parsed || parsed.origin !== origin) {
      console.error(
        `Error: --allow-origin "${origin}" is not an origin (scheme://host[:port], no path).`,
      );
      process.exit(1);
    }
  }

  const guard = { token: createBridgeToken(), allowedOrigins: cli.allowedOrigins };
  const ws = { wsPort: cli.wsPort, wsHost: cli.wsHost, ...guard };

  let spec: InputSpec;
  try {
    spec = parseInputSpec(cli.input);
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exit(1);
  }

  const log = (msg: string) => {
    const ts = new Date().toISOString();
    console.log(`[${ts}] ${msg}`);
  };

  let bridge: Bridge;

  if (spec.proto === 'tcp') {
    const tcp = new TcpWsBridge({ ...ws, host: spec.host, port: spec.port });
    tcp.on('connected', ({ host, port }) => log(`TCP connected to ${host}:${port}`));
    tcp.on('disconnected', ({ host, port }) =>
      log(`TCP disconnected from ${host}:${port}, reconnecting...`),
    );
    tcp.on('ws-client-connected', ({ remoteAddress }) =>
      log(`GCS connected from ${remoteAddress} (${tcp.wsClientCount} client(s))`),
    );
    tcp.on('ws-client-disconnected', ({ remoteAddress }) =>
      log(`GCS disconnected: ${remoteAddress} (${tcp.wsClientCount} client(s))`),
    );
    tcp.on('error', (err) => logError(err, log));
    bridge = tcp;
  } else {
    const mode: UdpMode = spec.proto === 'udp-target' ? 'target' : 'listen';
    const udp = new UdpWsBridge({ ...ws, mode, host: spec.host, port: spec.port });
    udp.on('connected', ({ host, port }) =>
      log(
        mode === 'listen'
          ? `UDP listening on ${host}:${port} (waiting for the drone to send)`
          : `UDP sending to ${host}:${port}`,
      ),
    );
    udp.on('disconnected', ({ host, port }) =>
      log(`UDP socket closed (${host}:${port}), rebinding...`),
    );
    udp.on('peer-learned', ({ host, port }) => log(`Learned UDP peer ${host}:${port}`));
    udp.on('ws-client-connected', ({ remoteAddress }) =>
      log(`GCS connected from ${remoteAddress} (${udp.wsClientCount} client(s))`),
    );
    udp.on('ws-client-disconnected', ({ remoteAddress }) =>
      log(`GCS disconnected: ${remoteAddress} (${udp.wsClientCount} client(s))`),
    );
    udp.on('error', (err) => logError(err, log));
    bridge = udp;
  }

  bridge.start();

  // Startup banner
  const url = bridgeUrl(cli.wsHost, cli.wsPort, guard.token);
  log('');
  log('=== MAVLink Bridge Ready ===');
  switch (spec.proto) {
    case 'udp-listen':
      log(`Bridging UDP (listen) ${spec.host}:${spec.port}  ->  WebSocket ${cli.wsHost}:${cli.wsPort}`);
      break;
    case 'udp-target':
      log(`Bridging UDP (target) ${spec.host}:${spec.port}  ->  WebSocket ${cli.wsHost}:${cli.wsPort}`);
      break;
    case 'tcp':
      log(`Bridging TCP ${spec.host}:${spec.port}  ->  WebSocket ${cli.wsHost}:${cli.wsPort}`);
      break;
  }
  log(`Point the GCS at:  ${url}`);
  const extra = cli.allowedOrigins.filter((o) => !isLoopbackOrigin(o));
  log(`Accepted GCS pages: localhost${extra.length ? `, ${extra.join(', ')}` : ''}`);
  if (cli.wsHost !== DEFAULT_WS_HOST && cli.wsHost !== '::1' && cli.wsHost !== 'localhost') {
    log(`WARNING: the WebSocket is reachable from other hosts on ${cli.wsHost}; keep the token private.`);
  }
  log('');

  // --- Signal handling (clean shutdown) -----------------------------------
  let shuttingDown = false;

  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;

    log('Shutting down...');
    bridge.shutdown();
    console.log('Bridge stopped. Goodbye.');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
