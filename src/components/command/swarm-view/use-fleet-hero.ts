"use client";

/**
 * @module command/swarm-view/use-fleet-hero
 * @description Promoting one drone to the full-rate video profile.
 *
 * Hero is not Pin. Pin is personal, multi-select and bandwidth-neutral — it
 * reorders which feeds get a slot in the round-robin. Hero is exclusive and
 * changes the aircraft's actual RF allocation: promoting slot 3 demotes
 * whoever held it to 1 fps. The two verbs never share a control, an icon or a
 * handler, for the same reason Zoom keeps Spotlight and Pin apart.
 *
 * The request is the only thing this hook owns. What the board renders as
 * "hero" is the beacon's own bit, so a demotion that failed shows as two heroes
 * on the table instead of as a lie this hook told on the agent's behalf.
 *
 * The request goes to the ground station the board is polled from — a
 * LAN-paired node with the `ground-station` profile, the same set
 * `SwarmBeaconBridge` reads — never to whichever node happens to be focused.
 * `SwarmView` calls this once and hands the result to every band, so the
 * table and the video rail share one pending state.
 *
 * @license GPL-3.0-only
 */

import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { useLocalNodesStore } from "@/stores/local-nodes-store";
import { resolveLanAgentUrl } from "@/lib/agent/resolve-agent";
import { groundStationApiFromAgent } from "@/lib/api/ground-station-api";
import { fleetHeroFailureReason } from "@/lib/api/ground-station/fleet";
import { isDemoMode } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";

export interface FleetHero {
  /** The device a promotion is in flight for, for the row's pending state. */
  pendingDeviceId: string | null;
  /** True when no ground station is reachable, so the control disables itself. */
  unavailable: boolean;
  makeHero: (deviceId: string) => void;
}

export function useFleetHero(): FleetHero {
  const t = useTranslations("swarmView.hero");
  const { toast } = useToast();
  // The first LAN-paired ground station, as a stable store reference.
  const groundStation = useLocalNodesStore((s) =>
    s.nodes.find((n) => n.profile === "ground-station"),
  );
  const [pendingDeviceId, setPendingDeviceId] = useState<string | null>(null);
  const demo = isDemoMode();

  // Null on an HTTPS origin (the browser blocks a plain-HTTP LAN call) or when
  // the ground station has no reachable host: the control disables itself.
  const api = useMemo(() => {
    if (!groundStation) return null;
    return groundStationApiFromAgent(
      resolveLanAgentUrl(groundStation.deviceId),
      groundStation.apiKey ?? null,
    );
  }, [groundStation]);

  const makeHero = useCallback(
    (deviceId: string) => {
      if (demo) {
        // DEMO-MODE BRANCH (gated on isDemoMode, real fleets unaffected):
        // loaded on demand so the mock never reaches a production bundle. No
        // toast on success — what the board renders as hero is the beacon's
        // own bit, so the demo bus's own payload moving it on the next tick
        // IS the confirmation, same contract the real path has.
        setPendingDeviceId(deviceId);
        void import("@/mock/swarm-beacons")
          .then(({ setDemoSwarmHero }) => setDemoSwarmHero(deviceId))
          .finally(() => setPendingDeviceId(null));
        return;
      }
      if (!api) return;
      setPendingDeviceId(deviceId);
      void api
        .setFleetHero(deviceId)
        .catch((err: unknown) => {
          // A 502 is the hero's own promotion failing: its row names why.
          toast(t("failed", { reason: fleetHeroFailureReason(err) }), "error");
        })
        .finally(() => setPendingDeviceId(null));
    },
    [api, toast, t, demo],
  );

  return {
    pendingDeviceId,
    unavailable: demo ? false : api === null,
    makeHero,
  };
}
