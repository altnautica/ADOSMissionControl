/**
 * @module ChangelogNotificationEntry
 * @description Compact changelog entry card for the notification modal.
 * Shows version badge, title, truncated body, tags, date, and reaction button.
 * @license GPL-3.0-only
 */

"use client";

import { ChangelogReactionButton } from "./ChangelogReactionButton";

interface ChangelogNotificationEntryProps {
  entry: {
    _id: string;
    version: string;
    title: string;
    body: string;
    publishedAt: number;
    tags?: string[];
    repo?: string;
  };
  reactionCount: number;
}

function repoLabel(repo: string): string {
  const labels: Record<string, string> = {
    ADOSMissionControlGCS: "Mission Control",
    // Entries synced before the repository was renamed keep the name they
    // were stored under.
    ADOSMissionControl: "Mission Control",
  };
  return labels[repo] ?? repo;
}

function timeAgo(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

export function ChangelogNotificationEntry({ entry, reactionCount }: ChangelogNotificationEntryProps) {
  return (
    <div className="py-3 border-b border-border-default last:border-b-0">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          {/* Version badge + date */}
          <div className="flex items-center gap-2 mb-1">
            <span className="px-1.5 py-0.5 text-[10px] font-mono font-medium bg-accent-primary/10 text-accent-primary rounded">
              {entry.version}
            </span>
            {entry.repo && (
              <span className="px-1.5 py-0.5 text-[10px] font-medium bg-status-success/10 text-status-success rounded">
                {repoLabel(entry.repo)}
              </span>
            )}
            <span className="text-[10px] text-text-tertiary">{timeAgo(entry.publishedAt)}</span>
          </div>

          {/* Title */}
          <h3 className="text-sm font-medium text-text-primary">{entry.title}</h3>

          {/* Body — 3-line clamp */}
          <p className="text-xs text-text-secondary mt-0.5 line-clamp-3">{entry.body}</p>

          {/* Tags */}
          {entry.tags && entry.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {entry.tags.map((tag) => (
                <span
                  key={tag}
                  className="px-1.5 py-0.5 text-[10px] text-text-tertiary bg-bg-tertiary rounded"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Reaction button */}
        <div className="shrink-0 mt-1">
          <ChangelogReactionButton changelogId={entry._id} count={reactionCount} />
        </div>
      </div>
    </div>
  );
}
