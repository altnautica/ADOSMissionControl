"use client";

/**
 * Settings › Aircraft setup: the selected drone's agent-run setup wizards.
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";

import { AircraftSetupView } from "@/components/aircraft-setup/AircraftSetupView";
import { useDroneSetupTransport, useFcSetup } from "@/lib/fc-setup/use-fc-setup";
import { useDroneManager } from "@/stores/drone-manager";

export default function AircraftSetupPage() {
  const t = useTranslations("aircraftSetup");
  const droneId = useDroneManager((s) => s.selectedDroneId);
  const transport = useDroneSetupTransport(droneId);
  const setup = useFcSetup(transport);

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="mx-auto flex max-w-5xl flex-col gap-4">
        <div>
          <h1 className="text-lg font-semibold text-text-primary">{t("title")}</h1>
          <p className="mt-0.5 text-xs text-text-tertiary">{t("description")}</p>
        </div>
        {transport ? (
          <AircraftSetupView setup={setup} />
        ) : (
          <p className="rounded-md border border-border-default bg-bg-secondary px-4 py-3 text-sm text-text-secondary">
            {droneId ? t("noAgent") : t("noDrone")}
          </p>
        )}
      </div>
    </div>
  );
}
