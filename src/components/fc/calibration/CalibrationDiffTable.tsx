"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

interface CalibrationDiffTableProps {
  calDiff: Array<{ name: string; before: number; after: number }>;
  calDiffType: string;
  onDismiss: () => void;
}

export function CalibrationDiffTable({ calDiff, calDiffType, onDismiss }: CalibrationDiffTableProps) {
  const tl = useTranslations("fcPanels.calibrationDiffTable");
  if (!calDiff || calDiff.length === 0 || !calDiffType) return null;

  return (
    <div className="border border-border-default bg-bg-secondary p-4">
      <div className="flex items-start justify-between mb-2">
        <div>
          <h3 className="text-xs font-medium text-text-primary">
            {calDiffType.charAt(0).toUpperCase() + calDiffType.slice(1)} Calibration Changes
          </h3>
          <p className="text-[10px] text-text-tertiary mt-0.5">
            {tl("parametersChangedDuringCalibration")}
          </p>
        </div>
        <button
          className="text-[10px] text-text-tertiary hover:text-text-secondary"
          onClick={onDismiss}
        >
          {tl("dismiss")}
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[10px] font-mono">
          <thead>
            <tr className="text-text-tertiary">
              <th className="text-left px-1 py-0.5">{tl("parameter")}</th>
              <th className="text-right px-1 py-0.5">{tl("before")}</th>
              <th className="text-right px-1 py-0.5">{tl("after")}</th>
              <th className="text-right px-1 py-0.5">{tl("change")}</th>
            </tr>
          </thead>
          <tbody>
            {calDiff.map((d) => {
              const change = d.after - d.before;
              return (
                <tr key={d.name} className="border-t border-border-default/50">
                  <td className="text-left px-1 py-0.5 text-text-secondary">{d.name}</td>
                  <td className="text-right px-1 py-0.5 text-text-tertiary">{d.before.toFixed(4)}</td>
                  <td className="text-right px-1 py-0.5 text-text-primary">{d.after.toFixed(4)}</td>
                  <td className={cn(
                    "text-right px-1 py-0.5",
                    change > 0 ? "text-status-success" : change < 0 ? "text-status-warning" : "text-text-tertiary"
                  )}>
                    {change > 0 ? "+" : ""}{change.toFixed(4)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
