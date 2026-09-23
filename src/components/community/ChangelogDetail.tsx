"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Pencil, Trash2 } from "lucide-react";
import { communityApi } from "@/lib/community-api";
import { sanitizeChangelogHtml } from "@/lib/community-html";
import { useConvexSkipQueryState } from "@/hooks/use-convex-skip-query";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/utils";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { useSettingsStore } from "@/stores/settings-store";
import { ChangelogEditor } from "./ChangelogEditor";
import { CommunityComments } from "./CommunityComments";
import type { ChangelogEntry } from "@/lib/community-types";

interface ChangelogDetailProps {
  id: string;
}

export function ChangelogDetail({ id }: ChangelogDetailProps) {
  const { data: entry, state } = useConvexSkipQueryState(communityApi.changelog.getById, {
    args: { id: id as never },
    enabled: !!id,
  });
  const removeChangelog = useMutation(communityApi.changelog.remove);
  const isAdmin = useIsAdmin();
  const locale = useSettingsStore((s) => s.locale);
  const [editorOpen, setEditorOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  if (state === "skipped") {
    return (
      <div className="flex flex-col items-center justify-center h-32 gap-2">
        <p className="text-sm text-text-tertiary">
          Changelog details need the community backend, which is not available here.
        </p>
        <Link
          href="/community/changelog"
          className="text-sm text-accent-primary hover:underline"
        >
          Back to changelog
        </Link>
      </div>
    );
  }

  if (state === "loading") {
    return (
      <div className="flex items-center justify-center h-32 text-sm text-text-tertiary">
        Loading...
      </div>
    );
  }

  // A malformed id fails argument validation server-side, so a failed query
  // most often means the id names no entry.
  if (state === "error" || entry === null || entry === undefined) {
    return (
      <div className="flex flex-col items-center justify-center h-32 gap-2">
        <p className="text-sm text-text-tertiary">
          {state === "error" ? "Entry not found or could not be loaded" : "Entry not found"}
        </p>
        <Link
          href="/community/changelog"
          className="text-sm text-accent-primary hover:underline"
        >
          Back to changelog
        </Link>
      </div>
    );
  }

  const typedEntry = entry as ChangelogEntry;
  const displayTitle = typedEntry.translations?.[locale]?.title ?? typedEntry.title;
  const displayBody = typedEntry.translations?.[locale]?.description ?? typedEntry.body;

  const handleDelete = async () => {
    if (!confirm("Delete this changelog entry?")) return;
    setDeleting(true);
    try {
      await removeChangelog({ id: typedEntry._id as never });
      router.push("/community/changelog");
    } catch (err) {
      setDeleting(false);
      toast(
        `Could not delete the entry: ${err instanceof Error ? err.message : String(err)}`,
        "error",
      );
    }
  };

  return (
    <div className="p-4 max-w-2xl mx-auto space-y-4">
      <Link
        href="/community/changelog"
        className="flex items-center gap-1 text-sm text-text-tertiary hover:text-text-secondary transition-colors"
      >
        <ArrowLeft size={12} />
        Back to changelog
      </Link>

      <div className="space-y-3">
        {/* Metadata row */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="px-1.5 py-0.5 text-[10px] font-mono font-semibold bg-accent-primary/10 text-accent-primary rounded">
            {typedEntry.version}
          </span>
          {typedEntry.repo && (
            <span className="px-1.5 py-0.5 text-[10px] font-mono text-text-secondary bg-bg-tertiary rounded">
              {typedEntry.repo}
            </span>
          )}
          {typedEntry.commitUrl && (
            <a
              href={typedEntry.commitUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] font-mono text-accent-primary hover:underline"
            >
              {typedEntry.commitSha?.slice(0, 7)}
            </a>
          )}
          <span className="text-xs text-text-tertiary">
            {formatDate(typedEntry.commitDate ?? typedEntry.publishedAt)}
          </span>
          {typedEntry.source === "auto" && (
            <span className="text-[10px] text-text-tertiary">(auto)</span>
          )}
          {typedEntry.editedByAdmin && (
            <span className="text-[10px] text-text-tertiary">(edited)</span>
          )}
        </div>

        {/* Title */}
        <h1 className="text-lg font-semibold text-text-primary">
          {displayTitle}
        </h1>

        {/* Body */}
        {typedEntry.translations?.[locale]?.description ? (
          <div className="text-sm text-text-secondary whitespace-pre-wrap leading-relaxed">
            {displayBody}
          </div>
        ) : typedEntry.bodyHtml ? (
          <div
            className="text-sm text-text-secondary leading-relaxed changelog-body"
            dangerouslySetInnerHTML={{ __html: sanitizeChangelogHtml(typedEntry.bodyHtml) }}
          />
        ) : (
          <div className="text-sm text-text-secondary whitespace-pre-wrap leading-relaxed">
            {displayBody}
          </div>
        )}

        {/* Tags */}
        {typedEntry.tags && typedEntry.tags.length > 0 && (
          <div className="flex gap-1 flex-wrap">
            {typedEntry.tags.map((tag) => (
              <span
                key={tag}
                className="px-1.5 py-0.5 text-[10px] text-text-tertiary bg-bg-tertiary rounded"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Admin controls */}
        {isAdmin && (
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={() => setEditorOpen(true)}
              className="flex items-center gap-1 text-xs text-text-tertiary hover:text-text-secondary transition-colors"
            >
              <Pencil size={12} />
              Edit
            </button>
            <button
              onClick={() => void handleDelete()}
              disabled={deleting}
              className="flex items-center gap-1 text-xs text-text-tertiary hover:text-status-error transition-colors"
            >
              <Trash2 size={12} />
              Delete
            </button>
          </div>
        )}

        {/* Divider */}
        <div className="border-t border-border-default pt-4">
          <CommunityComments targetType="changelog" targetId={typedEntry._id} />
        </div>
      </div>

      {editorOpen && (
        <ChangelogEditor
          entry={typedEntry}
          onClose={() => setEditorOpen(false)}
        />
      )}
    </div>
  );
}
