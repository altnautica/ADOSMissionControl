/**
 * @module ChangelogReactionButton
 * @description Thumbs-up reaction toggle for changelog entries.
 * Follows the UpvoteButton pattern — Convex-backed, auth-gated.
 * @license GPL-3.0-only
 */

"use client";

import { useMutation, useQuery } from "convex/react";
import { ThumbsUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { communityApi } from "@/lib/community-api";
import { useAuthStore } from "@/stores/auth-store";
import type { Id } from "../../../convex/_generated/dataModel";

interface ChangelogReactionButtonProps {
  changelogId: string;
  count: number;
}

export function ChangelogReactionButton({ changelogId, count }: ChangelogReactionButtonProps) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const react = useMutation(communityApi.changelog.react);
  const myReactions = useQuery(
    communityApi.changelog.myReactions,
    isAuthenticated ? {} : "skip"
  );

  const hasReacted = myReactions?.includes(changelogId as Id<"community_changelog">) ?? false;

  const handleClick = () => {
    if (!isAuthenticated) return;
    react({ changelogId: changelogId as Id<"community_changelog">, reaction: "thumbsup" });
  };

  return (
    <button
      onClick={handleClick}
      disabled={!isAuthenticated}
      title={isAuthenticated ? (hasReacted ? "Remove reaction" : "React") : "Sign in to react"}
      className={cn(
        "flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors text-xs",
        hasReacted
          ? "text-accent-primary bg-accent-primary/10"
          : "text-text-tertiary hover:text-text-secondary",
        !isAuthenticated && "cursor-not-allowed opacity-60"
      )}
    >
      <ThumbsUp size={12} />
      {count > 0 && (
        <span className="font-mono tabular-nums text-[10px]">{count}</span>
      )}
    </button>
  );
}
