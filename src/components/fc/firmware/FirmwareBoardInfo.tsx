"use client";

import { useTranslations } from "next-intl";
import { CheckCircle2 } from "lucide-react";

interface FirmwareBoardInfoProps {
  firmwareVersionString: string;
  vehicleClass: string;
  systemId: number;
}

export function FirmwareBoardInfo({ firmwareVersionString, vehicleClass, systemId }: FirmwareBoardInfoProps) {
  const tr = useTranslations("fcPanels.firmwareBoardInfo");
  return (
    <div className="bg-bg-secondary border border-border-default p-4 space-y-2">
      <div className="flex items-center gap-2">
        <CheckCircle2 size={14} className="text-status-success" />
        <span className="text-xs font-semibold text-text-primary">{tr("connectedBoard")}</span>
      </div>
      <div className="grid grid-cols-3 gap-3 text-xs">
        <div>
          <p className="text-[10px] text-text-tertiary uppercase">{tr("firmware")}</p>
          <p className="font-mono text-text-primary">{firmwareVersionString || "Unknown"}</p>
        </div>
        <div>
          <p className="text-[10px] text-text-tertiary uppercase">{tr("vehicle")}</p>
          <p className="font-mono text-text-primary capitalize">{vehicleClass}</p>
        </div>
        <div>
          <p className="text-[10px] text-text-tertiary uppercase">{tr("systemID")}</p>
          <p className="font-mono text-text-primary">{systemId}</p>
        </div>
      </div>
    </div>
  );
}
