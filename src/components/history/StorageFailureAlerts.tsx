"use client";

/**
 * Tells the operator when local storage refuses a write that matters: flight
 * telemetry, or the planner autosave. Both writers run outside React and
 * report failures through listeners; this component turns each into a toast.
 * Mounted once inside the root toast provider.
 *
 * @license GPL-3.0-only
 */

import { useEffect } from "react";
import { useToast } from "@/components/ui/toast";
import { onRecordingStorageFailure } from "@/lib/telemetry-recorder";
import { onAutoSaveFailure } from "@/lib/mission-io";

export function StorageFailureAlerts() {
  const { toast } = useToast();
  useEffect(() => {
    const offRecording = onRecordingStorageFailure(() => {
      toast("Flight telemetry could not be saved: storage is full", "error");
    });
    const offAutoSave = onAutoSaveFailure(() => {
      toast("The plan could not be autosaved: browser storage is full or blocked. Save or export it.", "warning");
    });
    return () => {
      offRecording();
      offAutoSave();
    };
  }, [toast]);
  return null;
}
