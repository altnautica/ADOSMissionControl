/**
 * @module SaveMissionDialog
 * @description Modal with format selection cards for saving missions.
 * Supports .altmission (native), .waypoints (ArduPilot), and .plan (QGC).
 * @license GPL-3.0-only
 */
"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Save, FileText, FileJson } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface SaveMissionDialogProps {
  open: boolean;
  onClose: () => void;
  missionName: string;
  onSaveNative: (name: string) => void;
  onSaveWaypoints: (name: string) => void;
  onSaveQGCPlan: (name: string) => void;
}

const FORMAT_CARDS = [
  {
    id: "native" as const,
    icon: Save,
    title: "Altnautica (.altmission)",
    description: "Native format. Saves all metadata, suite type, and drone assignment. Auto-saved locally.",
    badge: "DEFAULT",
  },
  {
    id: "waypoints" as const,
    icon: FileText,
    title: "ArduPilot (.waypoints)",
    description: "Mission Planner / ArduPilot format. Plain text with MAVLink commands.",
  },
  {
    id: "plan" as const,
    icon: FileJson,
    title: "QGroundControl (.plan)",
    description: "QGC JSON format. Compatible with QGC, PX4, and ArduPilot.",
  },
];

export function SaveMissionDialog({
  open,
  onClose,
  missionName,
  onSaveNative,
  onSaveWaypoints,
  onSaveQGCPlan,
}: SaveMissionDialogProps) {
  const t = useTranslations("planner");
  const [name, setName] = useState(missionName || t("untitledMission"));

  const handleSelect = (format: "native" | "waypoints" | "plan") => {
    const finalName = name.trim() || t("untitledMission");
    if (format === "native") onSaveNative(finalName);
    else if (format === "waypoints") onSaveWaypoints(finalName);
    else if (format === "plan") onSaveQGCPlan(finalName);
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title={t("saveMission")} className="max-w-md">
      <div className="flex flex-col gap-4">
        <Input
          label={t("missionName")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("untitledMission")}
        />

        <div className="flex flex-col gap-2">
          <span className="text-xs text-text-secondary">{t("chooseFormat")}</span>
          {FORMAT_CARDS.map((card) => (
            <button
              key={card.id}
              onClick={() => handleSelect(card.id)}
              className={cn(
                "w-full text-left p-3 border border-border-default bg-bg-tertiary/50",
                "hover:border-accent-primary hover:bg-accent-primary/5 transition-colors cursor-pointer",
                "flex items-start gap-3"
              )}
            >
              <card.icon size={16} className="text-text-secondary mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-text-primary">{card.title}</span>
                  {card.badge && (
                    <span className="text-[9px] font-mono font-semibold bg-accent-primary/20 text-accent-primary px-1.5 py-0.5">
                      {card.badge}
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-text-tertiary mt-0.5 leading-relaxed">
                  {card.description}
                </p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}
