"use client";

/**
 * @module AtlasRequirementsChecklist
 * @description Renders the Atlas capture requirements list (cameras / compute
 * node reachable / capture service) with a per-row check / warning / X icon and
 * a "what to do" detail line. Pure presentation over the gate computed by
 * `computeCaptureGate`; keeps the honesty discipline of `PreArmChecks` (never a
 * false green — a warning tone reads amber, an unmet requirement reads red with
 * the action to take).
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { Check, X, AlertTriangle, CircleHelp } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  AtlasRequirement,
  RequirementTone,
} from "@/lib/atlas/capture-requirements";

const TONE_ICON: Record<RequirementTone, typeof Check> = {
  met: Check,
  warning: AlertTriangle,
  unmet: X,
  unknown: CircleHelp,
};

const TONE_COLOR: Record<RequirementTone, string> = {
  met: "text-status-success",
  warning: "text-status-warning",
  unmet: "text-status-error",
  unknown: "text-text-tertiary",
};

export function AtlasRequirementsChecklist({
  requirements,
}: {
  requirements: AtlasRequirement[];
}) {
  const t = useTranslations("atlas");
  return (
    <div className="space-y-1.5">
      <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
        {t("capture.requirementsTitle")}
      </h3>
      <ul className="space-y-1.5">
        {requirements.map((req) => {
          const Icon = TONE_ICON[req.tone];
          return (
            <li key={req.id} className="flex items-start gap-1.5 text-[11px]">
              <Icon
                size={12}
                className={cn("shrink-0 mt-0.5", TONE_COLOR[req.tone])}
              />
              <div className="flex-1 min-w-0">
                <span className="text-text-primary font-medium">
                  {t(req.labelKey)}
                </span>
                <p className="text-text-tertiary text-[10px]">
                  {t(req.detailKey, req.detailValues)}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
