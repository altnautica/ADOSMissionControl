#!/usr/bin/env bash
# Roll back mosquitto.conf to anonymous mode. Useful when:
#   - GCS browsers are failing to connect because their operator grant has not
#     reached the broker yet (regenerate-passwd.sh has not run since the mint)
#   - A new device is being paired and you haven't run regenerate-passwd.sh
#   - You want to debug without auth interference
#
# Run on the broker host:
#   ./deactivate-auth.sh

set -euo pipefail

MOSQ_CONF="${MOSQ_CONF:-/opt/relay/mosquitto/mosquitto.conf}"
BROKER_CONTAINER="${BROKER_CONTAINER:-relay-mosquitto-1}"

stamp="$(date +%s)"
cp -p "${MOSQ_CONF}" "${MOSQ_CONF}.bak.${stamp}"

cat > "${MOSQ_CONF}" <<'CONF'
# Mosquitto broker config — ANONYMOUS (no auth, no ACL).
# For bench/dev OR temporary rollback only. Restore production auth via
# activate-auth.sh.

listener 1883
listener 9001
protocol websockets
allow_anonymous true
persistence true
persistence_location /mosquitto/data/
autosave_interval 1800
CONF

docker exec "${BROKER_CONTAINER}" sh -c 'kill -HUP 1' 2>/dev/null || true

sleep 1
if docker ps --filter "name=${BROKER_CONTAINER}" --format "{{.Status}}" | grep -q "Up"; then
  echo "deactivate-auth: anonymous mode active. Backup at ${MOSQ_CONF}.bak.${stamp}"
else
  echo "deactivate-auth: broker is NOT running after flip. Check logs:" >&2
  docker logs --tail 30 "${BROKER_CONTAINER}" >&2
  exit 1
fi
