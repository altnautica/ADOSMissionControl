# Self-Hosting Guide

This guide covers deploying the full cloud relay stack so your GCS can manage drones over the internet. The stack has three layers, each optional and additive:

1. **Convex backend** - Auth, fleet management, cloud commands (5s poll baseline)
2. **MQTT relay** - Real-time telemetry at 2Hz+ via Mosquitto
3. **Video relay** - Live RTSP-to-browser video streaming via ffmpeg + WebSocket

You can run all three on a single Linux box (2+ CPU, 4+ GB RAM).

---

## Architecture

```
                         Internet
                            |
                   [Cloudflare Tunnel]
                    /       |       \
    convex.your.domain  mqtt.your.domain  video.your.domain
            |               |                  |
     +-----------+   +-----------+      +-------------+
     |  Convex   |   | Mosquitto |      | Video Relay |
     |  Backend  |   |  (MQTT)   |      | (ffmpeg)    |
     +-----------+   +-----+-----+      +------+------+
                           |                   |
                     +-----+-----+             |
                     |MQTT Bridge|        RTSP source
                     | (Node.js) |        (drone agent)
                     +-----+-----+
                           |
                     Convex HTTP API
```

The MQTT bridge subscribes to drone telemetry topics and forwards them to Convex so the GCS can display data. The video relay converts RTSP streams from the drone agent into fragmented MP4 over WebSocket for browser playback.

---

## Prerequisites

- Docker and Docker Compose
- A domain (optional but recommended for HTTPS)
- Cloudflare account (optional, for zero-port-forwarding tunnel)
- Node.js 18+ (for Convex CLI)

---

## Step 1: Convex Backend

