"use client";

import { useTranslations } from "next-intl";
import { OperatorProfileEditor } from "@/components/config/operator/OperatorProfileEditor";
import { AircraftRegistryEditor } from "@/components/config/operator/AircraftRegistryEditor";
import { BatteryRegistryEditor } from "@/components/config/operator/BatteryRegistryEditor";
import { EquipmentRegistryEditor } from "@/components/config/operator/EquipmentRegistryEditor";

export default function OperatorPage() {
  const t = useTranslations("operatorRegistry");
  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-3xl flex flex-col gap-4">
        <div>
          <h1 className="text-sm font-display font-semibold text-text-primary">
            {t("pageTitle")}
          </h1>
          <p className="text-[11px] text-text-tertiary mt-1">{t("pageBlurb")}</p>
        </div>
        <OperatorProfileEditor />
        <AircraftRegistryEditor />
        <BatteryRegistryEditor />
        <EquipmentRegistryEditor />
      </div>
    </div>
  );
}
