// gazebo-video-bridge.ts — Bridge Gazebo camera RTP output to RTSP for video-relay
// SPDX-License-Identifier: GPL-3.0-only
//
// Usage: npx tsx src/video/gazebo-video-bridge.ts [options]
//
// This script runs a GStreamer pipeline that:
// 1. Receives H.264 RTP from Gazebo's GstCameraPlugin (UDP port 5600)
// 2. Publishes as RTSP via mediamtx (must be running on localhost:8554)
//
// The existing video-relay (tools/video-relay/) then picks up the RTSP stream
// and converts it to fMP4 over WebSocket for the GCS MSE player.
//
// Pipeline: Gazebo -> RTP UDP:5600 -> this bridge -> RTSP -> video-relay -> WS -> GCS

import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';

interface BridgeConfig {
  udpPort: number;
  rtspUrl: string;
  cameraName: string;
}

const DEFAULT_CONFIG: BridgeConfig = {
  udpPort: 5600,
  rtspUrl: 'rtsp://localhost:8554/gazebo-cam',
  cameraName: 'forward',
};

function parseArgs(argv: string[]): BridgeConfig {
  const config = { ...DEFAULT_CONFIG };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    switch (arg) {
      case '--udp-port':
        config.udpPort = parseInt(next, 10);
        i++;
        break;
      case '--rtsp-url':
        config.rtspUrl = next;
        i++;
        break;
      case '--camera':
        config.cameraName = next;
        i++;
        break;
      case '--help':
      case '-h':
        console.log(`
gazebo-video-bridge — Bridge Gazebo camera RTP to RTSP

Options:
  --udp-port <port>   UDP port for RTP input (default: 5600)
  --rtsp-url <url>    RTSP output URL (default: rtsp://localhost:8554/gazebo-cam)
  --camera <name>     Camera name for logging (default: forward)
  -h, --help          Show help
`);
        process.exit(0);
    }
  }
  return config;
}

function startBridge(config: BridgeConfig): ChildProcess {
  // GStreamer pipeline: receive RTP H.264, push to RTSP server
  const pipeline = [
    `udpsrc port=${config.udpPort} caps="application/x-rtp,media=video,encoding-name=H264,payload=96"`,
    'rtph264depay',
    'h264parse',
    `rtspclientsink location=${config.rtspUrl} protocols=tcp`,
  ].join(' ! ');

  console.log(`[${config.cameraName}] Starting GStreamer bridge`);
  console.log(`  RTP input:  UDP port ${config.udpPort}`);
  console.log(`  RTSP output: ${config.rtspUrl}`);
  console.log(`  Pipeline: ${pipeline}`);

  const proc = spawn('gst-launch-1.0', ['-v', ...pipeline.split(' ')], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (proc.stdout) {
    const rl = createInterface({ input: proc.stdout });
    rl.on('line', (line: string) => {
      if (line.includes('Setting pipeline to PLAYING') || line.includes('New clock')) {
        console.log(`[${config.cameraName}] ${line.trim()}`);
      }
    });
  }

  if (proc.stderr) {
    const rl = createInterface({ input: proc.stderr });
    rl.on('line', (line: string) => {
      if (line.includes('ERROR') || line.includes('WARNING')) {
        console.error(`[${config.cameraName}] ${line.trim()}`);
      }
    });
  }

  proc.on('exit', (code) => {
    console.log(`[${config.cameraName}] GStreamer exited with code ${code}`);
  });

  return proc;
}

// Main
const config = parseArgs(process.argv);
const proc = startBridge(config);

const shutdown = () => {
  console.log('\nShutting down video bridge...');
  proc.kill('SIGTERM');
  setTimeout(() => process.exit(0), 2000);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
