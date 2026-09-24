# Self-host the full cloud stack

A single Docker Compose file that brings up the whole Mission Control cloud
relay on one host: a self-hosted Convex backend + dashboard, the Mission
Control web GCS, the MQTT broker + bridge, and the video relay.

This is the all-in-one path. If you only need the MQTT relay or only the
video relay, use the per-tool compose files in `../mqtt-bridge/deploy/` and
`../video-relay/deploy/`.

## Services and ports

| Service | Port | Used by |
|---|---|---|
| `convex-backend` (client API) | `3210` | GCS browser client (`NEXT_PUBLIC_CONVEX_URL`) |
| `convex-backend` (site / HTTP actions) | `3211` | agent heartbeat + MQTT bridge (`CONVEX_URL`) |
| `convex-dashboard` | `6791` | admin dashboard UI |
| `mission-control` | `4000` | the web GCS |
| `mosquitto` | `1883` (TCP), `9001` (WebSocket) | MQTT |
| `mqtt-bridge` | internal | forwards MQTT to Convex |
| `video-relay` | `3001` | RTSP-to-WebSocket video |

## Critical port wiring

Convex exposes two origins and they are not interchangeable:

- **`:3210`** is the client API. The GCS browser bundle talks to this
  (`NEXT_PUBLIC_CONVEX_URL`). Functions are also deployed here.
- **`:3211`** is the site / HTTP-actions origin. The agent heartbeat and the
  MQTT bridge POST to this (`CONVEX_URL` → `${CONVEX_URL}/agent/status`). The
  drone agent's `server.self_hosted.url` and `pairing.convex_url` also point
  here.

Cross them and the GCS loads but no drone ever appears (heartbeat went to the
client-API origin), or sign-in works but commands never reach the agent.

## Setup

1. Copy and edit the environment:

   ```bash
   cp .env.example .env
   # set CONVEX_INSTANCE_SECRET (openssl rand -hex 32), MQTT_PASSWORD,
   # and the origins for your host
   ```

2. Start the backend first:

   ```bash
   docker compose up -d convex-backend
   ```

3. Push Convex functions out-of-band from a machine with the repo checked out:

   ```bash
   npx convex deploy --url http://<host>:3210 --admin-key <admin-key>
   ```

   The admin key is printed by the backend container on first boot
   (`docker compose logs convex-backend`).

4. Generate and set the auth keys on the backend:

   ```bash
   node ../../scripts/generate-auth-keys.mjs
   npx convex env set JWT_PRIVATE_KEY "$JWT_PRIVATE_KEY" --url http://<host>:3210 --admin-key <admin-key>
   npx convex env set JWKS "$JWKS"                       --url http://<host>:3210 --admin-key <admin-key>
   npx convex env set SITE_URL "http://<host>:4000"      --url http://<host>:3210 --admin-key <admin-key>
   npx convex env set MQTT_AUTH_RELAY_SECRET "$MQTT_AUTH_RELAY_SECRET" --url http://<host>:3210 --admin-key <admin-key>
   ```

   `MQTT_AUTH_RELAY_SECRET` is any long random value, the same one in `.env`.

5. Seed the broker's credential files before its first start. The broker
   mounts both as files, so they must exist first:

   ```bash
   cp ../mqtt-bridge/deploy/acl.conf ./acl.conf
   docker run --rm -v "$PWD:/work" eclipse-mosquitto:2 \
     mosquitto_passwd -b -c /work/passwd ados "$MQTT_PASSWORD"
   ```

   From then on the `mqtt-auth-sync` service keeps both current: every 30 s
   it pulls the paired devices and live operator grants from Convex, rewrites
   the files and reloads the broker, so a newly paired agent can log in
   without any manual step.

6. Bring up everything:

   ```bash
   docker compose up -d
   ```

## Future goal

A single Mission Control image that runs the GCS and pushes Convex functions
to the backend on boot would remove the out-of-band `convex deploy` step.
That is not built yet; functions are deployed manually for now.
