# Video Relay

RTSP to fragmented MP4 over WebSocket. Enables browser video playback via MediaSource Extensions (MSE) with no transcoding.

## How it works

```
RTSP source (camera/mediamtx)
  |
  v
ffmpeg -c:v copy -f mp4 -movflags frag_keyframe+empty_moov+default_base_moof pipe:1
  |
  v
WebSocket binary frames -> browser MSE (SourceBuffer)
```

ffmpeg remuxes H.264 from RTSP into fragmented MP4 (fMP4). No transcoding happens. The container format changes from RTP to fMP4, which browsers can consume through the MediaSource Extensions API.

Each device stream gets its own ffmpeg process, spawned on first viewer connect and killed when the last viewer disconnects.

### Latency

| Segment | Typical |
|---------|---------|
| Camera encode | 30-80ms |
| RTSP transport | 5-20ms |
| ffmpeg remux | 10-30ms |
| WebSocket delivery | 5-15ms |
| MSE buffer + render | 40-100ms |
| **Total** | **~100-250ms** |

Over Cloudflare Tunnel, add 20-50ms for the tunnel hop. Total stays under 300ms for most connections.

## Quick start

```bash
npm install
npm run dev
```

The relay listens on port 3001 (configurable via `PORT` env var). Connect a WebSocket client to `ws://localhost:3001/ws/stream/{deviceId}?token=<token>` where `{deviceId}` matches an RTSP stream name.

### Viewer tokens

`VIDEO_RELAY_SECRET` is required; the relay refuses to start without it. Every upgrade must carry a token scoped to the device in the path, as `?token=` or `Authorization: Bearer`. A token is `<exp>.<mac>`: `exp` is the expiry in unix seconds and `mac` is the hex HMAC-SHA256 of `<deviceId>|<exp>` keyed with the secret. The relay refuses a token that has expired, is dated more than ten minutes ahead, or was minted for another device, and answers `401` on the upgrade.

Mission Control obtains tokens from the Convex action `cmdVideoRelayTokens.mint`, which checks that the signed-in user owns the drone and issues a five-minute token. Set the same `VIDEO_RELAY_SECRET` on the Convex deployment. The token is checked once, when the stream opens.

### Health check

`GET http://localhost:3001/` returns JSON with active session count.

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | HTTP/WebSocket listen port |
| `RTSP_URL_PATTERN` | `rtsp://localhost:8554/{deviceId}` | RTSP source URL template. `{deviceId}` is replaced with the stream name from the WebSocket path. |
| `VIDEO_RELAY_SECRET` | none (required) | Shared secret for viewer tokens. Must match the Convex deployment's `VIDEO_RELAY_SECRET`. |
| `VIDEO_RELAY_MAX_BACKLOG` | `4194304` | Bytes buffered for one slow viewer before it is dropped. |

## Deploy with Docker

```bash
cd deploy
cp .env.example .env
# Edit .env: VIDEO_RELAY_SECRET, Cloudflare Tunnel token, RTSP source
docker compose up -d
```

The compose file runs two containers:
1. **video-relay** - The Node.js relay with ffmpeg
2. **cloudflared** - Cloudflare Tunnel exposing the relay at `video.your-domain.com`

WebSocket connections are standard HTTP upgrades, so they pass through Cloudflare Tunnel without any special configuration.

### RTSP source

The relay expects an RTSP server (like [mediamtx](https://github.com/bluenviern/mediamtx)) providing H.264 streams. The default URL pattern points to `localhost:8554` which works when mediamtx runs on the same host. In Docker, set `RTSP_URL_PATTERN` to use `host.docker.internal` (already the default in docker-compose.yml).

## Browser client example

```js
const ws = new WebSocket(`ws://localhost:3001/ws/stream/drone1?token=${token}`);
const mediaSource = new MediaSource();
const video = document.querySelector('video');
video.src = URL.createObjectURL(mediaSource);

mediaSource.addEventListener('sourceopen', () => {
  const buf = mediaSource.addSourceBuffer('video/mp4; codecs="avc1.42E01E"');
  ws.binaryType = 'arraybuffer';
  ws.onmessage = (e) => {
    if (!buf.updating) {
      buf.appendBuffer(e.data);
    }
  };
});
```

## License

GPL-3.0-only. See [LICENSE](LICENSE).
