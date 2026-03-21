"use client";

/**
 * @module TransformPanel
 * @description Mission transform tools: move, rotate, and scale entire missions.
 * @license GPL-3.0-only
 */

import { useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Move, RotateCw, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useMissionStore } from "@/stores/mission-store";
import { useToast } from "@/components/ui/toast";
import {
  moveMissionByBearing,
  rotateMission,
  scaleMission,
} from "@/lib/transforms/mission-transforms";
import type { Waypoint } from "@/lib/types";

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

  // Confirm dialog
  const [pendingAction, setPendingAction] = useState<"move" | "rotate" | "scale" | null>(null);

  const handleMove = useCallback(() => {
    if (waypoints.length === 0) return;
    const moved = moveMissionByBearing(waypoints, moveBearing, moveDistance);
    setWaypoints(moved as Waypoint[]);
    toast(`Moved ${moveDistance}m at ${moveBearing}°`, "success");
  }, [waypoints, moveBearing, moveDistance, setWaypoints, toast]);

  const handleRotate = useCallback(() => {
    if (waypoints.length === 0) return;
    const rotated = rotateMission(waypoints, rotateAngle);
    setWaypoints(rotated as Waypoint[]);
    toast(`Rotated ${rotateAngle}°`, "success");
  }, [waypoints, rotateAngle, setWaypoints, toast]);

  const handleScale = useCallback(() => {
    if (waypoints.length === 0) return;
    const scaled = scaleMission(waypoints, scaleFactor);
    setWaypoints(scaled as Waypoint[]);
    toast(`Scaled ${scaleFactor}x`, "success");
  }, [waypoints, scaleFactor, setWaypoints, toast]);

  const confirmTransform = useCallback(() => {
    if (pendingAction === "move") handleMove();
    else if (pendingAction === "rotate") handleRotate();
    else if (pendingAction === "scale") handleScale();
    setPendingAction(null);
  }, [pendingAction, handleMove, handleRotate, handleScale]);

  const confirmMessage = pendingAction === "move"
    ? `Move all ${waypoints.length} waypoints ${moveDistance}m at ${moveBearing}°?`
    : pendingAction === "rotate"
      ? `Rotate all ${waypoints.length} waypoints by ${rotateAngle}°?`
      : `Scale all ${waypoints.length} waypoints by ${scaleFactor}x?`;

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
          <Input
            type="number"
            value={moveBearing}
            onChange={(e) => setMoveBearing(Number(e.target.value))}
            min={0}
            max={360}
            step={15}
            className="flex-1"
            label={t("bearing")}
          />
          <Input
            type="number"
            value={moveDistance}
            onChange={(e) => setMoveDistance(Number(e.target.value))}
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
          <span>Rotate Mission</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Input
            type="number"
            value={rotateAngle}
            onChange={(e) => setRotateAngle(Number(e.target.value))}
            min={-360}
            max={360}
            step={15}
            className="flex-1"
            label="Angle °"
          />
          <Button variant="ghost" size="sm" onClick={() => setPendingAction("rotate")} disabled={disabled}>
            Rotate
          </Button>
        </div>
      </div>

      {/* Scale */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5 text-xs text-text-secondary">
          <Maximize2 size={12} />
          <span>Scale Mission</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Input
            type="number"
            value={scaleFactor}
            onChange={(e) => setScaleFactor(Number(e.target.value))}
            min={0.1}
            max={10}
            step={0.1}
            className="flex-1"
            label="Factor"
          />
          <Button variant="ghost" size="sm" onClick={() => setPendingAction("scale")} disabled={disabled}>
            Scale
          </Button>
        </div>
      </div>

      {disabled && (
        <p className="text-[10px] text-text-tertiary">
          Add at least 2 waypoints to use transform tools.
        </p>
      )}

      <ConfirmDialog
        open={pendingAction !== null}
        onConfirm={confirmTransform}
        onCancel={() => setPendingAction(null)}
        title="Apply Transform"
        message={confirmMessage}
        confirmLabel="Apply"
      />
    </div>
  );
}
