"use client";

/**
 * History detail panel — tabbed shell for the right rail.
 *
 * Phase 4a:
 *  - Overview / Map / Notes / Export tabs are real and functional.
 *  - Charts / Events / Analysis tabs render Placeholder cards (Phase 4b + 5).
 *
 * @license GPL-3.0-only
 */

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { X, Play, Lock, Unlock } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { FlightRecord, FlightEvent } from "@/lib/types";
import { listRecordings, type TelemetryRecording } from "@/lib/telemetry-recorder";
import { signRecord, verifyRecord } from "@/lib/compliance/sign";
import { useHistoryStore } from "@/stores/history-store";
import { useOperatorProfileStore } from "@/stores/operator-profile-store";
import { OverviewTab } from "./tabs/OverviewTab";
import { MapTab } from "./tabs/MapTab";
import { ChartsTab } from "./tabs/ChartsTab";
import { EventsTab } from "./tabs/EventsTab";
import { AnalysisTab } from "./tabs/AnalysisTab";
import { NotesTab } from "./tabs/NotesTab";
import { ExportTab } from "./tabs/ExportTab";
import { cn } from "@/lib/utils";

const statusVariant: Record<string, "success" | "warning" | "error" | "neutral"> = {
  completed: "success",
  aborted: "warning",
  emergency: "error",
  in_progress: "neutral",
};

type TabId = "overview" | "map" | "charts" | "events" | "analysis" | "notes" | "export";

const TABS: { id: TabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "map", label: "Map" },
  { id: "charts", label: "Charts" },
  { id: "events", label: "Events" },
  { id: "analysis", label: "Analysis" },
  { id: "notes", label: "Notes" },
  { id: "export", label: "Export" },
];

interface HistoryDetailPanelProps {
  record: FlightRecord;
  onClose: () => void;
  onReplay?: (recording: TelemetryRecording) => void;
}

export function HistoryDetailPanel({ record, onClose, onReplay }: HistoryDetailPanelProps) {
  const [active, setActive] = useState<TabId>("overview");
  const [recordings, setRecordings] = useState<TelemetryRecording[]>([]);
  const [signing, setSigning] = useState(false);
  const operatorProfile = useOperatorProfileStore((s) => s.profile);

  useEffect(() => {
    listRecordings().then(setRecordings);
  }, []);

  const sealed = !!record.pilotSignatureHash;

  const handleSign = async () => {
    setSigning(true);
    try {
      const patch = await signRecord(record, operatorProfile.signatureImageBase64);
      const store = useHistoryStore.getState();
      store.updateRecord(record.id, patch);
      void store.persistToIDB();
    } catch (err) {
      console.error("[HistoryDetailPanel] sign failed", err);
      if (typeof window !== "undefined") window.alert(`Sign failed: ${(err as Error).message}`);
    } finally {
      setSigning(false);
    }
  };

  const handleUnseal = async () => {
    if (typeof window !== "undefined") {
      const ok = window.confirm(
        "Unseal this record? Subsequent edits will invalidate the previous signature. An audit event will be logged.",
      );
      if (!ok) return;
    }
    const store = useHistoryStore.getState();
    const auditEvent: FlightEvent = {
      t: 0,
      type: "manual_note",
      severity: "warning",
      label: `Record unsealed at ${new Date().toLocaleString()}`,
    };
    const newEvents = [...(record.events ?? []), auditEvent];
    store.updateRecord(record.id, {
      pilotSignatureHash: undefined,
      pilotSignedAt: undefined,
      events: newEvents,
    });
    void store.persistToIDB();
  };

  const handleVerify = async () => {
    const ok = await verifyRecord(record, operatorProfile.signatureImageBase64);
    if (typeof window !== "undefined") {
      window.alert(ok ? "Signature OK — record is unmodified." : "Signature INVALID — record has been altered since signing.");
    }
  };

  // Match recording by recordingId first (Phase 2), fall back to drone+time fuzzy.
  const matchedRecording = recordings.find((rec) => {
    if (record.recordingId && rec.id === record.recordingId) return true;
    if (rec.droneId && rec.droneId === record.droneId) {
      const timeDiff = Math.abs(rec.startTime - (record.startTime ?? record.date));
      return timeDiff < 60_000;
    }
    return false;
  });

  return (
    <div className="w-[420px] border-l border-border-default bg-bg-secondary flex flex-col shrink-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-default flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="text-xs font-semibold text-text-primary uppercase tracking-wider truncate">
            {record.customName || "Flight Detail"}
          </h3>
          <Badge variant={statusVariant[record.status] ?? "neutral"} size="sm">
            {record.status}
          </Badge>
        </div>
        <div className="flex items-center gap-1">
          {sealed ? (
            <>
              <Badge variant="success" size="sm">
                <Lock size={10} className="inline mr-1" />
                Sealed
              </Badge>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleVerify}
                title="Verify signature hash"
              >
                Verify
              </Button>
              <Button
                variant="ghost"
                size="sm"
                icon={<Unlock size={12} />}
                onClick={handleUnseal}
                title="Unseal to allow edits"
              >
                Unseal
              </Button>
            </>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              icon={<Lock size={12} />}
              onClick={handleSign}
              disabled={signing}
              title="Sign and lock this record"
            >
              {signing ? "Signing…" : "Sign & lock"}
            </Button>
          )}
          {matchedRecording && matchedRecording.channels.includes("position") && onReplay && (
            <Button
              variant="ghost"
              size="sm"
              icon={<Play size={12} />}
              onClick={() => onReplay(matchedRecording)}
              title="Replay flight"
            >
              Replay
            </Button>
          )}
          <button
            onClick={onClose}
            className="text-text-tertiary hover:text-text-primary transition-colors cursor-pointer p-1"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Tab strip */}
      <div className="flex border-b border-border-default shrink-0 overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActive(tab.id)}
            className={cn(
              "px-3 py-2 text-[10px] font-semibold uppercase tracking-wider transition-colors whitespace-nowrap",
              active === tab.id
                ? "text-accent-primary border-b border-accent-primary"
                : "text-text-tertiary hover:text-text-primary",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab body */}
      <div className="flex-1 overflow-y-auto p-3">
        {active === "overview" && <OverviewTab record={record} />}
        {active === "map" && <MapTab record={record} />}
        {active === "charts" && <ChartsTab record={record} />}
        {active === "events" && <EventsTab record={record} />}
        {active === "analysis" && <AnalysisTab record={record} />}
        {active === "notes" && <NotesTab record={record} />}
        {active === "export" && <ExportTab record={record} matchedRecording={matchedRecording} />}
      </div>
    </div>
  );
}
