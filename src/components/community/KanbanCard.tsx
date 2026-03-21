"use client";

import { ChevronUp, Bug, Lightbulb } from "lucide-react";
import { useSettingsStore } from "@/stores/settings-store";
import type { CommunityItem } from "@/lib/community-types";

interface KanbanCardProps {
  item: CommunityItem;
}

export function KanbanCard({ item }: KanbanCardProps) {
  const locale = useSettingsStore((s) => s.locale);
  const displayTitle = item.translations?.[locale]?.title ?? item.title;

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", item._id);
        e.dataTransfer.effectAllowed = "move";
      }}
      className="bg-bg-primary border border-border-default rounded p-2 cursor-grab active:cursor-grabbing hover:border-border-hover transition-colors"
    >
      <p className="text-xs text-text-primary mb-1.5 line-clamp-2">
        {displayTitle}
      </p>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          {item.type === "bug" ? (
            <Bug size={10} className="text-status-error" />
          ) : (
            <Lightbulb size={10} className="text-accent-primary" />
          )}
          <span className="text-[11px] text-text-tertiary capitalize">{item.type}</span>
        </div>
        <div className="flex items-center gap-0.5 text-[11px] text-text-tertiary">
          <ChevronUp size={10} />
          {item.upvoteCount}
        </div>
      </div>
    </div>
  );
}