The GCS uses [Convex](https://convex.dev) for auth, fleet data, and cloud commands.

**Option A: Convex Cloud (easiest)**
```bash
cd ADOSMissionControl
npx convex init
npx @convex-dev/auth          # generates JWT keys
npx convex dev                # starts dev backend
```

**Option B: Self-hosted Convex**

Deploy the [open-source Convex backend](https://github.com/get-convex/convex-backend) using Docker. Then push functions:

```bash
npx convex deploy --url https://convex.your.domain --admin-key <your-admin-key>
```

Set your GCS `.env.local`:
```
NEXT_PUBLIC_CONVEX_URL=https://convex.your.domain
```

---

## Step 2: MQTT Relay (Real-Time Telemetry)

The MQTT relay gives you 2Hz+ telemetry updates (vs 5s baseline polling through Convex HTTP).

### 2a. Configure

```bash
cd ADOSMissionControl/tools/mqtt-bridge/deploy
cp .env.example .env
```

Edit `.env`:
```env
MQTT_BROKER_URL=mqtt://mosquitto:1883
MQTT_USERNAME=ados
MQTT_PASSWORD=<your-password>
CONVEX_URL=https://convex.your.domain
CLOUDFLARE_TUNNEL_TOKEN=<your-token>    # optional, skip if using port forwarding
```

### 2b. Create MQTT password

```bash
docker compose up -d mosquitto
docker exec -it deploy-mosquitto-1 mosquitto_passwd -c /mosquitto/config/passwd ados
# Enter your password when prompted
docker compose down
```

### 2c. Start

```bash
docker compose up -d
```

Verify:
```bash
# Check mosquitto is accepting connections
docker compose logs mosquitto | tail -5

# Check bridge is connected
docker compose logs bridge | tail -5
```

### 2d. DNS / Tunnel

If using Cloudflare Tunnel, add a public hostname route:
- `mqtt.your.domain` -> `ws://mosquitto:9001` (WebSocket)

If using port forwarding, expose port 9001 (WebSocket) and point your DNS at it with TLS termination (nginx, caddy, etc.).

---

## Step 3: Video Relay (Live Streaming)

The video relay converts RTSP from the drone agent into fragmented MP4 over WebSocket. The browser plays it natively via MediaSource Extensions.

### 3a. Configure

```bash
cd ADOSMissionControl/tools/video-relay/deploy
cp .env.example .env
```

Edit `.env`:
```env
RTSP_URL_PATTERN=rtsp://host.docker.internal:8554/{deviceId}
PORT=3001
CLOUDFLARE_TUNNEL_TOKEN=<your-token>    # optional
```

The `{deviceId}` placeholder is replaced at runtime with the drone's device ID. The drone agent must be publishing RTSP at this URL pattern.

### 3b. Start

```bash
docker compose up -d
```

Verify:
```bash
curl http://localhost:3001/
# Should return: {"status":"ok"}
```

### 3c. DNS / Tunnel

If using Cloudflare Tunnel, add:
- `video.your.domain` -> `http://video-relay:3001`

---

## Step 4: Configure GCS

Set the relay URLs as Convex environment variables so the GCS can find your MQTT broker and video relay:

```bash
npx convex env set MQTT_BROKER_URL "wss://mqtt.your.domain/mqtt" \
  --url https://convex.your.domain --admin-key <your-key>

npx convex env set VIDEO_RELAY_URL "wss://video.your.domain" \
  --url https://convex.your.domain --admin-key <your-key>
```

The GCS reads these from the `clientConfig` query at runtime. If not set, it falls back to `wss://mqtt.altnautica.com/mqtt` and `wss://video.altnautica.com` (which only work for the official deployment).

---

## Step 5: Verify

### Convex
```bash
curl https://convex.your.domain/
# Should return 200
```

### MQTT
Use any MQTT client to test pub/sub:
```bash
# In one terminal, subscribe
npx mqtt sub -t 'ados/+/status' -h mqtt.your.domain -p 9001 -l ws -u ados -P <password>

# In another, publish
npx mqtt pub -t 'ados/test-device/status' -m '{"version":"1.0.0"}' \
  -h mqtt.your.domain -p 9001 -l ws -u ados -P <password>
```

### Video
```bash
curl https://video.your.domain/
# Should return: {"status":"ok"}
```

### GCS
Open your GCS in a browser (must be HTTPS for cloud mode to activate). Pair a drone. The Command tab should show "Cloud" badge and receive telemetry.

---

## Unified Docker Compose (All-in-One)

If you want to run MQTT + video relay from a single compose file:

```yaml
services:
  mosquitto:
    image: eclipse-mosquitto:2
    restart: unless-stopped
    ports:
      - "1883:1883"
      - "9001:9001"
    volumes:
      - ./mosquitto.conf:/mosquitto/config/mosquitto.conf:ro
      - ./passwd:/mosquitto/config/passwd:ro
      - mosquitto-data:/mosquitto/data
      - mosquitto-log:/mosquitto/log

  mqtt-bridge:
    build:
      context: ../tools/mqtt-bridge
      dockerfile: deploy/Dockerfile
    restart: unless-stopped
    depends_on:
      - mosquitto
    environment:
      - MQTT_BROKER_URL=mqtt://mosquitto:1883
      - MQTT_USERNAME=ados
      - MQTT_PASSWORD=${MQTT_PASSWORD}
      - CONVEX_URL=${CONVEX_URL}

  video-relay:
    build:
      context: ../tools/video-relay
      dockerfile: deploy/Dockerfile
    restart: unless-stopped
    ports:
      - "3001:3001"
    environment:
      - RTSP_URL_PATTERN=${RTSP_URL_PATTERN:-rtsp://host.docker.internal:8554/{deviceId}}
      - PORT=3001
    extra_hosts:
      - "host.docker.internal:host-gateway"

  cloudflared:
    image: cloudflare/cloudflared:latest
    restart: unless-stopped
    command: tunnel run
    depends_on:
      - mosquitto
      - video-relay
    environment:
      - TUNNEL_TOKEN=${CLOUDFLARE_TUNNEL_TOKEN}

volumes:
  mosquitto-data:
  mosquitto-log:
```

Copy `tools/mqtt-bridge/deploy/mosquitto.conf` to `./mosquitto.conf` and create a `.env` with all required variables.

---

## Troubleshooting

**GCS not entering cloud mode**
- Cloud mode only activates when the page is served over HTTPS. On `http://localhost`, the GCS connects directly to the agent.
- Check browser console for `clientConfig` query results.

**MQTT connection fails in browser**
- The browser connects via WebSocket (port 9001), not raw TCP (port 1883). Make sure your tunnel/proxy routes to the WebSocket listener.
- Check that Mosquitto has `listener 9001` and `protocol websockets` in its config.

**Video not playing**
- The video relay needs ffmpeg. Check `docker compose logs video-relay` for ffmpeg errors.
- The relay spawns ffmpeg on the first viewer connection. If no RTSP source is available, ffmpeg exits immediately.
- Browser must support MediaSource Extensions (all modern browsers except iOS Safari).

**Bridge not forwarding to Convex**
- Check `CONVEX_URL` in your `.env` points to the correct Convex backend URL.
- Check `docker compose logs mqtt-bridge` for HTTP errors.
- The bridge debounces at 3s per device. You won't see every single MQTT message forwarded.

**MQTT password not working**
- The password file must be created inside the Mosquitto container using `mosquitto_passwd`.
- After changing passwords, restart Mosquitto: `docker compose restart mosquitto`

---

## Resource Requirements

| Component | CPU | RAM | Disk |
|-----------|-----|-----|------|
| Convex backend | 2+ cores | 4+ GB | 10+ GB (SQLite grows with data) |
| Mosquitto | minimal | ~50 MB | minimal |
| MQTT bridge | minimal | ~100 MB | none |
| Video relay | 1 core per stream | ~200 MB per stream | none |

For a small deployment (1-5 drones), a single 4-core / 8GB machine handles everything including Convex.
