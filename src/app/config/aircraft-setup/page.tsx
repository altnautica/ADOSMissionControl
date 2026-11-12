"use client";

/**
 * Settings › Aircraft setup: pick a drone with an agent, then run its
 * agent-run setup wizards. The page names the drone it acts on.
 * @license GPL-3.0-only
 */

import { useEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { AircraftSetupForDrone } from "@/components/drone-detail/AircraftSetupForDrone";
import { resolveRelayReach } from "@/lib/nodes/relay-reach";
import { useDroneManager } from "@/stores/drone-manager";
import { fleetFieldsEqual, selectFleet, useFleetDrones } from "@/stores/node-registry/use-fleet-drones";

const FLEET_EQUAL = fleetFieldsEqual(["name", "cloudDeviceId", "reachedVia"]);

export default function AircraftSetupPage() {
  const t = useTranslations("aircraftSetup");
  const droneId = useDroneManager((s) => s.selectedDroneId);
  const selectDrone = useDroneManager((s) => s.selectDrone);
  const drones = useFleetDrones(selectFleet, FLEET_EQUAL);
  const router = useRouter();
  // `?drone=<id>` names the drone, so a reload or a shared link opens the
  // same drone's setup instead of an empty page.
  const urlDrone = useSearchParams()?.get("drone") ?? null;
  useEffect(() => {
    if (urlDrone && urlDrone !== droneId && drones.some((d) => d.id === urlDrone)) selectDrone(urlDrone);
  }, [urlDrone, droneId, drones, selectDrone]);

  // Fleet rows with an agent: the wizards run on the drone's agent.
  const withAgent = useMemo(
    () =>
      drones.filter(
        (d) =>
          d.cloudDeviceId != null ||
          resolveRelayReach({ agentDeviceId: null, reachedVia: d.reachedVia, droneDeviceId: d.id }) !== null,
      ),
    [drones],
  );
  const selected = droneId ? drones.find((d) => d.id === droneId) : undefined;

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="mx-auto flex max-w-5xl flex-col gap-4">
        <div>
          <h1 className="text-lg font-semibold text-text-primary">{t("title")}</h1>
          <p className="mt-0.5 text-xs text-text-tertiary">{t("description")}</p>
        </div>
        <label className="flex max-w-sm flex-col gap-1 text-xs text-text-secondary">
          {t("pickDrone")}
          <select
            className="rounded border border-border-default bg-bg-secondary px-2 py-1.5 text-sm text-text-primary"
            value={selected ? selected.id : ""}
            onChange={(e) => {
              if (!e.target.value) return;
              selectDrone(e.target.value);
              router.replace(`/config/aircraft-setup?drone=${encodeURIComponent(e.target.value)}`);
            }}
          >
            <option value="" disabled>
              {withAgent.length === 0 ? t("noDronesWithAgent") : t("pickDronePlaceholder")}
            </option>
            {withAgent.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        {selected ? (
          <AircraftSetupForDrone droneId={selected.id} droneName={selected.name} />
        ) : (
          <p className="rounded-md border border-border-default bg-bg-secondary px-4 py-3 text-sm text-text-secondary">
            {t("noDrone")}
          </p>
        )}
      </div>
    </div>
  );
}
