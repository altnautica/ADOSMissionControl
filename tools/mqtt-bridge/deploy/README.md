# MQTT relay deployment

Reference deployment for the ADOS cloud relay stack: a Mosquitto MQTT broker
plus a Node bridge that forwards agent heartbeats to Convex. Designed to run
behind a Cloudflare Tunnel on a small VM or LXC container.

```
agent (drone)  ─MQTT(S)─►  mosquitto  ─►  mqtt-bridge  ─►  Convex
                              ▲
                              │
GCS browser  ─MQTT/WSS─────────┘  (also subscribes to ados/<device>/*)
```

This README covers the production deployment with per-device auth. For a
quick anonymous bench broker (CI fixtures), see the comments at the bottom of
`mosquitto.conf`.

## Auth model

Four principal types connect to the broker:

| Principal | Username | Password source | Permissions |
|---|---|---|---|
| Drone agent | `<device_id>` (current firmware) or `ados-<device_id>` (legacy firmware; transitional) | `cmd_drones.apiKey` from Convex; same value the agent uses for HTTP `X-ADOS-Key` | `readwrite ados/<device_id>/#` |
| Bridge service account | `ados` | `MQTT_PASSWORD` env var on the broker host | `read ados/#` |
| GCS browser session | `gcs-op-<random>` | minted per operator by Convex `cmdMqttControlGrants.mint`, returned in plaintext once and held in the tab's memory | `readwrite ados/<device_id>/#` for each drone that operator owns |
| Legacy shared viewer | `gcs-viewer` | `MQTT_VIEWER_PASSWORD` env var on the broker host | `read ados/#` |

No browser reads `gcs-viewer` any more. It granted every operator read access to
every topic of every drone in the fleet and could not publish at all, so no
browser session could command over the relay; per-operator write grants replaced
it on both counts. The principal is still generated so a broker mid-rollout keeps
serving a Mission Control build that predates the grant path; retiring it means
removing it from `regenerate-passwd.sh`, which currently refuses to run without
`MQTT_VIEWER_PASSWORD`.

The ACL is generated alongside the passwd file from the device list in
Convex; both files are atomic-swapped into place on every regen.

`regenerate-passwd.sh` writes BOTH username conventions (legacy prefixed +
canonical bare) for each device so a fleet midway through a firmware
upgrade keeps working. Set `DROP_LEGACY_USERNAMES=1` in the script env
once every agent has rolled over to the canonical username.

## Production deployment

The reference layout (a self-hosted broker reached at
`mqtt.your-domain.com`):

```
/opt/relay/
├── docker-compose.yml
├── .env                        # MQTT_PASSWORD for the bridge user
└── mosquitto/
    ├── mosquitto.conf          # from this directory
    ├── acl.conf                # from this directory
    └── passwd                  # generated; one line per paired device + bridge
```

The `passwd` file is the only piece that contains secrets. **Never commit
it** — see `.gitignore` in this directory.

### One-time setup

1. Pick a strong password for the bridge service account. Add it to your
   broker host's `/opt/relay/.env` as `MQTT_PASSWORD=<value>` (the bridge
   container already reads this via `MQTT_USERNAME=ados` /
   `MQTT_PASSWORD=${MQTT_PASSWORD}`).
2. Pick a strong relay secret (`openssl rand -hex 32`). Set it as
   `MQTT_AUTH_RELAY_SECRET` BOTH on the Convex deployment AND in
   `/opt/relay/.env` on the broker host. This gates the
   `/admin/mqtt-auth-entries` httpAction that the regen script reads.
3. Pick a strong viewer password (`openssl rand -base64 24`) and set
   `MQTT_VIEWER_PASSWORD` in `/opt/relay/.env` on the broker host. Nothing
   publishes it to a browser: it exists only for Mission Control builds that
   predate per-operator grants. `regenerate-passwd.sh` still aborts without it,
   so it is required until that principal is retired from the script.
