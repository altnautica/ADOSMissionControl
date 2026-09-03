"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  Power, ArrowUpFromLine, Home, ArrowDownToLine,
  Pause, Play, XOctagon, Skull, ClipboardCheck,
} from "lucide-react";
import { FollowMeButton } from "./FollowMeButton";
import { LoadoutSelector } from "./LoadoutSelector";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { FlightModeSelector } from "@/components/shared/flight-mode-selector";
import { ChecklistModal } from "./action-dialogs";
import { useDroneStore } from "@/stores/drone-store";
import { useDroneManager } from "@/stores/drone-manager";
import { useChecklistStore } from "@/stores/checklist-store";
import { useFirmwareCapabilities } from "@/hooks/use-firmware-capabilities";
import { useFlightShortcuts } from "@/hooks/use-flight-shortcuts";
import { useShallow } from "zustand/react/shallow";
import { buildSkillContext, activate } from "@/lib/skills";
import { cn } from "@/lib/utils";


export function ActionsPanel() {
  const t = useTranslations("flight");
  const armState = useDroneStore((s) => s.armState);
  const flightMode = useDroneStore((s) => s.flightMode);
  const previousMode = useDroneStore((s) => s.previousMode);
  const selectedId = useDroneManager((s) => s.selectedDroneId);
  const setFlightMode = useDroneStore((s) => s.setFlightMode);
  const getProtocol = useDroneManager((s) => s.getSelectedProtocol);

  const [takeoffAlt, setTakeoffAlt] = useState("10");
  const [showChecklist, setShowChecklist] = useState(false);
  const checklistReady = useChecklistStore(
    (s) => s.items.every((item) => item.status === "pass" || item.status === "skipped")
  );
  const checklistProgress = useChecklistStore(
    useShallow((s) => {
      const items = s.items;
      return {
        total: items.length,
        checked: items.filter((i) => i.status === "pass" || i.status === "skipped").length,
        failed: items.filter((i) => i.status === "fail").length,
      };
    })
  );

  const isArmed = armState === "armed";
  const protocol = getProtocol();
  const { supports } = useFirmwareCapabilities();
  const hasMissions = supports("supportsMissionUpload");
  const hasAutonomousFlight = supports("supportsAutonomousNav"); // RTL/Land/Takeoff

  // Every action fires through the single skill-dispatch pipeline so confirm,
  // arm-gating, and idempotency are uniform with the keyboard + gamepad paths.
  // A panel onClick is identical to a hotkey press or a Skill Bar press.
  const fire = (skillId: string, args?: { altitudeM?: number }) => {
    if (!selectedId) return;
    void activate(skillId, buildSkillContext(selectedId), args);
  };
  const fireArmToggle = () => fire(isArmed ? "disarm" : "arm");
  const fireTakeoff = () => {
    const alt = parseFloat(takeoffAlt);
    if (isNaN(alt) || alt <= 0) return;
    fire("takeoff", { altitudeM: alt });
  };
  // Pause/Resume present as one mission-aware control; the skill it fires
  // (pause vs resume) is chosen from the same mode/mission state the original
  // panel used to pick its button variant.
  const isResumable = hasMissions && flightMode === "LOITER" && previousMode === "AUTO";
  const firePauseResume = () => fire(isResumable ? "resume" : "pause");

  // Keep the keyboard shortcuts working until the global dispatcher lands, but
  // route them through the same pipeline so the confirm flow is identical.
  useFlightShortcuts({
    enabled: true,
    onArmConfirm: () => fire("arm"),
    onDisarmConfirm: () => fire("disarm"),
    onRthConfirm: () => fire("rth"),
    onTakeoffConfirm: fireTakeoff,
    onLandConfirm: () => fire("land"),
    onAbortConfirm: () => fire("abort"),
    takeoffAlt,
  });

  return (
    <>
      <div className="px-3 pt-3 pb-1.5 border-t border-border-default bg-bg-secondary flex flex-col gap-1.5">
        {/* Loadout selector (battery + equipment fitted for this flight) */}
        <LoadoutSelector />

        {/* Pre-Flight Checklist button */}
        <Tooltip content="Open pre-flight checklist" position="right">
          <button
            onClick={() => setShowChecklist(true)}
            className={cn(
              "w-full flex items-center gap-2 px-2 py-1.5 text-[11px] font-medium transition-colors border",
              checklistReady
                ? "bg-status-success/10 border-status-success/30 text-status-success hover:bg-status-success/20"
                : "bg-bg-tertiary border-border-default text-text-secondary hover:bg-bg-tertiary/80",
            )}
          >
            <ClipboardCheck size={12} />
            <span className="flex-1 text-left">{t("preFlightCheck")}</span>
            <span className="text-[10px] font-mono">
              {checklistProgress.checked}/{checklistProgress.total}
            </span>
          </button>
        </Tooltip>

        <div className="flex items-center gap-1.5">
          {/* ARM / DISARM */}
          <div className="flex-1 [&>*]:w-full">
            <Tooltip
              content={isArmed ? t("disarmShortcut") : t("armShortcut")}
              position="right"
            >
              <Button
                variant={isArmed ? "danger" : "primary"}
                size="sm"
                icon={<Power size={14} />}
                className="w-full h-9 text-sm"
                onClick={fireArmToggle}
              >
                {isArmed ? t("disarm") : t("arm")}
              </Button>
            </Tooltip>
          </div>

          {/* Flight mode selector */}
          <div className="flex-1">
            <FlightModeSelector
              value={flightMode}
              onChange={(mode) => {
                if (protocol) protocol.setFlightMode(mode);
                else setFlightMode(mode);
              }}
              className="w-full h-9"
            />
          </div>
        </div>

        {/* All action buttons */}
        <div className="flex items-center gap-1">
          {hasAutonomousFlight && (
            <div className="flex-1 [&>*]:w-full">
              {hasMissions && flightMode === "AUTO" ? (
                <Tooltip content="Pause mission (Shift+P)" position="right">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="w-full"
                    icon={<Pause size={14} />}
                    onClick={firePauseResume}
                  />
                </Tooltip>
              ) : isResumable ? (
                <Tooltip content="Resume mission (Shift+P)" position="right">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="w-full"
                    icon={<Play size={14} />}
                    onClick={firePauseResume}
                  />
                </Tooltip>
              ) : (
                <Tooltip content="Hold position (Shift+P)" position="right">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="w-full"
                    icon={<Pause size={14} />}
                    onClick={firePauseResume}
                  />
                </Tooltip>
              )}
            </div>
          )}
          {hasAutonomousFlight && (
            <div className="flex-1 [&>*]:w-full">
              <Tooltip content="Return to home (Shift+R)" position="right">
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Home size={14} />}
                  className="w-full text-status-warning border-status-warning/30"
                  onClick={() => fire("rth")}
                />
              </Tooltip>
            </div>
          )}
          {hasAutonomousFlight && (
            <>
              <div className="flex-1 [&>*]:w-full">
                <Tooltip content="Takeoff altitude (1-120m)" position="right">
                  <input
                    type="number"
                    value={takeoffAlt}
                    onChange={(e) => setTakeoffAlt(e.target.value)}
                    className="w-full h-7 px-1 bg-bg-tertiary border border-border-default text-xs font-mono text-text-primary text-center focus:outline-none focus:border-accent-primary"
                    min="1"
                    max="120"
                    step="1"
                  />
                </Tooltip>
              </div>
              <div className="flex-1 [&>*]:w-full">
                <Tooltip content="Takeoff (Shift+T)" position="right">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="w-full"
                    icon={<ArrowUpFromLine size={14} />}
                    onClick={fireTakeoff}
                  />
                </Tooltip>
              </div>
              <div className="flex-1 [&>*]:w-full">
                <Tooltip content="Land (Shift+L)" position="left">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="w-full"
                    icon={<ArrowDownToLine size={14} />}
                    onClick={() => fire("land")}
                  />
                </Tooltip>
              </div>
            </>
          )}
          <div className="flex-1 [&>*]:w-full">
            <Tooltip content="Abort (Shift+X)" position="left">
              <Button
                variant="danger"
                size="sm"
                className="w-full"
                icon={<XOctagon size={14} />}
                onClick={() => fire("abort")}
              />
            </Tooltip>
          </div>
          <div className="flex-1 [&>*]:w-full">
            <Tooltip content="Kill motors" position="left">
              <Button
                variant="danger"
                size="sm"
                icon={<Skull size={14} />}
                className="w-full bg-red-800 hover:bg-red-700 border-red-600"
                onClick={() => fire("kill")}
              />
            </Tooltip>
          </div>
        </div>

        {/* Follow-me mode */}
        {isArmed && hasAutonomousFlight && (
          <FollowMeButton />
        )}
      </div>

      <ChecklistModal open={showChecklist} onClose={() => setShowChecklist(false)} />
    </>
  );
}
