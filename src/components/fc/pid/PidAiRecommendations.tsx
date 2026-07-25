"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Sparkles, AlertTriangle, Info, Zap } from "lucide-react";
import type { AiRecommendation } from "@/lib/analysis/types";

interface PidAiRecommendationsProps {
  recommendations: AiRecommendation[];
  onApply: (id: string) => void;
  onApplyAll: () => void;
  aiLoading: boolean;
}

const PRIORITY_CONFIG = {
  critical: {
    border: "border-status-error/30",
    bg: "bg-status-error/5",
    badge: "bg-status-error/20 text-status-error",
    icon: AlertTriangle,
    label: "Critical",
  },
  important: {
    border: "border-status-warning/30",
    bg: "bg-status-warning/5",
    badge: "bg-status-warning/20 text-status-warning",
    icon: Zap,
    label: "Important",
  },
  optional: {
    border: "border-accent-primary/30",
    bg: "bg-accent-primary/5",
    badge: "bg-accent-primary/20 text-accent-primary",
    icon: Info,
    label: "Optional",
  },
} as const;

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const colorClass =
    confidence >= 80
      ? "bg-status-success/20 text-status-success"
      : confidence >= 60
        ? "bg-status-warning/20 text-status-warning"
        : "bg-bg-tertiary text-text-tertiary";

  return (
    <span className={cn("text-[9px] font-mono px-1.5 py-0.5", colorClass)}>
      {confidence}%
    </span>
  );
}

function SkeletonCard() {
  return (
    <div className="border border-border-default bg-bg-secondary p-4 animate-pulse">
      <div className="h-4 bg-bg-tertiary w-2/3 mb-3" />
      <div className="h-3 bg-bg-tertiary w-full mb-2" />
      <div className="h-3 bg-bg-tertiary w-4/5 mb-3" />
      <div className="h-8 bg-bg-tertiary w-full" />
    </div>
  );
}

export function PidAiRecommendations({
  recommendations,
  onApply,
  onApplyAll,
  aiLoading,
}: PidAiRecommendationsProps) {
  // Loading state
  if (aiLoading) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles size={14} className="text-accent-primary animate-pulse" />
          <span className="text-xs text-text-secondary">Analyzing tune quality...</span>
        </div>
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  // Empty state
  if (recommendations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <Sparkles size={20} className="text-text-tertiary mb-2" />
        <p className="text-xs text-text-secondary">No recommendations yet</p>
        <p className="text-[10px] text-text-tertiary mt-1">
          Click &quot;Get AI Suggestions&quot; to analyze your tune
        </p>
      </div>
    );
  }

  // Group by priority
  const grouped = {
    critical: recommendations.filter((r) => r.priority === "critical"),
    important: recommendations.filter((r) => r.priority === "important"),
    optional: recommendations.filter((r) => r.priority === "optional"),
  };

  const highConfidenceCount = recommendations.filter((r) => r.confidence >= 80).length;

  return (
    <div className="space-y-3">
      {/* Apply All button */}
      {highConfidenceCount > 0 && (
        <Button
          variant="primary"
          size="sm"
          icon={<Sparkles size={12} />}
          onClick={onApplyAll}
        >
          Apply All Recommended ({highConfidenceCount})
        </Button>
      )}

      {/* Recommendation cards by priority */}
      {(["critical", "important", "optional"] as const).map((priority) => {
        const recs = grouped[priority];
        if (recs.length === 0) return null;

        const config = PRIORITY_CONFIG[priority];
        const Icon = config.icon;

        return (
          <div key={priority} className="space-y-2">
            <div className="flex items-center gap-1.5">
              <Icon size={12} className={config.badge.split(" ")[1]} />
              <span className="text-[10px] font-medium text-text-secondary uppercase tracking-wide">
                {config.label}
              </span>
            </div>

            {recs.map((rec) => (
              <div
                key={rec.id}
                className={cn("border p-3 space-y-2", config.border, config.bg)}
              >
                {/* Header */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className={cn("text-[9px] font-mono px-1.5 py-0.5", config.badge)}>
                      {config.label}
                    </span>
                    <span className="text-xs font-medium text-text-primary">{rec.title}</span>
                  </div>
                  <ConfidenceBadge confidence={rec.confidence} />
                </div>

                {/* Explanation */}
                <p className="text-[10px] text-text-secondary leading-relaxed">
                  {rec.explanation}
                </p>

                {/* Parameter table */}
                {rec.parameters.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-[10px] font-mono">
                      <thead>
                        <tr className="border-b border-border-default text-text-tertiary">
                          <th className="text-left py-1 pr-2">Param</th>
                          <th className="text-right py-1 px-2">Current</th>
                          <th className="text-right py-1 px-2">Suggested</th>
                          <th className="text-right py-1 pl-2">Delta</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rec.parameters.map((p) => (
                          <tr key={p.param} className="border-b border-border-default/50">
                            <td className="py-0.5 pr-2 text-text-secondary">{p.param}</td>
                            <td className="py-0.5 px-2 text-right text-text-tertiary">
                              {p.currentValue.toFixed(4)}
                            </td>
                            <td className="py-0.5 px-2 text-right text-text-primary">
                              {p.suggestedValue.toFixed(4)}
                            </td>
                            <td
                              className={cn(
                                "py-0.5 pl-2 text-right",
                                p.delta > 0
                                  ? "text-status-success"
                                  : p.delta < 0
                                    ? "text-status-error"
                                    : "text-text-tertiary",
                              )}
                            >
                              {p.delta > 0 ? "+" : ""}
                              {p.delta.toFixed(4)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Apply button */}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onApply(rec.id)}
                >
                  Apply
                </Button>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
