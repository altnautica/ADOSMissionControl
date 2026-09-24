# Self-host broker auth sync sidecar.
#
# Built on the broker's own image so mosquitto_passwd hashes exactly as the
# broker verifies. The sidecar shares the broker's PID namespace (compose
# `pid: service:mosquitto`) to SIGHUP it; no docker socket is involved.
FROM eclipse-mosquitto:2

RUN apk add --no-cache bash curl jq coreutils

COPY scripts/regenerate-passwd.sh scripts/auth-sync-loop.sh /scripts/
RUN chmod 0755 /scripts/regenerate-passwd.sh /scripts/auth-sync-loop.sh

ENTRYPOINT ["/scripts/auth-sync-loop.sh"]
