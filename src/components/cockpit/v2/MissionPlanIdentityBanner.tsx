"use client";

/**
 * @module cockpit/v2/MissionPlanIdentityBanner
 * @description On every map view: when the plan on the drone is not the
 * plan this device uploaded, say so and offer to load the drone's plan (the
 * maps then draw the agent's mirror of it). The rule is in
 * `lib/mission/plan-identity`.
 *
 * Loading works as the planner's "Download from drone" does: the drone's plan
 * becomes a new library plan, unsaved edits to the open plan are offered for
 * saving first, and a failed or empty download is said, never loaded.
 *
 * @license GPL-3.0-only
 */

import { useState } from "react";
import { useTranslations } from "next-intl";

import { UnsavedChangesDialog } from "@/components/library/UnsavedChangesDialog";
import { useToast } from "@/components/ui/toast";
import { useDronePlanIdentity } from "@/lib/mission/mission-mirror";
import { capturePlanExtras } from "@/lib/plan-workspace";
import { cn } from "@/lib/utils";
import { useMissionStore } from "@/stores/mission-store";
import { usePlanLibraryStore } from "@/stores/plan-library-store";
import { usePlannerStore } from "@/stores/planner-store";

export function MissionPlanIdentityBanner({ droneId, className }: { droneId: string; className?: string }) {
  const identity = useDronePlanIdentity(droneId);
  const t = useTranslations("flightScreen.planBanner");
  const tIo = useTranslations("plannerIo");
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  if (identity !== "differs") return null;

  const download = async () => {
    setLoading(true);
    setError(null);
    try {
      const downloaded = await useMissionStore.getState().downloadMission();
      // A failed transfer lands in the store as `downloadState: "error"` with
      // an empty list; that is not "no mission on the drone".
      const { downloadState, downloadError, downloadWarnings } = useMissionStore.getState();
      if (downloadState === "error") {
        setError(
          downloadError ? tIo("downloadFailedWithError", { error: downloadError }) : tIo("downloadFailed"),
        );
        return;
      }
      for (const warning of downloadWarnings) toast(warning, "warning");
      if (downloaded.length === 0) {
        setError(tIo("vehicleHasNoMission"));
        return;
      }
      const time = new Date().toLocaleTimeString("en-US", { hour12: false });
      usePlanLibraryStore.getState().createPlan(
        tIo("droneMissionName", { time }),
        downloaded,
        { droneId },
        { settings: capturePlanExtras().settings },
      );
      usePlannerStore.getState().requestFit();
      toast(tIo("loadedFromDrone", { count: downloaded.length }), "success");
    } catch (err) {
      setError(
        err instanceof Error ? tIo("downloadFailedWithError", { error: err.message }) : tIo("downloadFailed"),
      );
    } finally {
      setLoading(false);
    }
  };

  const load = () => {
    const lib = usePlanLibraryStore.getState();
    if (lib.isDirty && lib.activePlanId) {
      setConfirmOpen(true);
      return;
    }
    void download();
  };

  const saveAndLoad = () => {
    const lib = usePlanLibraryStore.getState();
    if (lib.activePlanId) {
      lib.savePlan(lib.activePlanId, useMissionStore.getState().waypoints, undefined, capturePlanExtras());
    }
    setConfirmOpen(false);
    void download();
  };

  return (
    <div
      role="status"
      data-testid="plan-identity-banner"
      className={cn(
        "glass-panel pointer-events-auto flex items-center gap-3 px-3 py-2 text-xs text-text-primary",
        className,
      )}
    >
      <span>{t("differs")}</span>
      <button
        type="button"
        onClick={load}
        disabled={loading}
        className="rounded bg-accent-primary/20 px-2 py-1 font-semibold text-accent-primary hover:bg-accent-primary/30 disabled:opacity-50"
      >
        {loading ? t("loading") : t("load")}
      </button>
      {error && (
        <span role="alert" data-testid="plan-identity-error" className="text-status-error">
          {error}
        </span>
      )}
      <UnsavedChangesDialog
        open={confirmOpen}
        onSaveAndSwitch={saveAndLoad}
        onDiscardAndSwitch={() => {
          setConfirmOpen(false);
          void download();
        }}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
