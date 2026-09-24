#!/usr/bin/env bash
# Keep the broker's passwd and ACL in step with Convex.
#
# Entrypoint of the self-host `mqtt-auth-sync` sidecar. Every
# SYNC_INTERVAL_SECONDS it runs regenerate-passwd.sh in local mode, which pulls
# /admin/mqtt-auth-entries, rewrites the shared passwd/acl.conf in place and
# SIGHUPs the broker through the PID namespace this container shares with it.
#
# A failed sync (Convex unreachable, a truncated payload) is retried on the same
# fixed cadence, forever: a newly paired drone connects on the next good pass.
# The one exit is losing the broker's PID namespace (the broker container was
# recreated): exiting lets the restart policy rejoin the new one.
set -u

interval="${SYNC_INTERVAL_SECONDS:-30}"
export BROKER_CONTAINER=local

while true; do
  if ! pidof mosquitto >/dev/null 2>&1; then
    echo "mqtt-auth-sync: no mosquitto in this PID namespace; exiting to rejoin" >&2
    exit 1
  fi
  if ! /scripts/regenerate-passwd.sh; then
    echo "mqtt-auth-sync: sync failed; retrying in ${interval}s" >&2
  fi
  sleep "${interval}"
done
