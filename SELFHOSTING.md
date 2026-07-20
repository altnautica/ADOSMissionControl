# Self-Hosting Guide

This guide covers deploying the full cloud relay stack so your GCS can manage drones over the internet. The stack has three layers, each optional and additive:

1. **Convex backend** — Auth, fleet management, cloud commands (5s poll baseline)
2. **MQTT relay** — Real-time telemetry at 2Hz+ via Mosquitto
3. **Video relay** — Live RTSP-to-browser video streaming via ffmpeg + WebSocket

You can run all three on a single Linux box (2+ CPU, 4+ GB RAM).

---

## Quick Setup (the `ados-deploy` TUI)

The fastest path is the full-screen deployer. It is **turnkey** — one guided flow
that generates the config, starts Convex, retrieves the admin key, pushes the
functions, sets the auth keys, hashes the MQTT password, builds + starts every
service, and verifies it, with no out-of-band steps.

```bash
# One-liner (clones the repo if needed, then launches the TUI):
curl -sSL https://raw.githubusercontent.com/altnautica/ADOSMissionControl/main/tools/deploy/deploy.sh | sh

# Or, from a checkout:
npm run deploy -- deploy          # the guided deploy wizard
npm run deploy -- deploy --plan   # preview the exact commands + files, run nothing
```

The wizard:
- Lets you pick which services to spin up locally vs. point at your own (managed Convex / MQTT / video)
- Defaults the reach address to your LAN IP; configures ports with conflict detection
- Prompts for credentials with masked input — values go only to gitignored local `.env` files
- Applies Convex server variables directly via the Convex CLI (never written to files)
- Generates `docker-compose.override.yml` if you changed any default port
- Builds + starts the services and shows verified reach links when done

After running the wizard you can manage services with:

```bash
npm run deploy -- status       # containers + reach links
# manage the stack: menu -> Manage running stack (or docker compose)
```

The manual steps below cover the same ground if you prefer direct control or need to understand what the wizard does.

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

Deploy the [open-source Convex backend](https://github.com/get-convex/convex-backend) using Docker. The all-in-one compose at `tools/selfhost/` includes a `convex-backend` + `convex-dashboard` service (see [Unified Docker Compose](#unified-docker-compose-all-in-one) below). Then push functions:

```bash
npx convex deploy --url http://convex.your.domain:3210 --admin-key <your-admin-key>
```

Generate and set the auth keys (Convex Auth signs session JWTs with RS256, and a self-hosted backend has no keys until you set them):

```bash
node scripts/generate-auth-keys.mjs
npx convex env set JWT_PRIVATE_KEY "$JWT_PRIVATE_KEY" --url http://convex.your.domain:3210 --admin-key <your-admin-key>
npx convex env set JWKS "$JWKS"                       --url http://convex.your.domain:3210 --admin-key <your-admin-key>
npx convex env set SITE_URL "http://your.domain:4000" --url http://convex.your.domain:3210 --admin-key <your-admin-key>
```

On a self-hosted backend the CLI MUST target your own URL + admin key, or the keys land on the wrong deployment and password sign-in fails with no visible error.

Set your GCS `.env.local` to the Convex **client-API** origin (port `3210`):
```
NEXT_PUBLIC_CONVEX_URL=http://convex.your.domain:3210
```

<details>
<summary>Convex's two origins (3210 vs 3211)</summary>

A self-hosted Convex backend exposes two origins that are not interchangeable:

- **`:3210`** client API — the GCS browser bundle (`NEXT_PUBLIC_CONVEX_URL`) and `convex deploy` use this.
- **`:3211`** site / HTTP actions — the drone agent heartbeat and the MQTT bridge POST to this (`CONVEX_URL` → `${CONVEX_URL}/agent/status`). The agent's `server.self_hosted.url` and `pairing.convex_url` also point here.

Cross them and the GCS loads but no drone ever appears, or sign-in works but commands never reach the agent.
</details>

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

The GCS reads these from the `clientConfig` query at runtime. If you leave them unset, the build falls back to the official hosted deployment's broker and relay, which only work for that instance. A self-hosted deployment must set both so the GCS points at your infrastructure.

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

The ready-made all-in-one compose lives at `tools/selfhost/`. It brings up the
whole stack on one host: a self-hosted **Convex backend** (`:3210` client API,
`:3211` site / HTTP actions) + **Convex dashboard** (`:6791`), the **Mission
Control web GCS** (`:4000`, built from the repo `Dockerfile`), **Mosquitto**
(`:1883` / `:9001`), the **MQTT bridge**, and the **video relay** (`:3001`).

```bash
cd tools/selfhost
cp .env.example .env       # set CONVEX_INSTANCE_SECRET, MQTT_PASSWORD, origins

# 1. start the backend, then push functions + auth keys out-of-band
docker compose up -d convex-backend
npx convex deploy --url http://<host>:3210 --admin-key <admin-key>
node ../../scripts/generate-auth-keys.mjs   # then npx convex env set ... (see Step 1)

# 2. create the MQTT password, then bring up everything
docker compose up -d mosquitto
docker exec -it selfhost-mosquitto-1 mosquitto_passwd -c /mosquitto/config/passwd ados
docker compose up -d
```

### Critical port wiring

| Endpoint | Goes to | Variable |
|---|---|---|
| GCS browser client | Convex client API `:3210` | `NEXT_PUBLIC_CONVEX_URL` |
| MQTT bridge + agent heartbeat | Convex site `:3211` (`/agent/status`) | `CONVEX_URL` |
| Drone agent `server.self_hosted.url` + `pairing.convex_url` | Convex site `:3211` | (agent config) |

Functions are pushed out-of-band with `npx convex deploy --url http://<host>:3210 --admin-key <key>`. A single Mission Control image that pushes functions on boot is a future goal, not built yet.

See `tools/selfhost/README.md` for the full runbook. The minimal MQTT + video-relay-only compose (no Convex, no GCS) remains at `tools/mqtt-bridge/deploy/` if you only need the relay layers behind an existing Convex deployment.

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
