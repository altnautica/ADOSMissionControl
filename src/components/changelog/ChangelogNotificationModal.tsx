/**
 * @module ChangelogNotificationModal
 * @description "What's New" modal shown when unseen changelog entries exist.
 * Uses the existing Modal component. Scrollable entry list with "Go to Community"
 * link and "Got it" dismiss button.
 * @license GPL-3.0-only
 */

"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { ChangelogNotificationEntry } from "./ChangelogNotificationEntry";
import { useChangelogNotifications, type ChangelogEntry } from "@/hooks/use-changelog-notifications";
import { communityApi } from "@/lib/community-api";
import { useConvexSkipQuery } from "@/hooks/use-convex-skip-query";

export function ChangelogNotificationModal() {
  const {
    unseenEntries,
    allEntries,
    modalOpen,
    setModalOpen,
    dismissAll,
  } = useChangelogNotifications();

  const router = useRouter();

  const changelogIds = useMemo(
    () => allEntries.map((entry: ChangelogEntry) => entry._id as never),
    [allEntries]
  );

  const reactionCounts = useConvexSkipQuery(communityApi.changelog.reactionCounts, {
    args: { changelogIds },
    enabled: changelogIds.length > 0,
  }) as Record<string, number> | undefined;

  const entriesToShow = unseenEntries.length > 0 ? unseenEntries : allEntries;

  const handleDismiss = () => {
    dismissAll();
  };

  const handleGoToCommunity = () => {
    dismissAll();
    router.push("/community");
  };

  return (
    <Modal
      open={modalOpen}
      onClose={handleDismiss}
      title="What's New"
      className="max-w-xl"
      footer={
        <div className="flex items-center justify-between w-full">
          <button
            onClick={handleGoToCommunity}
            className="text-xs text-accent-primary hover:text-accent-primary/80 transition-colors cursor-pointer"
          >
            Go to Community &rarr;
          </button>
          <Button variant="primary" size="sm" onClick={handleDismiss}>
            Got it
          </Button>
        </div>
      }
    >
      <div className="max-h-[50vh] overflow-y-auto -mx-4 px-4">
        {entriesToShow.length === 0 ? (
          <p className="text-sm text-text-tertiary py-4 text-center">No updates yet.</p>
        ) : (
          entriesToShow.map((entry) => (
            <ChangelogNotificationEntry
              key={entry._id}
              entry={entry}
              reactionCount={reactionCounts?.[entry._id] ?? 0}
            />
          ))
        )}
      </div>
    </Modal>
  );
}
