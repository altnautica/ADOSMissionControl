"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePaginatedQuery, useMutation } from "convex/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Plus } from "lucide-react";
import { communityApi } from "@/lib/community-api";
import { useConvexAvailable } from "@/hooks/use-convex-available";
import { useConvexSkipQuery } from "@/hooks/use-convex-skip-query";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { SilentErrorBoundary } from "@/components/ui/SilentErrorBoundary";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { ChangelogEntry } from "./ChangelogEntry";
import { ChangelogEditor } from "./ChangelogEditor";
import type { ChangelogEntry as ChangelogEntryType } from "@/lib/community-types";

const PAGE_SIZE = 30;
const LOAD_MORE_OFFSET_PX = 600;
const ROW_ESTIMATE_PX = 140;
/** The comment-count query accepts at most this many targets per call. */
const MAX_COUNT_TARGETS = 64;

type CommentCountRow = { targetType: string; targetId: string; count: number };

/**
 * Public entry. Wraps the inner component in a Convex-availability gate
 * (usePaginatedQuery has no "skip" sentinel, so we guard at the component
 * level) and a silent error boundary so a failed Convex call cannot crash
 * the route.
 */
export function ChangelogTimeline() {
  return (
    <SilentErrorBoundary label="changelog-timeline">
      <ChangelogTimelineGate />
    </SilentErrorBoundary>
  );
}

function ChangelogTimelineGate() {
  const convexAvailable = useConvexAvailable();
  if (!convexAvailable) {
    return (
      <div className="px-4 py-12 text-center text-text-tertiary text-sm">
        Sign in to load the community changelog.
      </div>
    );
  }
  return <ChangelogTimelineInner />;
}

function ChangelogTimelineInner() {
  const isAdmin = useIsAdmin();
  const removeChangelog = useMutation(communityApi.changelog.remove);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<ChangelogEntryType | undefined>();
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const { toast } = useToast();

  const {
    results: entries,
    status,
    loadMore,
  } = usePaginatedQuery(
    communityApi.changelog.listPaginated,
    {},
    { initialNumItems: PAGE_SIZE },
  );

  const totalCount = useConvexSkipQuery(communityApi.changelog.listCount);

  const parentRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_ESTIMATE_PX,
    overscan: 6,
  });

  // Comment counts for the rendered window only: the loaded list grows past
  // the query's target limit, the visible window never does. Counts already
  // seen are kept, so scrolling back does not blank a badge while the next
  // window's answer is in flight.
  const virtualItems = rowVirtualizer.getVirtualItems();
  const visibleIdsKey = virtualItems
    .flatMap((row) => {
      const id = entries[row.index]?._id;
      return id ? [String(id)] : [];
    })
    .slice(0, MAX_COUNT_TARGETS)
    .join(",");
  const commentTargets = useMemo(
    () =>
      visibleIdsKey === ""
        ? []
        : visibleIdsKey.split(",").map((targetId) => ({
            targetType: "changelog" as const,
            targetId,
          })),
    [visibleIdsKey],
  );
  const commentCountsRaw = useConvexSkipQuery(communityApi.comments.countBatch, {
    args: { targets: commentTargets },
    enabled: commentTargets.length > 0,
  }) as CommentCountRow[] | undefined;
  const [knownCounts, setKnownCounts] = useState<ReadonlyMap<string, number>>(new Map());
  const [mergedRaw, setMergedRaw] = useState<CommentCountRow[] | undefined>(undefined);
  if (commentCountsRaw !== mergedRaw) {
    setMergedRaw(commentCountsRaw);
    if (commentCountsRaw) {
      const next = new Map(knownCounts);
      for (const r of commentCountsRaw) next.set(`${r.targetType}:${r.targetId}`, r.count);
      setKnownCounts(next);
    }
  }

  useEffect(() => {
    if (!sentinelRef.current || status !== "CanLoadMore") return;
    const el = sentinelRef.current;
    const io = new IntersectionObserver(
      (observed) => {
        if (observed[0]?.isIntersecting) loadMore(PAGE_SIZE);
      },
      { root: parentRef.current, rootMargin: `${LOAD_MORE_OFFSET_PX}px 0px` },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [status, loadMore]);

  const handleEdit = (entry: ChangelogEntryType) => {
    setEditingEntry(entry);
    setEditorOpen(true);
  };

  const handleDelete = (id: string) => {
    setPendingDelete(id);
  };

  const confirmDelete = async () => {
    const id = pendingDelete;
    setPendingDelete(null);
    if (!id) return;
    try {
      await removeChangelog({ id: id as never });
    } catch (err) {
      toast(
        `Could not delete the entry: ${err instanceof Error ? err.message : String(err)}`,
        "error",
      );
    }
  };

  const handleCloseEditor = () => {
    setEditorOpen(false);
    setEditingEntry(undefined);
  };

  return (
    <div className="flex flex-col h-full max-w-2xl mx-auto w-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2 shrink-0">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-semibold text-text-primary">Changelog</h2>
          <a
            href="https://discord.gg/uxbvuD4d5q"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 px-2 py-0.5 text-xs text-text-tertiary hover:text-accent-primary transition-colors rounded-full border border-border-default"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z"/></svg>
            Discord
          </a>
        </div>
        {isAdmin && (
          <button
            onClick={() => {
              setEditingEntry(undefined);
              setEditorOpen(true);
            }}
            className="flex items-center gap-1 px-2 py-1 text-sm font-medium bg-accent-primary text-bg-primary rounded hover:bg-accent-primary/90 transition-colors"
          >
            <Plus size={12} />
            New Release
          </button>
        )}
      </div>

      {/* Virtualized scroll container */}
      <div
        ref={parentRef}
        className="flex-1 min-h-0 overflow-y-auto px-4 pb-4"
        data-testid="changelog-scroll"
      >
        {status === "LoadingFirstPage" ? (
          <p className="text-sm text-text-tertiary text-center py-8">
            Loading changelog...
          </p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-text-tertiary text-center py-8">
            No changelog entries yet.
          </p>
        ) : (
          <>
            <div
              className="ml-1 relative w-full"
              style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
            >
              {virtualItems.map((virtualRow) => {
                const entry = entries[virtualRow.index];
                if (!entry) return null;
                return (
                  <div
                    key={virtualRow.key}
                    data-index={virtualRow.index}
                    ref={rowVirtualizer.measureElement}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  >
                    <ChangelogEntry
                      entry={entry}
                      commentCount={knownCounts.get(`changelog:${entry._id}`) ?? 0}
                      onEdit={handleEdit}
                      onDelete={handleDelete}
                    />
                  </div>
                );
              })}
            </div>

            <div ref={sentinelRef} style={{ height: 1 }} aria-hidden="true" />

            {status === "LoadingMore" && (
              <p className="text-xs text-text-tertiary text-center py-3">
                Loading more...
              </p>
            )}
            {status === "Exhausted" && entries.length > 0 && (
              <p className="text-xs text-text-tertiary text-center py-3">
                You&apos;re all caught up.
                {typeof totalCount === "number" && ` ${totalCount} entries total.`}
              </p>
            )}
          </>
        )}
      </div>

      {editorOpen && (
        <ChangelogEditor entry={editingEntry} onClose={handleCloseEditor} />
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete changelog entry"
        message="This removes the entry for everyone. It cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
