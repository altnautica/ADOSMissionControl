"use client";

/**
 * @module CompassStreamCard
 * @description Compass raw stream UI. Subscribes to `MagneticFieldStrength2`
 * broadcasts from the selected node for the configured duration, plots
 * X/Y/Z over time on a small SVG, and exports the captured samples as a
 * CSV.
 *
 * @license GPL-3.0-only
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslations } from "next-intl";
import { Compass, Gauge } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { MagneticFieldStrength2 } from "@/lib/dronecan/dsdl/magnetic-field-strength-2";
import { RingBuffer } from "@/lib/ring-buffer";

interface MagSample {
  ts: number;
  x: number;
  y: number;
  z: number;
}

export interface CompassStreamClient {
  subscribeMag2(
    nodeId: number,
    cb: (mag: MagneticFieldStrength2) => void,
  ): () => void;
}

export interface CompassStreamCardProps {
  client?: CompassStreamClient | null;
}

const PLOT_WIDTH = 320;
const PLOT_HEIGHT = 80;
const MAX_SAMPLES = 5000;

export function CompassStreamCard({ client }: CompassStreamCardProps = {}) {
  const t = useTranslations("canConfig.testUtilities.compass");

  const [nodeIdRaw, setNodeIdRaw] = useState("");
  const [durationRaw, setDurationRaw] = useState("10");
  // Samples live in a ring (latest MAX_SAMPLES); `sampleCount` drives renders
  // so a stream does not copy the whole array on every sample.
  const [ring] = useState(() => new RingBuffer<MagSample>(MAX_SAMPLES));
  const [, setSampleCount] = useState(0);
  const samples = ring.toArray();
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cleanup = useCallback(() => {
    if (unsubRef.current) {
      unsubRef.current();
      unsubRef.current = null;
    }
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const parsedNodeId = useMemo(() => {
    const n = Number.parseInt(nodeIdRaw, 10);
    return Number.isFinite(n) && n >= 1 && n <= 127 ? n : null;
  }, [nodeIdRaw]);

  const durationMs = useMemo(() => {
    const n = Number.parseInt(durationRaw, 10);
    return Number.isFinite(n) && n >= 1 ? n * 1000 : 0;
  }, [durationRaw]);

  const handleCapture = useCallback(() => {
    if (!client || parsedNodeId == null || durationMs <= 0) return;
    cleanup();
    setError(null);
    ring.clear();
    setSampleCount(0);
    setCapturing(true);
    try {
      const startedAt = Date.now();
      unsubRef.current = client.subscribeMag2(parsedNodeId, (mag) => {
        const [x, y, z] = mag.magneticFieldGa;
        ring.push({ ts: Date.now() - startedAt, x, y, z });
        setSampleCount((n) => n + 1);
      });
      timerRef.current = setTimeout(() => {
        cleanup();
        setCapturing(false);
      }, durationMs);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setCapturing(false);
    }
  }, [client, parsedNodeId, durationMs, cleanup, ring]);

  const exportCsv = useCallback(() => {
    if (samples.length === 0) return;
    const lines = ["t_ms,x_ga,y_ga,z_ga"];
    for (const s of samples) {
      lines.push(`${s.ts},${s.x.toFixed(6)},${s.y.toFixed(6)},${s.z.toFixed(6)}`);
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `compass-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [samples]);

  return (
    <Card title={t("title")}>
      <div className="flex items-end gap-2 flex-wrap">
        <div className="w-32">
          <Input
            label={t("nodeId")}
            type="number"
            min={1}
            max={127}
            value={nodeIdRaw}
            onChange={(e) => setNodeIdRaw(e.target.value)}
            disabled={capturing}
          />
        </div>
        <div className="w-32">
          <Input
            label={t("duration")}
            type="number"
            min={1}
            value={durationRaw}
            onChange={(e) => setDurationRaw(e.target.value)}
            unit="s"
            disabled={capturing}
          />
        </div>
        <Button
          variant="secondary"
          size="sm"
          icon={<Compass size={12} />}
          onClick={handleCapture}
          disabled={
            !client || parsedNodeId == null || durationMs <= 0 || capturing
          }
          loading={capturing}
        >
          {t("button")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon={<Gauge size={12} />}
          onClick={exportCsv}
          disabled={samples.length === 0}
          data-testid="compass-export"
        >
          {t("exportCsv")}
        </Button>
        {error && (
          <span
            className="text-[11px] text-status-error"
            data-testid="compass-error"
          >
            {error}
          </span>
        )}
      </div>
      <div className="mt-3" data-testid="compass-plot">
        <CompassPlot samples={samples} />
      </div>
      <div className="mt-1 text-[10px] text-text-tertiary font-mono">
        {samples.length} {t("samples")}
      </div>
    </Card>
  );
}

function CompassPlot({ samples }: { samples: MagSample[] }) {
  if (samples.length < 2) {
    return (
      <svg
        width={PLOT_WIDTH}
        height={PLOT_HEIGHT}
        className="bg-bg-secondary rounded"
      />
    );
  }
  let min = samples[0].x;
  let max = samples[0].x;
  for (const s of samples) {
    if (s.x < min) min = s.x;
    if (s.y < min) min = s.y;
    if (s.z < min) min = s.z;
    if (s.x > max) max = s.x;
    if (s.y > max) max = s.y;
    if (s.z > max) max = s.z;
  }
  const span = max - min || 1;
  const lastTs = samples[samples.length - 1].ts || 1;
  const project = (s: MagSample, key: "x" | "y" | "z"): string => {
    const xPx = (s.ts / lastTs) * PLOT_WIDTH;
    const yPx = PLOT_HEIGHT - ((s[key] - min) / span) * PLOT_HEIGHT;
    return `${xPx.toFixed(1)},${yPx.toFixed(1)}`;
  };
  const pointsX = samples.map((s) => project(s, "x")).join(" ");
  const pointsY = samples.map((s) => project(s, "y")).join(" ");
  const pointsZ = samples.map((s) => project(s, "z")).join(" ");
  return (
    <svg
      width={PLOT_WIDTH}
      height={PLOT_HEIGHT}
      className="bg-bg-secondary rounded"
    >
      <polyline points={pointsX} fill="none" stroke="var(--color-status-error)" strokeWidth={1} />
      <polyline points={pointsY} fill="none" stroke="var(--color-status-success)" strokeWidth={1} />
      <polyline points={pointsZ} fill="none" stroke="var(--color-accent-primary)" strokeWidth={1} />
    </svg>
  );
}
