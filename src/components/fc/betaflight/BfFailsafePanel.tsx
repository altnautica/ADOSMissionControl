"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { ShieldAlert } from "lucide-react";
import { ParamFieldsPanel, type ParamSection } from "../shared/ParamFieldsPanel";

/**
 * Betaflight failsafe (MSP_FAILSAFE_CONFIG), read and written through the
 * BF_FS_* virtual parameters.
 */
export function BfFailsafePanel() {
  const tr = useTranslations("fcPanels.bfFailsafe");
  const sections = useMemo<ParamSection[]>(
    () => [
      {
        title: tr("stage2"),
        fields: [
          { param: "BF_FS_PROCEDURE", label: tr("procedure"), kind: "number", min: 0, max: 2, step: 1 },
          { param: "BF_FS_DELAY", label: tr("delay"), kind: "number", min: 0, max: 200, step: 1 },
          { param: "BF_FS_OFF_DELAY", label: tr("offDelay"), kind: "number", min: 0, max: 200, step: 1 },
          { param: "BF_FS_THROTTLE", label: tr("throttle"), kind: "number", min: 1000, max: 2000, step: 1 },
          { param: "BF_FS_THROTTLE_LOW_DELAY", label: tr("throttleLowDelay"), kind: "number", min: 0, max: 300, step: 1 },
          { param: "BF_FS_SWITCH_MODE", label: tr("switchMode"), kind: "number", min: 0, max: 2, step: 1 },
        ],
      },
    ],
    [tr],
  );
  return (
    <ParamFieldsPanel
      panelId="bf-failsafe"
      title={tr("title")}
      subtitle={tr("subtitle")}
      icon={<ShieldAlert size={16} />}
      sectionIcon={<ShieldAlert size={14} />}
      sections={sections}
    />
  );
}
