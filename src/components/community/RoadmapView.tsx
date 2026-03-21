"use client";

import { useQuery } from "convex/react";
import { ChevronUp } from "lucide-react";
import { communityApi } from "@/lib/community-api";
import { useSettingsStore } from "@/stores/settings-store";
import { CategoryBadge } from "./CategoryBadge";
import type { CommunityItem, ItemStatus } from "@/lib/community-types";

const sections: { status: ItemStatus; label: string; color: string }[] = [
  { status: "planned", label: "Planned", color: "border-status-warning" },
  { status: "in_progress", label: "In Progress", color: "border-accent-primary" },
  { status: "released", label: "Released", color: "border-status-success" },
];

export function RoadmapView() {
  const grouped = useQuery(communityApi.items.listByStatus, {});
  const locale = useSettingsStore((s) => s.locale);

  if (grouped === undefined) {
    return (
      <div className="flex items-center justify-center h-32 text-sm text-text-tertiary">
        Loading roadmap...
      </div>
    );
  }

  return (
    <div className="p-4 max-w-3xl mx-auto space-y-6">
      <h2 className="text-xl font-semibold text-text-primary">Roadmap</h2>

      {sections.map(({ status, label, color }) => {
        const items = (grouped[status] || []) as CommunityItem[];
        return (
          <div key={status}>
            <div className={`border-l-2 ${color} pl-3 mb-3`}>
              <h3 className="text-sm font-medium text-text-secondary uppercase tracking-wider">
                {label}
                <span className="ml-2 text-text-tertiary font-normal">
                  ({items.length})
                </span>
              </h3>
            </div>

            {items.length === 0 ? (
              <p className="text-xs text-text-tertiary pl-5 py-2">
                Nothing here yet.
              </p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {items.map((item) => (
                  <div
                    key={item._id}
                    className="bg-bg-secondary border border-border-default rounded p-3 space-y-1.5"
                  >
                    <h4 className="text-sm font-medium text-text-primary">
                      {item.translations?.[locale]?.title ?? item.title}
                    </h4>
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-0.5 text-xs text-text-tertiary">
                        <ChevronUp size={10} />
                        {item.upvoteCount}
                      </div>
                      <CategoryBadge category={item.category} />
                      {item.eta && (
                        <span className="text-xs text-text-tertiary">
                          ETA: {item.eta}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
