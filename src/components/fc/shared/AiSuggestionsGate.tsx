"use client";

/**
 * Auth + usage gate for AI PID suggestions.
 *
 * Three states:
 * 1. Not signed in — prompts sign-in
 * 2. Limit reached — disabled with reset info
 * 3. Available — normal button with remaining count
 *
 * @license GPL-3.0-only
 */

import { useEffect } from "react";
import { Sparkles, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/stores/auth-store";
import { usePidAnalysisStore } from "@/stores/pid-analysis-store";
import { communityApi } from "@/lib/community-api";
import { useConvexSkipQuery } from "@/hooks/use-convex-skip-query";

interface AiSuggestionsGateProps {
  onRequestAi: () => void;
  connected: boolean;
}

function requestSignIn() {
  window.dispatchEvent(new CustomEvent("open-signin"));
}

export function AiSuggestionsGate({ onRequestAi, connected }: AiSuggestionsGateProps) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);
  const convexAvailable = useConvexAvailable();

  const aiRemainingUses = usePidAnalysisStore((s) => s.aiRemainingUses);
  const aiWeeklyLimit = usePidAnalysisStore((s) => s.aiWeeklyLimit);
  const setAiUsageInfo = usePidAnalysisStore((s) => s.setAiUsageInfo);

  // Reactive query — auto-updates when usage table changes
  const usageData = useQuery(
    communityApi.aiUsage.getRemaining,
    convexAvailable && isAuthenticated ? {} : "skip",
  );

  // Sync reactive query data into store
  useEffect(() => {
    if (usageData) {
      setAiUsageInfo(usageData.remaining, usageData.weeklyLimit);
    }
  }, [usageData, setAiUsageInfo]);

  const remaining = usageData?.remaining ?? aiRemainingUses;
  const weeklyLimit = usageData?.weeklyLimit ?? aiWeeklyLimit;

  // No Convex — allow unrestricted (self-hosted without cloud)
  if (!convexAvailable) {
    return (
      <Button
        variant="primary"
        size="sm"
        icon={<Sparkles size={12} />}
        onClick={onRequestAi}
        disabled={!connected}
      >
        Get AI Suggestions
      </Button>
    );
  }

  // Auth still resolving — show disabled button (no sign-in flash)
  if (isLoading) {
    return (
      <Button variant="primary" size="sm" icon={<Sparkles size={12} />} disabled>
        Get AI Suggestions
      </Button>
    );
  }

  // Not signed in
  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center gap-1.5 py-2">
        <Button
          variant="primary"
          size="sm"
          icon={<Lock size={12} />}
          onClick={requestSignIn}
        >
          Sign in for AI Suggestions
        </Button>
        <p className="text-[9px] text-text-tertiary text-center max-w-[280px]">
          Free account required. AI analysis is rate-limited during beta.
        </p>
      </div>
    );
  }

  // Limit reached
  if (remaining !== null && remaining <= 0) {
    return (
      <div className="flex flex-col items-center gap-1.5 py-2">
        <Button
          variant="primary"
          size="sm"
          icon={<Sparkles size={12} />}
          disabled
        >
          AI Suggestions (0/{weeklyLimit ?? "?"})
        </Button>
        <p className="text-[9px] text-text-tertiary text-center max-w-[300px]">
          Weekly limit reached. Resets Monday.
          Self-host with your own GROQ_API_KEY for unlimited use.
        </p>
      </div>
    );
  }

  // Available
  return (
    <div className="flex flex-col items-center gap-1">
      <Button
        variant="primary"
        size="sm"
        icon={<Sparkles size={12} />}
        onClick={onRequestAi}
        disabled={!connected}
      >
        Get AI Suggestions
      </Button>
      {remaining !== null && weeklyLimit !== null && (
        <p className="text-[9px] text-text-tertiary">
          {remaining}/{weeklyLimit} uses remaining this week
        </p>
      )}
    </div>
  );
}
