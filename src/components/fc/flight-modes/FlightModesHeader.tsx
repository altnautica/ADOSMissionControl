"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { RotateCcw, Save, HardDrive } from "lucide-react";
import { SaveBarLabel } from "@/components/fc/shared/SaveBarLabel";

interface FlightModesHeaderProps {
  isDirty: boolean;
  totalDirtyCount: number;
  dirtySlotCount: number;
  loading: boolean;
  saving: boolean;
  /** True while Write to Flash runs: the button shows busy and is disabled. */
  flashing?: boolean;
  showCommitButton: boolean;
  onRead: () => void;
  onSave: () => void;
  onCommit: () => void;
}

export function FlightModesHeader({
  isDirty,
  totalDirtyCount,
  dirtySlotCount,
  loading,
  saving,
  flashing = false,
  showCommitButton,
  onRead,
  onSave,
  onCommit,
}: FlightModesHeaderProps) {
  const tr = useTranslations("fcPanels.flightModesHeader");
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-semibold text-text-primary">{tr("flightModes")}</h2>
        {isDirty && (
          <span className="flex items-center gap-1 text-[10px] text-status-warning">
            <span className="w-1.5 h-1.5 rounded-full bg-status-warning" />
            {tr("unsavedCount", { count: totalDirtyCount })}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          icon={<RotateCcw size={12} />}
          loading={loading}
          onClick={onRead}
        >
          {tr("read")}
        </Button>
        <Button
          variant="primary"
          size="sm"
          icon={<Save size={12} />}
          loading={saving}
          disabled={!isDirty}
          onClick={onSave}
        >
          {dirtySlotCount > 0 ? tr("saveCount", { count: dirtySlotCount }) : tr("save")}
        </Button>
        {showCommitButton && (
          <Button
            variant="secondary"
            size="sm"
            icon={<HardDrive size={12} />}
            onClick={onCommit}
            disabled={flashing}
            loading={flashing}
          >
            <SaveBarLabel k="writeToFlash" />
          </Button>
        )}
      </div>
    </div>
  );
}
