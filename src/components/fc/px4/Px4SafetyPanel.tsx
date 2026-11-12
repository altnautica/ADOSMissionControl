"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { ShieldAlert } from "lucide-react";
import { ParamFieldsPanel, type ParamSection } from "../shared/ParamFieldsPanel";

/**
 * PX4 failure detector and return-to-launch geometry. Circuit breakers
 * (CBRK_*) disable safety checks outright and stay in Parameters only.
 */
export function Px4SafetyPanel() {
  const tr = useTranslations("fcPanels.px4Safety");
  const sections = useMemo<ParamSection[]>(
    () => [
      {
        title: tr("failureDetector"),
        fields: [
          { param: "FD_FAIL_P", label: tr("maxPitch"), kind: "number", min: 0, max: 180, step: 1 },
          { param: "FD_FAIL_R", label: tr("maxRoll"), kind: "number", min: 0, max: 180, step: 1 },
          { param: "FD_FAIL_P_TTRI", label: tr("pitchTrigger"), kind: "number", min: 0.02, max: 5, step: 0.01 },
          { param: "FD_FAIL_R_TTRI", label: tr("rollTrigger"), kind: "number", min: 0.02, max: 5, step: 0.01 },
        ],
      },
      {
        title: tr("returnToLaunch"),
        fields: [
          { param: "RTL_TYPE", label: tr("rtlType"), kind: "enum" },
          { param: "RTL_RETURN_ALT", label: tr("returnAlt"), kind: "number", min: 0, max: 150, step: 0.5 },
          { param: "RTL_DESCEND_ALT", label: tr("descendAlt"), kind: "number", min: 2, max: 100, step: 0.5 },
          { param: "RTL_LAND_DELAY", label: tr("landDelay"), kind: "number", min: -1, max: 300, step: 0.5 },
          { param: "RTL_CONE_ANG", label: tr("coneAngle"), kind: "enum" },
        ],
      },
    ],
    [tr],
  );
  return (
    <ParamFieldsPanel
      panelId="px4-safety"
      title={tr("title")}
      subtitle={tr("subtitle")}
      icon={<ShieldAlert size={16} />}
      sectionIcon={<ShieldAlert size={14} />}
      sections={sections}
    />
  );
}
