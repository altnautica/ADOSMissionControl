"use client";

/**
 * @module TransformPanel
 * @description Mission transform tools: move, rotate, scale, and mirror entire
 * missions. Rotate and scale operate around the mission centroid by default, or
 * around an operator-entered pivot point.
 * @license GPL-3.0-only
 */

import { useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Move, RotateCw, Maximize2, FlipHorizontal, Crosshair, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NumericField } from "@/components/ui/numeric-field";
import { Select } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useMissionStore } from "@/stores/mission-store";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import {
  moveMissionByBearing,
  rotateMission,
  rotateMissionAroundPoint,
  scaleMission,
  scaleMissionFromPoint,
  mirrorMission,
} from "@/lib/transforms/mission-transforms";
import type { Waypoint } from "@/lib/types";

type MirrorAxis = "lat" | "lon";
type PendingAction = "move" | "rotate" | "scale" | "mirror" | null;

export function TransformPanel() {
  const t = useTranslations("transform");
  const waypoints = useMissionStore((s) => s.waypoints);
  const setWaypoints = useMissionStore((s) => s.setWaypoints);
  const { toast } = useToast();

  // Move controls
  const [moveBearing, setMoveBearing] = useState(0);
  const [moveDistance, setMoveDistance] = useState(100);

  // Rotate controls
  const [rotateAngle, setRotateAngle] = useState(45);

  // Scale controls
  const [scaleFactor, setScaleFactor] = useState(1.5);

  // Optional custom pivot for rotate + scale (defaults to the mission centroid)
  const [useCustomCenter, setUseCustomCenter] = useState(false);
  const [centerLat, setCenterLat] = useState(0);
  const [centerLon, setCenterLon] = useState(0);

  // Mirror controls
  const [mirrorAxis, setMirrorAxis] = useState<MirrorAxis>("lat");

  // Confirm dialog
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);

  const toggleCustomCenter = useCallback(() => {
    setUseCustomCenter((prev) => {
      const next = !prev;
      // Seed the pivot with the current mission centroid the first time it is
      // enabled so the operator edits a sensible starting point.
      if (next && waypoints.length > 0) {
        const meanLat = waypoints.reduce((s, w) => s + w.lat, 0) / waypoints.length;
        const meanLon = waypoints.reduce((s, w) => s + w.lon, 0) / waypoints.length;
        setCenterLat(Number(meanLat.toFixed(6)));
        setCenterLon(Number(meanLon.toFixed(6)));
      }
      return next;
    });
  }, [waypoints]);

  const handleMove = useCallback(() => {
    if (waypoints.length === 0) return;
    const moved = moveMissionByBearing(waypoints, moveBearing, moveDistance);
    setWaypoints(moved as Waypoint[]);
    toast(`Moved ${moveDistance}m at ${moveBearing}°`, "success");
  }, [waypoints, moveBearing, moveDistance, setWaypoints, toast]);

  const handleRotate = useCallback(() => {
    if (waypoints.length === 0) return;
    const rotated = useCustomCenter
      ? rotateMissionAroundPoint(waypoints, rotateAngle, centerLat, centerLon)
      : rotateMission(waypoints, rotateAngle);
    setWaypoints(rotated as Waypoint[]);
    toast(`Rotated ${rotateAngle}°`, "success");
  }, [waypoints, rotateAngle, useCustomCenter, centerLat, centerLon, setWaypoints, toast]);

  const handleScale = useCallback(() => {
    if (waypoints.length === 0) return;
    const scaled = useCustomCenter
      ? scaleMissionFromPoint(waypoints, scaleFactor, centerLat, centerLon)
      : scaleMission(waypoints, scaleFactor);
    setWaypoints(scaled as Waypoint[]);
    toast(`Scaled ${scaleFactor}x`, "success");
  }, [waypoints, scaleFactor, useCustomCenter, centerLat, centerLon, setWaypoints, toast]);

  const handleMirror = useCallback(() => {
    if (waypoints.length === 0) return;
    const mirrored = mirrorMission(waypoints, mirrorAxis);
    setWaypoints(mirrored as Waypoint[]);
    toast(mirrorAxis === "lat" ? "Mirrored horizontally" : "Mirrored vertically", "success");
  }, [waypoints, mirrorAxis, setWaypoints, toast]);

  const confirmTransform = useCallback(() => {
    if (pendingAction === "move") handleMove();
    else if (pendingAction === "rotate") handleRotate();
    else if (pendingAction === "scale") handleScale();
    else if (pendingAction === "mirror") handleMirror();
    setPendingAction(null);
  }, [pendingAction, handleMove, handleRotate, handleScale, handleMirror]);

  const confirmMessage = pendingAction === "move"
    ? `Move all ${waypoints.length} waypoints ${moveDistance}m at ${moveBearing}°?`
    : pendingAction === "rotate"
      ? `Rotate all ${waypoints.length} waypoints by ${rotateAngle}°?`
      : pendingAction === "scale"
        ? `Scale all ${waypoints.length} waypoints by ${scaleFactor}x?`
        : pendingAction === "mirror"
          ? `Mirror all ${waypoints.length} waypoints ${mirrorAxis === "lat" ? "horizontally" : "vertically"}?`
          : "";

  const disabled = waypoints.length < 2;

  return (
    <div className="px-3 py-2 space-y-3">
      {/* Move */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5 text-xs text-text-secondary">
          <Move size={12} />
          <span>{t("move")}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <NumericField
            value={moveBearing}
            onCommit={setMoveBearing}
            min={0}
            max={360}
            step={15}
            className="flex-1"
            label={t("bearing")}
          />
          <NumericField
            value={moveDistance}
            onCommit={setMoveDistance}
            min={1}
            max={100000}
            step={50}
            className="flex-1"
            label={t("distanceM")}
          />
          <Button variant="ghost" size="sm" onClick={() => setPendingAction("move")} disabled={disabled}>
            {t("move")}
          </Button>
        </div>
      </div>

      {/* Rotate */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5 text-xs text-text-secondary">
          <RotateCw size={12} />
          <span>{t("rotate")}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <NumericField
            value={rotateAngle}
            onCommit={setRotateAngle}
            min={-360}
            max={360}
            step={15}
            className="flex-1"
            label={t("rotationAngle")}
          />
          <Button variant="ghost" size="sm" onClick={() => setPendingAction("rotate")} disabled={disabled}>
            {t("rotate")}
          </Button>
        </div>
      </div>

      {/* Scale */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5 text-xs text-text-secondary">
          <Maximize2 size={12} />
          <span>{t("scale")}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <NumericField
            value={scaleFactor}
            onCommit={setScaleFactor}
            min={0.1}
            max={10}
            step={0.1}
            className="flex-1"
            label={t("scaleFactor")}
          />
          <Button variant="ghost" size="sm" onClick={() => setPendingAction("scale")} disabled={disabled}>
            {t("scale")}
          </Button>
        </div>
      </div>

      {/* Custom pivot for rotate + scale */}
      <div className="space-y-1.5">
        <button
          type="button"
          onClick={toggleCustomCenter}
          className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-text-primary cursor-pointer"
        >
          <span className={cn(
            "w-3.5 h-3.5 border flex items-center justify-center shrink-0",
            useCustomCenter ? "bg-accent-primary border-accent-primary" : "border-border-default"
          )}>
            {useCustomCenter && <Check size={10} className="text-bg-primary" />}
          </span>
          <Crosshair size={12} />
          <span>{t("customPivot")}</span>
        </button>
        {useCustomCenter && (
          <>
            <div className="flex items-center gap-1.5">
              <NumericField
                value={centerLat}
                onCommit={setCenterLat}
                min={-90}
                max={90}
                step={0.0001}
                className="flex-1"
                label={t("pivotLat")}
              />
              <NumericField
                value={centerLon}
                onCommit={setCenterLon}
                min={-180}
                max={180}
                step={0.0001}
                className="flex-1"
                label={t("pivotLon")}
              />
            </div>
            <p className="text-[10px] text-text-tertiary">{t("pivotHint")}</p>
          </>
        )}
      </div>

      {/* Mirror */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5 text-xs text-text-secondary">
          <FlipHorizontal size={12} />
          <span>{t("mirror")}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Select
            className="flex-1"
            label={t("axis")}
            value={mirrorAxis}
            onChange={(v) => setMirrorAxis(v as MirrorAxis)}
            options={[
              { value: "lat", label: t("horizontal") },
              { value: "lon", label: t("vertical") },
            ]}
          />
          <Button variant="ghost" size="sm" onClick={() => setPendingAction("mirror")} disabled={disabled}>
            {t("mirror")}
          </Button>
        </div>
      </div>

      {disabled && (
        <p className="text-[10px] text-text-tertiary">
          {t("minWaypointsHint")}
        </p>
      )}

      <ConfirmDialog
        open={pendingAction !== null}
        onConfirm={confirmTransform}
        onCancel={() => setPendingAction(null)}
        title={t("applyTransform")}
        message={confirmMessage}
        confirmLabel={t("apply")}
      />
    </div>
  );
}
