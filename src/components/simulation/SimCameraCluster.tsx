/**
 * @module SimCameraCluster
 * @description On-canvas camera control cluster for the simulation 3D view.
 * Consolidates the camera-mode switch, reset-view, zoom, follow-heading lock,
 * auto-follow toggle, and a navigation-gesture help legend into one bottom-
 * right cluster (previously split between the right panel and the playback bar).
 * @license GPL-3.0-only
 */

"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { Viewer as CesiumViewer } from "cesium";
import { Plus, Minus, Frame, HelpCircle, X, Lock, Unlock, LocateFixed } from "lucide-react";
import { useSimulationStore } from "@/stores/simulation-store";
import { useSettingsStore } from "@/stores/settings-store";
import { Tooltip } from "@/components/ui/tooltip";
import { FloatingPanel } from "@/components/ui/floating-panel";
import { MAP_OVERLAY_Z } from "@/lib/map-overlay-z";
import { cn } from "@/lib/utils";
import { CAMERA_MODES } from "./sim-camera-modes";

interface SimCameraClusterProps {
  viewer: CesiumViewer | null;
}

function IconButton({
  active,
  onClick,
  label,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  label: string;
  children: ReactNode;
}) {
  return (
    <Tooltip content={label} position="top">
      <button
        onClick={onClick}
        aria-label={label}
        className={cn(
          "w-7 h-7 flex items-center justify-center rounded-md transition-colors cursor-pointer",
          active
            ? "bg-accent-primary text-bg-primary"
            : "text-text-secondary hover:text-text-primary hover:bg-bg-tertiary",
        )}
      >
        {children}
      </button>
    </Tooltip>
  );
}

