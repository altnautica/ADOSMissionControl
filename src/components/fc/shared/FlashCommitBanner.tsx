"use client";

import { useTranslations } from "next-intl";
import { useParamSafetyStore } from "@/stores/param-safety-store";
import { useDroneManager } from "@/stores/drone-manager";
import { HardDrive, ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useFlashCommitToast } from "@/hooks/use-flash-commit-toast";
import { cn } from "@/lib/utils";

export function FlashCommitBanner() {
  const t = useTranslations("fcShared");
  const pendingWrites = useParamSafetyStore((s) => s.pendingWrites);
  const hasCritical = useParamSafetyStore((s) => s.hasCriticalPending());
  const commitFlash = useParamSafetyStore((s) => s.commitFlash);
  const { showFlashResult } = useFlashCommitToast();
  const [expanded, setExpanded] = useState(false);
  const [committing, setCommitting] = useState(false);

  const count = pendingWrites.size;
  if (count === 0) return null;

  // The command is fire-and-forget: `success` means it reached the wire and
  // `acknowledged` says whether the vehicle confirmed the store.
  async function handleCommitAll() {
    const protocol = useDroneManager.getState().getSelectedProtocol();
    if (!protocol) {
      showFlashResult({ sent: false, acknowledged: false });
      return;
    }
    setCommitting(true);
    try {
      const result = await protocol.commitParamsToFlash();
      if (result.success) commitFlash();
      showFlashResult({ sent: result.success, acknowledged: result.success && result.acknowledged !== false });
    } catch {
      showFlashResult({ sent: false, acknowledged: false });
    } finally {
      setCommitting(false);
    }
  }

  return (
    <div className={cn(
      "mx-3 mb-2 rounded border px-3 py-2 text-xs shrink-0",
      hasCritical
        ? "border-status-error/50 bg-status-error/10 animate-pulse"
        : "border-status-warning/50 bg-status-warning/10"
    )}>
      <div className="flex items-center gap-2">
        <HardDrive size={14} className={hasCritical ? "text-status-error" : "text-status-warning"} />
        <span className="flex-1">
          {t("pendingFlashCount", { count })}
          {hasCritical && <span className="text-status-error font-medium ml-1">{t("includesCritical")}</span>}
        </span>
        <button onClick={() => setExpanded(!expanded)} className="text-text-secondary hover:text-text-primary">
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        <Button size="sm" loading={committing} onClick={handleCommitAll}>{t("commitAll")}</Button>
      </div>

      {expanded && (
        <div className="mt-2 border-t border-border-default pt-2 space-y-1">
          {Array.from(pendingWrites.entries()).map(([name, info]) => (
            <div key={name} className="flex items-center gap-2 text-[10px] font-mono text-text-secondary">
              <span className="text-text-primary">{name}</span>
              <span>{info.oldValue} → {info.newValue}</span>
              <span className="text-text-tertiary">({info.panel})</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
