"use client";

/**
 * @module plugins/parameters/use-camera-roster
 * @description The node's camera roster (`GET /api/video/roster`) for a plugin
 * parameter's `camera` widget. Reached the way every plugin wire call reaches a
 * node (its own LAN address, or its ground station's relay-proxy). `null`
 * means the roster could not be read (no path, an HTTPS page that cannot dial
 * the plain-HTTP node, or a failed request), so the widget can say so instead
 * of offering an empty list as if the node had no cameras.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useState } from "react";

import { coerceRoster } from "@/lib/agent/camera-roster";
import { timedFetch } from "@/lib/agent/agent-client/timeout";
import type { RosterCamera } from "@/lib/agent/feature-types";
import { isHttpsOrigin, resolveNodeAgentReach } from "@/lib/plugins/node-agent-reach";
import { relayProxyBaseUrl } from "@/lib/nodes/relay-reach";
import { isDemoMode } from "@/lib/utils";

async function fetchRoster(deviceId: string): Promise<RosterCamera[] | null> {
  if (isDemoMode()) {
    // Loaded on demand so the demo fixture never reaches a production bundle.
    const { getMockCameraRoster } = await import("@/mock/agent/cameras");
    return getMockCameraRoster();
  }
  const reach = resolveNodeAgentReach(deviceId);
  if (!reach || isHttpsOrigin()) return null;
  const base = reach.peerDeviceId
    ? relayProxyBaseUrl({
        baseUrl: reach.hostUrl,
        apiKey: reach.apiKey,
        peerDeviceId: reach.peerDeviceId,
      })
    : reach.hostUrl.replace(/\/$/, "");
  const res = await timedFetch(`${base}/api/video/roster`, {
    headers: { "X-ADOS-Key": reach.apiKey },
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { cameras?: unknown };
  return coerceRoster(body.cameras);
}

/** The roster for `deviceId`, `undefined` while loading, `null` when unreadable. */
export function useCameraRoster(
  deviceId: string | undefined,
): RosterCamera[] | null | undefined {
  const [roster, setRoster] = useState<RosterCamera[] | null | undefined>(undefined);
  useEffect(() => {
    if (!deviceId) {
      setRoster(null);
      return;
    }
    let alive = true;
    setRoster(undefined);
    fetchRoster(deviceId)
      .then((r) => {
        if (alive) setRoster(r);
      })
      .catch(() => {
        if (alive) setRoster(null);
      });
    return () => {
      alive = false;
    };
  }, [deviceId]);
  return roster;
}