export function SimCameraCluster({ viewer }: SimCameraClusterProps) {
  const t = useTranslations("simulate");
  const cameraMode = useSimulationStore((s) => s.cameraMode);
  const setCameraMode = useSimulationStore((s) => s.setCameraMode);
  const resetCameraView = useSimulationStore((s) => s.resetCameraView);
  const followHeadingLocked = useSimulationStore((s) => s.followHeadingLocked);
  const toggleFollowHeading = useSimulationStore((s) => s.toggleFollowHeading);
  const autoFollowOnPlay = useSettingsStore((s) => s.autoFollowOnPlay);
  const setAutoFollowOnPlay = useSettingsStore((s) => s.setAutoFollowOnPlay);
  const [helpOpen, setHelpOpen] = useState(false);

  const zoomBy = (dir: 1 | -1) => {
    if (!viewer || viewer.isDestroyed()) return;
    const camera = viewer.camera;
    const height = camera.positionCartographic.height;
    if (dir === 1) {
      // zoomIn bypasses the controller's minimumZoomDistance clamp and terrain
      // collision, so cap the step by the height above the GROUND below the
      // camera (not the ellipsoid) to keep a click 20 m clear of the terrain.
      const ground = viewer.scene.globe.getHeight(camera.positionCartographic) ?? 0;
      const agl = height - ground;
      camera.zoomIn(Math.min(agl * 0.3, Math.max(0, agl - 20)));
    } else {
      camera.zoomOut(height * 0.3);
    }
    // Required under requestRenderMode: an instantaneous camera move otherwise
    // won't paint until the next user gesture.
    viewer.scene.requestRender();
  };

  // Gesture legend rows: [gesture, action].
  const legend: [string, string][] = [
    [t("gestureLeftDrag"), t("cameraOrbit")],
    [t("gestureRightDrag"), t("gestureTilt")],
    [t("gestureScroll"), t("gestureZoom")],
    [t("gestureShiftDrag"), t("gestureLook")],
    [t("gestureCtrlDrag"), t("gestureTilt")],
  ];

  return (
    <FloatingPanel corner="bottom-right" padded={false} className="flex flex-col gap-1 p-1.5">
      {/* Camera modes */}
      <div className="flex gap-1">
        {CAMERA_MODES.map((m) => {
          const Icon = m.icon;
          return (
            <IconButton
              key={m.id}
              active={cameraMode === m.id}
              onClick={() => setCameraMode(m.id)}
              label={`${t(m.labelKey)} · ${m.key}`}
            >
              <Icon size={15} />
            </IconButton>
          );
        })}
      </div>

      <div className="h-px bg-border-default" />

      {/* Actions */}
      <div className="flex gap-1">
        <IconButton onClick={() => zoomBy(-1)} label={t("zoomOut")}>
          <Minus size={15} />
        </IconButton>
        <IconButton onClick={() => zoomBy(1)} label={t("zoomIn")}>
          <Plus size={15} />
        </IconButton>
        <IconButton onClick={resetCameraView} label={t("resetView")}>
          <Frame size={15} />
        </IconButton>
        {cameraMode === "follow" && (
          <IconButton
            onClick={toggleFollowHeading}
            active={followHeadingLocked}
            label={followHeadingLocked ? t("unlockCameraHeading") : t("lockCameraHeading")}
          >
            {followHeadingLocked ? <Lock size={14} /> : <Unlock size={14} />}
          </IconButton>
        )}
        <div className="relative">
          <IconButton onClick={() => setHelpOpen((v) => !v)} active={helpOpen} label={t("navHelp")}>
            <HelpCircle size={15} />
          </IconButton>
          {helpOpen && (
            <div
              className="absolute bottom-full right-0 mb-2 w-52 rounded-lg border border-border-default bg-bg-primary/95 backdrop-blur-md p-3 shadow-lg"
              style={{ zIndex: MAP_OVERLAY_Z.popover }}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-mono font-semibold text-text-primary">
                  {t("navHelpTitle")}
                </span>
                <button
                  onClick={() => setHelpOpen(false)}
                  aria-label={t("navHelpTitle")}
                  className="text-text-tertiary hover:text-text-primary cursor-pointer"
                >
                  <X size={12} />
                </button>
              </div>
              <div className="flex flex-col gap-1">
                {legend.map(([gesture, action]) => (
                  <div key={gesture} className="flex items-center justify-between gap-2">
                    <kbd className="text-[9px] font-mono px-1 py-0.5 bg-bg-tertiary border border-border-default text-text-secondary rounded shrink-0">
                      {gesture}
                    </kbd>
                    <span className="text-[10px] font-mono text-text-tertiary">{action}</span>
                  </div>
                ))}
              </div>
              <div className="h-px bg-border-default my-2" />
              <div className="flex flex-wrap gap-x-2 gap-y-1">
                {CAMERA_MODES.map((m) => (
                  <span key={m.id} className="text-[9px] font-mono text-text-tertiary">
                    <kbd className="px-1 py-0.5 bg-bg-tertiary border border-border-default rounded text-text-secondary">
                      {m.key}
                    </kbd>{" "}
                    {t(m.labelKey)}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="h-px bg-border-default" />

      {/* Auto-follow-on-play toggle — makes follow an armable user toggle. */}
      <button
        onClick={() => setAutoFollowOnPlay(!autoFollowOnPlay)}
        aria-pressed={autoFollowOnPlay}
        className={cn(
          "flex items-center gap-1.5 px-1.5 py-1 rounded-md text-[10px] font-mono transition-colors cursor-pointer",
          autoFollowOnPlay
            ? "bg-accent-primary/20 text-accent-primary"
            : "text-text-tertiary hover:text-text-secondary hover:bg-bg-tertiary",
        )}
      >
        <LocateFixed size={13} />
        <span className="truncate">{t("autoFollowOnPlay")}</span>
        <span
          className={cn(
            "ml-auto w-6 h-3 rounded-full relative transition-colors shrink-0",
            autoFollowOnPlay ? "bg-accent-primary" : "bg-border-default",
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 w-2 h-2 rounded-full bg-text-primary transition-all",
              autoFollowOnPlay ? "left-3.5" : "left-0.5",
            )}
          />
        </span>
      </button>
    </FloatingPanel>
  );
}
