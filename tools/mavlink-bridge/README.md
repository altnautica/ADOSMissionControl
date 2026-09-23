# @altnautica/mavlink-bridge

MAVLink UDP/TCP to WebSocket bridge for browser-based ground control stations.

Browsers cannot open raw UDP or TCP sockets, so a browser-based GCS cannot talk
directly to a flight controller, drone, or simulator that speaks MAVLink over
UDP or TCP. This tool sits in the middle: it attaches to a MAVLink UDP or TCP
endpoint and re-exposes it as a WebSocket that the browser GCS can connect to.
It relays raw binary frames in both directions and does no MAVLink parsing.

## Architecture

```
  Flight controller / drone / SITL
   (MAVLink over UDP or TCP)
              │
        UDP 14550  /  TCP 5760
              │
       ┌──────┴───────┐
       │ mavlink      │  raw binary relay (zero MAVLink parsing)
       │ bridge       │
       └──────┬───────┘
              │
          WS 14551
              │
         Browser GCS
```

## Prerequisites

- Node.js 20+

## Install / Build

```bash
cd tools/mavlink-bridge
npm install
npm run build
```

Or run it without a global install:

```bash
npx @altnautica/mavlink-bridge --in udp:0.0.0.0:14550 --ws 14551
```

## Usage

```bash
# Listen for UDP MAVLink and serve it to the GCS on ws://127.0.0.1:14551
mavlink-bridge --in udp:0.0.0.0:14550 --ws 14551

# Bridge a TCP MAVLink server (e.g. a SITL instance on 5760)
mavlink-bridge --in tcp:127.0.0.1:5760 --ws 14551

# Send to a fixed UDP target instead of listening
mavlink-bridge --in udpout:127.0.0.1:14550 --ws 14551
```

Each run prints the exact URL to use, with a fresh random token:

```
Point the GCS at:  ws://127.0.0.1:14551/?token=Vq3...
```

Paste that whole URL, `?token=` included, into the GCS bridge URL field.

## Access control

The bridge relays commands straight to the vehicle, so the WebSocket is
locked down by default:

- It binds `127.0.0.1` only. `--ws-host 0.0.0.0` (or a specific interface
  address) opts in to connections from other machines; the token is then the
  only guard, so keep it private.
- Every client must present the per-run token as `?token=<token>`. A missing or
  wrong token is refused with HTTP 401. The token changes on every start.
- A browser page is accepted only when it is served from `localhost`,
  `127.0.0.1` or `[::1]`, or from an origin passed with `--allow-origin`
  (e.g. `--allow-origin https://gcs.example.com` for a hosted GCS). Any other
  web page is refused with HTTP 403, so a site open in another tab cannot
  reach the vehicle. Clients that send no `Origin` header (command-line tools,
  scripts) need only the token.

### With MAVProxy and a serial flight controller

Run MAVProxy against the FC and forward a UDP stream to the bridge:

```bash
mavproxy.py --master=/dev/ttyUSB0 --out=udp:127.0.0.1:14550
mavlink-bridge --in udp:127.0.0.1:14550 --ws 14551
```

The bridge listens on `127.0.0.1:14550`, learns MAVProxy as the peer from its
first MAVLink frame, and relays both directions. Connect the GCS to the printed
`ws://127.0.0.1:14551/?token=...` URL.

## Input spec (`--in`)

`--in` takes a `<proto>:<host>:<port>` spec:

| Spec | Mode | Behavior |
|------|------|----------|
| `udp:HOST:PORT` | listen | Bind to `HOST:PORT`, learn the remote peer once from the first MAVLink datagram sent from a local address, then send GCS traffic back to that peer. |
| `udpin:HOST:PORT` | listen | Same as `udp:` (explicit). |
| `udpout:HOST:PORT` | target | Send to a fixed `HOST:PORT` from the start, and receive replies on the same socket. |
| `tcp:HOST:PORT` | tcp | Connect out to a TCP MAVLink server, with automatic reconnect and exponential backoff. |

The `listen` mode follows MAVProxy semantics: the drone or simulator sends to
the bridge, the bridge learns where it came from, and replies route back to that
learned peer. The peer is learned once, for the life of the bridge: a later
sender never redirects GCS traffic, and datagrams from outside loopback,
private (RFC 1918), link-local and carrier-grade NAT (100.64.0.0/10) addresses
are dropped. Restart the bridge if the vehicle's address changes.

## CLI Options

| Flag | Default | Description |
|------|---------|-------------|
| `--in <spec>` | (required) | Input endpoint to bridge (see above) |
| `--ws <port>` | `14551` | WebSocket listen port for the GCS |
| `--ws-host <addr>` | `127.0.0.1` | WebSocket bind address |
| `--allow-origin <origin>` | — | Also accept a GCS page from this exact origin (repeatable) |
| `-h`, `--help` | — | Show help |

`--input` and `--ws-port` are accepted as aliases of `--in` and `--ws`.

## Notes

- The bridge does not decode MAVLink. It moves raw bytes, so it works with any
  MAVLink dialect and version. The one check it makes is in UDP `listen` mode,
  where only a datagram that starts with a MAVLink v1/v2 frame can set the peer.
- UDP is connectionless. In `listen` mode the bridge cannot send GCS traffic
  until it has seen a MAVLink frame from the vehicle and learned the peer. On a
  socket error it rebinds with exponential backoff and keeps the learned peer.
- TCP reconnects automatically with exponential backoff if the upstream server
  drops or is not yet up.

## License

GPL-3.0-only
