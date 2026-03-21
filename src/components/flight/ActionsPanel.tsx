"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  Power, ArrowUpFromLine, Home, ArrowDownToLine,
  Pause, Play, XOctagon, Skull, ClipboardCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { FlightModeSelector } from "@/components/shared/flight-mode-selector";
import { ActionDialogs } from "./action-dialogs";
import { useDroneStore } from "@/stores/drone-store";
import { useDroneManager } from "@/stores/drone-manager";
import { useChecklistStore } from "@/stores/checklist-store";
import { useFirmwareCapabilities } from "@/hooks/use-firmware-capabilities";
import { useFlightShortcuts } from "@/hooks/use-flight-shortcuts";
import { useShallow } from "zustand/react/shallow";
import { cn } from "@/lib/utils";


export function ActionsPanel() {
  const t = useTranslations("flight");
  const armState = useDroneStore((s) => s.armState);
  const flightMode = useDroneStore((s) => s.flightMode);
  const previousMode = useDroneStore((s) => s.previousMode);
  const setFlightMode = useDroneStore((s) => s.setFlightMode);
  const setArmState = useDroneStore((s) => s.setArmState);
  const getProtocol = useDroneManager((s) => s.getSelectedProtocol);

  const [showRthConfirm, setShowRthConfirm] = useState(false);
  const [showAbortConfirm, setShowAbortConfirm] = useState(false);
  const [showKillConfirm, setShowKillConfirm] = useState(false);
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
  const hasAutonomousFlight = supports("supportsGeoFence"); // RTL/Land/Takeoff require autonomous nav

  useFlightShortcuts({
    enabled: true,
    onRthConfirm: () => setShowRthConfirm(true),
    onAbortConfirm: () => setShowAbortConfirm(true),
    takeoffAlt,
  });

  return (
    <>
      <div className="px-3 pt-3 pb-1.5 border-t border-border-default bg-bg-secondary flex flex-col gap-1.5">
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
                onClick={() => {
                  if (protocol) {
                    if (isArmed) protocol.disarm();
                    else protocol.arm();
                  } else {
                    setArmState(isArmed ? "disarmed" : "armed");
                  }
                }}
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
                    onClick={() => {
                      if (protocol) protocol.pauseMission();
                      else setFlightMode("LOITER");
                    }}
                  />
                </Tooltip>
              ) : hasMissions && flightMode === "LOITER" && previousMode === "AUTO" ? (
                <Tooltip content="Resume mission (Shift+P)" position="right">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="w-full"
                    icon={<Play size={14} />}
                    onClick={() => {
                      if (protocol) protocol.resumeMission();
                      else setFlightMode("AUTO");
                    }}
                  />
                </Tooltip>
              ) : (
                <Tooltip content="Hold position (Shift+P)" position="right">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="w-full"
                    icon={<Pause size={14} />}
                    onClick={() => {
                      if (protocol) protocol.setFlightMode("LOITER");
                      else setFlightMode("LOITER");
                    }}
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
                  onClick={() => setShowRthConfirm(true)}
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
                    onClick={() => {
                      const alt = parseFloat(takeoffAlt);
                      if (isNaN(alt) || alt <= 0) return;
                      if (protocol) {
                        if (!isArmed) protocol.arm();
                        protocol.takeoff(alt);
                      }
                    }}
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
                    onClick={() => {
                      if (protocol) protocol.land();
                      else setFlightMode("LAND");
                    }}
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
                onClick={() => setShowAbortConfirm(true)}
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
                onClick={() => setShowKillConfirm(true)}
              />
            </Tooltip>
          </div>
        </div>
      </div>

      <ActionDialogs
        showRthConfirm={showRthConfirm}
        setShowRthConfirm={setShowRthConfirm}
        showAbortConfirm={showAbortConfirm}
        setShowAbortConfirm={setShowAbortConfirm}
        showKillConfirm={showKillConfirm}
        setShowKillConfirm={setShowKillConfirm}
        showChecklist={showChecklist}
        setShowChecklist={setShowChecklist}
      />
    </>
  );
}
