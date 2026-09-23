"use client";

/**
 * @module ConflictScanCard
 * @description Scans every known node ID for a second node claiming it.
 * The detection (repeated GetNodeInfo samples plus the NodeStatus uptime
 * stream over a listening window) lives in `scanNodeIdConflicts`. IDs that
 * produced no evidence at all are reported as silent, never as clean.
 *
 * @license GPL-3.0-only
 */

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useDroneCanNodeStore } from "@/stores/dronecan/node-store";
import {
  scanNodeIdConflicts,
  type ConflictScanClient,
  type ConflictScanReport,
} from "@/lib/dronecan/node-id-conflict";

export interface ConflictScanCardProps {
  client?: ConflictScanClient | null;
}

export function ConflictScanCard({ client }: ConflictScanCardProps) {
  const t = useTranslations("canConfig.testUtilities.conflictScan");
  const nodesMap = useDroneCanNodeStore((s) => s.nodes);

  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ConflictScanReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleScan = useCallback(async () => {
    if (!client || busy) return;
    setBusy(true);
    setResult(null);
    setError(null);
    try {
      setResult(await scanNodeIdConflicts(client, Array.from(nodesMap.keys())));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [client, busy, nodesMap]);

  return (
    <Card title={t("title")}>
      <div className="flex items-center gap-3 flex-wrap">
        <Button
          variant="secondary"
          size="sm"
          icon={<AlertTriangle size={12} />}
          onClick={handleScan}
          disabled={!client || busy}
          loading={busy}
        >
          {t("button")}
        </Button>
        <div className="flex-1 min-w-[240px] text-[11px] font-mono space-y-0.5">
          {error ? (
            <span className="text-status-error">{error}</span>
          ) : result === null ? (
            <span className="text-text-tertiary">—</span>
          ) : (
            <>
              {result.conflicts.length > 0 ? (
                <div className="text-status-error" data-testid="conflict-scan-found">
                  {t("conflictDetected", {
                    count: result.conflicts.length,
                    ids: result.conflicts.map((c) => c.nodeId).join(", "),
                  })}
                </div>
              ) : result.clean.length > 0 ? (
                <div className="text-status-success" data-testid="conflict-scan-clean">
                  {t("noConflicts", { count: result.clean.length })}
                </div>
              ) : null}
              {result.silent.length > 0 && (
                <div className="text-status-warning" data-testid="conflict-scan-silent">
                  {t("noResponse", { ids: result.silent.join(", ") })}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </Card>
  );
}
