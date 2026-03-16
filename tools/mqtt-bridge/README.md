# MQTT Bridge

Bridges MQTT messages from ADOS Drone Agent devices to Convex HTTP endpoints. Subscribes to `ados/+/status` and `ados/+/telemetry` topics, debounces per device (3s), and POSTs JSON payloads to the Convex backend.

## Architecture

```
Drone Agent --MQTT--> Mosquitto --subscribe--> Bridge --HTTP POST--> Convex
                          |
              cloudflared tunnel (mqtt.altnautica.com:9001 WebSocket)
```

## Local Development

```bash
npm install
npm run build
npm start
```

Set environment variables before running (or create a `.env` file in `deploy/`):

| Variable | Default | Description |
|----------|---------|-------------|
| `MQTT_BROKER_URL` | `mqtt://localhost:1883` | Mosquitto broker address |
| `MQTT_USERNAME` | (none) | Broker auth username |
| `MQTT_PASSWORD` | (none) | Broker auth password |
| `CONVEX_URL` | (required) | Convex HTTP endpoint base URL |

## Deploy with Docker Compose

```bash
cd deploy
cp .env.example .env
# Edit .env with your values

docker compose up -d
```

On first run, create the Mosquitto password file:

```bash
docker exec -it deploy-mosquitto-1 mosquitto_passwd -c /mosquitto/config/passwd ados
docker compose restart mosquitto
```

## Cloudflare Tunnel

The `cloudflared` service exposes Mosquitto's WebSocket listener (port 9001) as `mqtt.altnautica.com`. Configure the tunnel in your Cloudflare Zero Trust dashboard:

1. Create a tunnel and copy the token
2. Set `CLOUDFLARE_TUNNEL_TOKEN` in `.env`
3. Add a public hostname route: `mqtt.altnautica.com` -> `ws://mosquitto:9001`

Browser MQTT clients (like the GCS) connect via `wss://mqtt.altnautica.com`.

## Topic Format

| Topic | Description |
|-------|-------------|
| `ados/{deviceId}/status` | Agent status (online, version, uptime) |
| `ados/{deviceId}/telemetry` | Flight telemetry (position, attitude, battery) |

All payloads must be valid JSON. The bridge extracts `deviceId` from the topic and forwards the parsed payload plus `deviceId` and `topic` fields to the Convex endpoint.

## License

GPL-3.0-only. See [LICENSE](LICENSE).
