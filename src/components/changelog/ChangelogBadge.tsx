/**
 * @module ChangelogBadge
 * @description Wraps the Community header link with a red dot indicator
 * when unseen changelog entries exist. Reads from the volatile notification store.
 * @license GPL-3.0-only
 */

"use client";

import { Newspaper } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { useChangelogNotificationStore } from "@/stores/changelog-notification-store";
import Link from "next/link";

export function ChangelogBadge() {
  const unseenCount = useChangelogNotificationStore((s) => s.unseenCount);

  return (
    <Tooltip content="Community" position="bottom">
      <Link
        href="/community"
        className="relative text-text-secondary hover:text-text-primary transition-colors"
        aria-label="Community"
      >
        <Newspaper size={16} />
        {unseenCount > 0 && (
          <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-status-error" />
        )}
      </Link>
    </Tooltip>
  );
}
