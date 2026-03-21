"use client";

import Link from "next/link";
import { Pencil, Trash2, MessageSquare } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { useSettingsStore } from "@/stores/settings-store";
import type { ChangelogEntry as ChangelogEntryType } from "@/lib/community-types";

interface ChangelogEntryProps {
  entry: ChangelogEntryType;
  commentCount?: number;
  onEdit?: (entry: ChangelogEntryType) => void;
  onDelete?: (id: string) => void;
}

export function ChangelogEntry({ entry, commentCount = 0, onEdit, onDelete }: ChangelogEntryProps) {
  const isAdmin = useIsAdmin();
  const locale = useSettingsStore((s) => s.locale);
  const displayTitle = entry.translations?.[locale]?.title ?? entry.title;
  const displayBody = entry.translations?.[locale]?.description ?? entry.body;

  return (
    <div className="relative pl-6 pb-6 border-l border-border-default last:border-l-0">
      {/* Timeline dot */}
      <div className="absolute -left-[5px] top-0 w-2.5 h-2.5 rounded-full bg-accent-primary border-2 border-bg-primary" />

      <div className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="px-1.5 py-0.5 text-[10px] font-mono font-semibold bg-accent-primary/10 text-accent-primary rounded">
              {entry.version}
            </span>
            {entry.repo && (
              <span className="px-1.5 py-0.5 text-[10px] font-mono text-text-secondary bg-bg-tertiary rounded">
                {entry.repo}
              </span>
            )}
            {entry.commitUrl && (
              <a
                href={entry.commitUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] font-mono text-accent-primary hover:underline"
              >
                {entry.commitSha?.slice(0, 7)}
              </a>
            )}
            <Link
              href={`/community/changelog/${entry._id}`}
              className="hover:text-accent-primary transition-colors"
            >
              <h3 className="text-base font-medium text-text-primary">{displayTitle}</h3>
            </Link>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <span className="text-xs text-text-tertiary">
              {formatDate(entry.commitDate ?? entry.publishedAt)}
            </span>
            {isAdmin && onEdit && onDelete && (
              <div className="flex items-center gap-1 ml-2">
                <button
                  onClick={() => onEdit(entry)}
                  className="text-text-tertiary hover:text-text-secondary transition-colors"
                  title="Edit"
                >
                  <Pencil size={12} />
                </button>
                <button
                  onClick={() => onDelete(entry._id)}
                  className="text-text-tertiary hover:text-status-error transition-colors"
                  title="Delete"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            )}
          </div>
        </div>

        {entry.translations?.[locale]?.description ? (
          <div className="text-sm text-text-secondary whitespace-pre-wrap leading-relaxed">
            {displayBody}
          </div>
        ) : entry.bodyHtml ? (
          <div
            className="text-sm text-text-secondary leading-relaxed changelog-body"
            dangerouslySetInnerHTML={{ __html: entry.bodyHtml }}
          />
        ) : (
          <div className="text-sm text-text-secondary whitespace-pre-wrap leading-relaxed">
            {displayBody}
          </div>
        )}

        {entry.tags && entry.tags.length > 0 && (
          <div className="flex gap-1 flex-wrap">
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

        {commentCount > 0 && (
          <Link
            href={`/community/changelog/${entry._id}`}
            className="inline-flex items-center gap-1 text-xs text-text-tertiary hover:text-text-secondary transition-colors"
          >
            <MessageSquare size={12} />
            {commentCount}
          </Link>
        )}
      </div>
    </div>
  );
}