4. Deploy the Convex functions (`npx convex deploy`) so the
   `clientConfig`, `cmdMqttControlGrants`, `cmdPairing.listMqttAuthEntries`, and
   `/admin/mqtt-auth-entries` paths are live.
5. Make sure Mission Control has been rebuilt with the grant path landed (this
   monorepo's `src/stores/mqtt-control-grant-store.ts` mints the credential and
   injects it into `src/lib/mqtt-broker-credential.ts`, which every MQTT client
   reads at connect time). **A push alone does not rebuild anything** — rebuild
   and redeploy Mission Control explicitly before relying on the grant path.
6. Copy `mosquitto.conf`, `acl.conf` (will be auto-generated; see below),
   `regenerate-passwd.sh`, `activate-auth.sh`, and `deactivate-auth.sh`
   from this directory to the broker host's `/opt/relay/`.
7. Update `docker-compose.yml` on the broker host to mount `acl.conf`
   alongside the existing `mosquitto.conf` + `passwd` mounts. The full
   volumes block looks like:
   ```yaml
   services:
     mosquitto:
       volumes:
         - ./mosquitto/mosquitto.conf:/mosquitto/config/mosquitto.conf:ro
         - ./mosquitto/acl.conf:/mosquitto/config/acl.conf:ro
         - ./mosquitto/passwd:/mosquitto/config/passwd:ro
         - mosquitto-data:/mosquitto/data
   ```
8. Generate the initial `passwd` + `acl.conf` (the script writes both):
   ```bash
   cd /opt/relay
   set -a; source .env; set +a
   ./regenerate-passwd.sh
   ```
9. Flip auth on:
   ```bash
   ./activate-auth.sh
   ```
   To roll back: `./deactivate-auth.sh`. Both scripts are idempotent and
   take backups before changing `mosquitto.conf`.
10. Watch the broker logs for any `not authorised` lines and confirm the
    GCS reconnects with the viewer credential. If the GCS isn't picking
    up the new credential, do a hard refresh — the Convex query result is
    cached client-side until the page reloads.

### Generating passwd

#### Altnautica production (this monorepo)

Use the helper script. It hits a Convex httpAction (gated by
`MQTT_AUTH_RELAY_SECRET`) to pull paired devices, runs `mosquitto_passwd`
inside the broker container, atomic-renames the new passwd into place,
and SIGHUPs the broker.

One-time setup (operator):

1. Pick a strong relay secret (`openssl rand -hex 32`). Add it to:
   - Convex environment as `MQTT_AUTH_RELAY_SECRET` (via the self-hosted
     dashboard or `npx convex env set MQTT_AUTH_RELAY_SECRET …` from a
     dev machine).
   - The broker host's `/opt/relay/.env` as `MQTT_AUTH_RELAY_SECRET=…`.
2. Pick a strong bridge password and store it in `/opt/relay/.env` as
   `MQTT_PASSWORD=…` (the bridge already reads this env var).
3. Deploy the Convex changes (`npx convex deploy` from a dev machine)
   so the `/admin/mqtt-auth-entries` httpAction is live.
4. Copy `scripts/regenerate-passwd.sh` to `/opt/relay/regenerate-passwd.sh`,
   `chmod +x`, run once to seed `/opt/relay/mosquitto/passwd`.

```bash
# On the broker host (alt-services):
cd /opt/relay
set -a; source .env; set +a
./regenerate-passwd.sh
```

5. Optional: install a systemd timer (or cron) that runs the script every
   60 seconds so newly-paired devices authenticate without operator
   intervention. Example unit at the bottom of this README.

#### OSS self-hosters

Use `mosquitto_passwd` directly. For each paired device, you'll need its
`device_id` (the username) and its `api_key` (the password). Both are stored
in your Convex deployment on the `cmd_drones` table after pairing.

