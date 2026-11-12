"use client";

/**
 * @module drone-detail/AircraftSetupForDrone
 * @description The agent-run setup wizards (calibration, initial tune, the
 * ADOS Pilot hand-over) for one named drone, headed "Setting up {name}" so the
 * operator always sees which aircraft the steps act on. Used by the drone's
 * Setup nav and by Settings › Aircraft setup.
 *
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";

import { AircraftSetupView } from "@/components/aircraft-setup/AircraftSetupView";
import { useDroneSetupTransport, useFcSetup } from "@/lib/fc-setup/use-fc-setup";

export function AircraftSetupForDrone({ droneId, droneName }: { droneId: string; droneName: string }) {
  const t = useTranslations("aircraftSetup");
  const transport = useDroneSetupTransport(droneId);
  const setup = useFcSetup(transport);
  return (
    <section className="flex flex-col gap-3" aria-label={t("settingUp", { name: droneName })}>
      <h2 className="text-sm font-semibold text-text-primary">{t("settingUp", { name: droneName })}</h2>
      {transport ? (
        <AircraftSetupView setup={setup} />
      ) : (
        <p className="rounded-md border border-border-default bg-bg-secondary px-4 py-3 text-sm text-text-secondary">
          {t("noAgent")}
        </p>
      )}
    </section>
  );
}
