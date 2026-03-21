/**
 * @module LoadMissionDialog
 * @description Modal for importing mission files and loading recent missions.
 * Supports .altmission, .waypoints (ArduPilot), and .plan (QGC) import.
 * @license GPL-3.0-only
 */
"use client";

import { useRef, useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { FolderOpen, FileText, FileJson, Clock } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";
import { getRecentMissions } from "@/lib/mission-io";

interface RecentMission {
  name: string;
  date: number;
  wpCount: number;
  key: string;
}

interface LoadMissionDialogProps {
  open: boolean;
  onClose: () => void;
  onImportFile: (file: File) => void;
  onLoadRecent: (key: string) => void;
}

const FORMAT_CARDS = [
  {
    id: "native" as const,
    icon: FolderOpen,
    title: "Altnautica (.altmission / .json)",
    description: "Native format with full metadata.",
    accept: ".altmission,.json",
  },
  {
    id: "waypoints" as const,
    icon: FileText,
    title: "ArduPilot (.waypoints)",
    description: "Import from Mission Planner. Tab-separated QGC WPL 110 format.",
    accept: ".waypoints,.txt",
  },
  {
    id: "plan" as const,
    icon: FileJson,
    title: "QGroundControl (.plan)",
    description: "Import QGC JSON plan files.",
    accept: ".plan,.json",
  },
];

function timeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

export function LoadMissionDialog({
  open,
  onClose,
  onImportFile,
  onLoadRecent,
}: LoadMissionDialogProps) {
  const t = useTranslations("planner");
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [recentMissions, setRecentMissions] = useState<RecentMission[]>([]);

  useEffect(() => {
    if (open) {
      getRecentMissions().then(setRecentMissions);
    }
  }, [open]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onImportFile(file);
      e.target.value = "";
      onClose();
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t("loadMission")} className="max-w-md">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <span className="text-xs text-text-secondary">{t("importFromFile")}</span>
          {FORMAT_CARDS.map((card) => (
            <div key={card.id}>
              <button
                onClick={() => fileRefs.current[card.id]?.click()}
                className={cn(
                  "w-full text-left p-3 border border-border-default bg-bg-tertiary/50",
                  "hover:border-accent-primary hover:bg-accent-primary/5 transition-colors cursor-pointer",
                  "flex items-start gap-3"
                )}
              >
                <card.icon size={16} className="text-text-secondary mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-semibold text-text-primary">{card.title}</span>
                  <p className="text-[11px] text-text-tertiary mt-0.5 leading-relaxed">
                    {card.description}
                  </p>
                </div>
              </button>
              <input
                ref={(el) => { fileRefs.current[card.id] = el; }}
                type="file"
                accept={card.accept}
                className="hidden"
                onChange={handleFileChange}
              />
            </div>
          ))}
        </div>

        {recentMissions.length > 0 && (
          <div className="flex flex-col gap-2">
            <span className="text-xs text-text-secondary flex items-center gap-1.5">
              <Clock size={12} />
              {t("recentMissions")}
            </span>
            <div className="border border-border-default divide-y divide-border-default max-h-[160px] overflow-y-auto">
              {recentMissions.map((mission, i) => (
                <button
                  key={mission.key || i}
                  onClick={() => {
                    if (mission.key) {
                      onLoadRecent(mission.key);
                      onClose();
                    }
                  }}
                  disabled={!mission.key}
                  className={cn(
                    "w-full flex items-center justify-between px-3 py-2 text-left transition-colors",
                    mission.key
                      ? "hover:bg-bg-tertiary cursor-pointer"
                      : "opacity-50 cursor-not-allowed"
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-medium text-text-primary truncate block">
                      {mission.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 ml-2">
                    <span className="text-[10px] font-mono text-text-tertiary">
                      {mission.wpCount} WPs
                    </span>
                    <span className="text-[10px] font-mono text-text-tertiary">
                      {timeAgo(mission.date)}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
