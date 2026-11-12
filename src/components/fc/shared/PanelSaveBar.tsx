"use client";

/**
 * The save / revert / flash bar at the foot of every parameter panel.
 *
 * Each panel keeps its own gating (it passes the computed `saveDisabled`,
 * the RAM-write state and its hints); this component owns the layout, the
 * shared wording and the in-flight state of the flash commit, so a second
 * press never sends a second commit.
 *
 * @license GPL-3.0-only
 */

import type { ReactNode } from "react";
import { Save, HardDrive, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SaveBarLabel } from "./SaveBarLabel";

export interface PanelSaveBarProps {
  /** "saveToFc" (default) or "saveToRam" for panels that only write RAM. */
  saveLabel?: "saveToFc" | "saveToRam";
  onSave: () => void;
  saving: boolean;
  saveDisabled: boolean;
  saveTitle?: string;
  /** Rendered only when given. */
  onRevert?: () => void;
  revertDisabled?: boolean;
  /** Show the Write to Flash button (the panel has RAM writes pending). */
  showFlash?: boolean;
  onFlash?: () => void;
  flashing?: boolean;
  flashDisabled?: boolean;
  flashTitle?: string;
  /** Extra panel-specific hint, shown after the buttons. */
  hint?: ReactNode;
  /** Show "Connect a drone to save parameters". */
  showConnectHint?: boolean;
  /** Show "Unsaved changes". */
  showUnsavedHint?: boolean;
}

export function PanelSaveBar({
  saveLabel = "saveToFc", onSave, saving, saveDisabled, saveTitle,
  onRevert, revertDisabled,
  showFlash, onFlash, flashing = false, flashDisabled = false, flashTitle,
  hint, showConnectHint, showUnsavedHint,
}: PanelSaveBarProps) {
  return (
    <div className="flex items-center gap-3 pt-2 pb-4">
      <Button variant="primary" size="lg" icon={<Save size={14} />} disabled={saveDisabled} title={saveTitle} loading={saving} onClick={onSave}>
        <SaveBarLabel k={saveLabel} />
      </Button>
      {onRevert && (
        <Button variant="secondary" size="lg" icon={<RotateCcw size={14} />} disabled={revertDisabled} onClick={onRevert}>
          <SaveBarLabel k="revert" />
        </Button>
      )}
      {showFlash && onFlash && (
        <Button variant="secondary" size="lg" icon={<HardDrive size={14} />} disabled={flashDisabled || flashing} title={flashTitle} loading={flashing} onClick={onFlash}>
          <SaveBarLabel k="writeToFlash" />
        </Button>
      )}
      {hint}
      {showConnectHint && <span className="text-[10px] text-text-tertiary"><SaveBarLabel k="connectToSave" /></span>}
      {showUnsavedHint && <span className="text-[10px] text-status-warning"><SaveBarLabel k="unsavedChanges" /></span>}
    </div>
  );
}
