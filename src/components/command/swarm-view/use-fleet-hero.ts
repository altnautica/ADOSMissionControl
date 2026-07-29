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
 * @license GPL-3.0-only
 */

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";

import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { groundStationApiFromAgent } from "@/lib/api/ground-station-api";
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
  const agentUrl = useAgentConnectionStore((s) => s.agentUrl);
  const apiKey = useAgentConnectionStore((s) => s.apiKey);
  const [pendingDeviceId, setPendingDeviceId] = useState<string | null>(null);
  const demo = isDemoMode();

  const api = groundStationApiFromAgent(agentUrl, apiKey);

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
      const client = groundStationApiFromAgent(agentUrl, apiKey);
      if (!client) return;
      setPendingDeviceId(deviceId);
      void client
        .setFleetHero(deviceId)
        .catch((err: unknown) => {
          toast(
            t("failed", {
              reason: err instanceof Error ? err.message : String(err),
            }),
            "error",
          );
        })
        .finally(() => setPendingDeviceId(null));
    },
    [agentUrl, apiKey, toast, t, demo],
  );

  return {
    pendingDeviceId,
    unavailable: demo ? false : api === null,
    makeHero,
  };
}
