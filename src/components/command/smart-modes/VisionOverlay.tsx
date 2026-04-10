"use client";

/**
 * @module VisionOverlay
 * @description Canvas overlay on video feed rendering bounding boxes, track IDs,
 * confidence labels, and designated target reticle from vision engine detections.
 * @license GPL-3.0-only
 */

import { useRef, useEffect, useCallback } from "react";
import type { Detection } from "@/lib/agent/feature-types";

interface VisionOverlayProps {
  /** Detection results from the vision engine. */
  detections: Detection[];
  /** Natural width of the video frame (for coordinate scaling). */
  frameWidth: number;
  /** Natural height of the video frame. */
  frameHeight: number;
  /** Container width to scale canvas to. */
  containerWidth: number;
  /** Container height to scale canvas to. */
  containerHeight: number;
  /** Active behavior state text to display. */
  statusText?: string;
}

const COLORS = {
  confirmed: "#22c55e",    // green — confirmed track
  detection: "#eab308",    // yellow — new detection
  designated: "#3b82f6",   // blue — designated target
  text: "#ffffff",
  textBg: "rgba(0, 0, 0, 0.6)",
  reticle: "#3b82f6",
};

export function VisionOverlay({
  detections,
  frameWidth,
  frameHeight,
  containerWidth,
  containerHeight,
  statusText,
}: VisionOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Set canvas size to match container
    canvas.width = containerWidth;
    canvas.height = containerHeight;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (frameWidth === 0 || frameHeight === 0) return;

    const scaleX = containerWidth / frameWidth;
    const scaleY = containerHeight / frameHeight;

    for (const det of detections) {
      const x = det.bbox.x * scaleX;
      const y = det.bbox.y * scaleY;
      const w = det.bbox.w * scaleX;
      const h = det.bbox.h * scaleY;

      // Pick color
      const color = det.designated
        ? COLORS.designated
        : det.track_id !== undefined
          ? COLORS.confirmed
          : COLORS.detection;

      // Bounding box
      ctx.strokeStyle = color;
      ctx.lineWidth = det.designated ? 2.5 : 1.5;
      ctx.strokeRect(x, y, w, h);

      // Corner brackets for designated target
      if (det.designated) {
        const bracketLen = Math.min(w, h) * 0.2;
        ctx.lineWidth = 3;
        // Top-left
        ctx.beginPath();
        ctx.moveTo(x, y + bracketLen);
        ctx.lineTo(x, y);
        ctx.lineTo(x + bracketLen, y);
        ctx.stroke();
        // Top-right
        ctx.beginPath();
        ctx.moveTo(x + w - bracketLen, y);
        ctx.lineTo(x + w, y);
        ctx.lineTo(x + w, y + bracketLen);
        ctx.stroke();
        // Bottom-left
        ctx.beginPath();
        ctx.moveTo(x, y + h - bracketLen);
        ctx.lineTo(x, y + h);
        ctx.lineTo(x + bracketLen, y + h);
        ctx.stroke();
        // Bottom-right
        ctx.beginPath();
        ctx.moveTo(x + w - bracketLen, y + h);
        ctx.lineTo(x + w, y + h);
        ctx.lineTo(x + w, y + h - bracketLen);
        ctx.stroke();

        // Crosshair at center
        const cx = x + w / 2;
        const cy = y + h / 2;
        const crossSize = 8;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cx - crossSize, cy);
        ctx.lineTo(cx + crossSize, cy);
        ctx.moveTo(cx, cy - crossSize);
        ctx.lineTo(cx, cy + crossSize);
        ctx.stroke();
      }

      // Label background
      const label = det.designated
        ? `${det.class} ${Math.round(det.confidence * 100)}%`
        : det.track_id !== undefined
          ? `#${det.track_id} ${det.class} ${Math.round(det.confidence * 100)}%`
          : `${det.class} ${Math.round(det.confidence * 100)}%`;

      ctx.font = "10px monospace";
      const metrics = ctx.measureText(label);
      const labelH = 14;
      const labelY = y - labelH - 2;

      ctx.fillStyle = COLORS.textBg;
      ctx.fillRect(x, labelY, metrics.width + 6, labelH);
      ctx.fillStyle = COLORS.text;
      ctx.fillText(label, x + 3, labelY + 10);
    }

    // Status text overlay (top-left)
    if (statusText) {
      ctx.font = "bold 11px monospace";
      const statusMetrics = ctx.measureText(statusText);
      ctx.fillStyle = COLORS.textBg;
      ctx.fillRect(8, 8, statusMetrics.width + 12, 20);
      ctx.fillStyle = COLORS.text;
      ctx.fillText(statusText, 14, 22);
    }
  }, [detections, frameWidth, frameHeight, containerWidth, containerHeight, statusText]);

  useEffect(() => {
    draw();
  }, [draw]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 pointer-events-none"
      style={{ width: containerWidth, height: containerHeight }}
    />
  );
}