```bash
# First entry creates the file:
mosquitto_passwd -c /opt/relay/mosquitto/passwd <device_id>
# Subsequent entries append:
mosquitto_passwd /opt/relay/mosquitto/passwd <another_device_id>
# Add the bridge service account last:
mosquitto_passwd /opt/relay/mosquitto/passwd ados
# Reload the broker:
docker exec relay-mosquitto-1 kill -HUP 1
```

`mosquitto_passwd` will prompt for each password interactively. If you'd
rather scriptify it, pass `-b` and feed plaintext passwords from a secrets
manager — never from a shell history file.

### Adding a device

After a new agent finishes pairing through Mission Control, it will appear
in the `cmd_drones` Convex table with a fresh `apiKey`. The broker won't let
the agent connect until that `(device_id, api_key)` lands in `passwd`. Run
the regen script (Altnautica) or `mosquitto_passwd` (OSS) and SIGHUP the
broker.

For Altnautica production, the regen script is also wired to a 60-second
systemd timer so new devices authenticate within 1 minute of pairing without
operator intervention.

### Revoking a device

1. Delete the device row from Convex (`cmd_drones`).
2. Re-run the regen script (Altnautica) OR manually remove the line from
   `passwd` and SIGHUP the broker (OSS).

Existing connections from the revoked device persist until the next reconnect.
For immediate disconnect, restart the broker container.

## Sanity checks

```bash
# Inside the broker container:
docker exec -it relay-mosquitto-1 sh

# 1. Device can publish to its own subtree.
mosquitto_pub -h localhost -p 1883 \
  -u <device_id> -P <api_key> \
  -t "ados/<device_id>/test" -m "hello"
# Should succeed.

# 2. Device CANNOT publish to another device's subtree.
mosquitto_pub -h localhost -p 1883 \
  -u <device_id> -P <api_key> \
  -t "ados/<other_device>/test" -m "should fail"
# Should be silently dropped by the ACL (return code 0 but no message
# delivered). Confirm by watching the broker logs for "Denied".

# 3. GCS viewer can subscribe to any device's status topic.
mosquitto_sub -h localhost -p 1883 \
  -u gcs-viewer -P <MQTT_VIEWER_PASSWORD> \
  -t "ados/+/status" -C 1 -W 5
# Should print one status message OR time out cleanly (return 27).

# 4. GCS viewer CANNOT publish.
mosquitto_pub -h localhost -p 1883 \
  -u gcs-viewer -P <MQTT_VIEWER_PASSWORD> \
  -t "ados/<device_id>/command" -m "should fail"
# Should be denied by the ACL.
```

## Limitations

- The agent's MQTT password equals its Convex `apiKey`. If you rotate the
  apiKey on a device row in Convex (re-pairing), you MUST regenerate `passwd`
  before the agent reconnects.
- New devices have a ≤ 60s authentication window after pairing while waiting
  for the regen timer.
- The bridge container's `MQTT_PASSWORD` env var lives in `/opt/relay/.env`
  on the broker host. Protect that file with mode `600` and don't ship it
  off-host.

## Systemd timer for automatic regen

Copy these unit files to `/etc/systemd/system/` on the broker host:

`mqtt-passwd-regen.service`:
```ini
[Unit]
Description=Regenerate mosquitto passwd from Convex paired devices
After=docker.service

[Service]
Type=oneshot
EnvironmentFile=/opt/relay/.env
WorkingDirectory=/opt/relay
ExecStart=/opt/relay/regenerate-passwd.sh
```

`mqtt-passwd-regen.timer`:
```ini
[Unit]
Description=Run mqtt-passwd-regen every 60 seconds

[Timer]
OnBootSec=30s
OnUnitActiveSec=60s
Unit=mqtt-passwd-regen.service

[Install]
WantedBy=timers.target
```

Activate with:
```bash
systemctl daemon-reload
systemctl enable --now mqtt-passwd-regen.timer
systemctl status mqtt-passwd-regen.timer
```
