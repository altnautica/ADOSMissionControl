"use client";

/**
 * @module GpsFixSnapshotCard
 * @description GPS fix snapshot UI. Subscribes to `gnss.Fix2` broadcasts
 * from the selected node for 5 s and renders the latest reading: fix
 * status, satellites used, an HDOP approximation derived from PDOP
 * (`pdop / sqrt(2)` while the full DOP block is not yet decoded), lat /
 * lon in decimal degrees from `int37 * 1e-8`, and altitude MSL.
 *
 * @license GPL-3.0-only
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { GnssFix2 } from "@/lib/dronecan/dsdl/gnss-fix2";
import {
  STATUS_2D_FIX,
  STATUS_3D_FIX,
  STATUS_NO_FIX,
  STATUS_TIME_ONLY,
} from "@/lib/dronecan/dsdl/gnss-fix2";

const CAPTURE_WINDOW_MS = 5000;
const ONE_E8 = 1e8;

export interface GpsFixSnapshotClient {
  subscribeFix2(
    nodeId: number,
    cb: (fix: GnssFix2) => void,
  ): () => void;
}

export interface GpsFixSnapshotCardProps {
  client?: GpsFixSnapshotClient | null;
}

export function GpsFixSnapshotCard({ client }: GpsFixSnapshotCardProps = {}) {
  const t = useTranslations("canConfig.testUtilities.gpsFix");

  const [nodeIdRaw, setNodeIdRaw] = useState("");
  const [capturing, setCapturing] = useState(false);
  const [fix, setFix] = useState<GnssFix2 | null>(null);
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

  const parsedNodeId = (() => {
    const n = Number.parseInt(nodeIdRaw, 10);
    return Number.isFinite(n) && n >= 1 && n <= 127 ? n : null;
  })();

  const handleCapture = useCallback(() => {
    if (!client || parsedNodeId == null) return;
    cleanup();
    setError(null);
    setCapturing(true);
    setFix(null);
    try {
      unsubRef.current = client.subscribeFix2(parsedNodeId, (next) => {
        setFix(next);
      });
      timerRef.current = setTimeout(() => {
        cleanup();
        setCapturing(false);
      }, CAPTURE_WINDOW_MS);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setCapturing(false);
    }
  }, [client, parsedNodeId, cleanup]);

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
        <Button
          variant="secondary"
          size="sm"
          icon={<MapPin size={12} />}
          onClick={handleCapture}
          disabled={!client || parsedNodeId == null || capturing}
          loading={capturing}
        >
          {t("button")}
        </Button>
      </div>
      <div className="mt-2 text-[11px] font-mono">
        {error ? (
          <span className="text-status-error" data-testid="gps-fix-error">
            {error}
          </span>
        ) : fix ? (
          <FixDisplay fix={fix} />
        ) : (
          <span className="text-text-tertiary">{t("noFix")}</span>
        )}
      </div>
    </Card>
  );
}

function FixDisplay({ fix }: { fix: GnssFix2 }) {
  const t = useTranslations("canConfig.testUtilities.gpsFix");
  const status = fix.status;
  const statusLabel =
    status === STATUS_3D_FIX
      ? t("fix3D")
      : status === STATUS_2D_FIX
        ? t("fix2D")
        : status === STATUS_TIME_ONLY
          ? t("timeOnly")
          : status === STATUS_NO_FIX
            ? t("noFix")
            : t("noFix");
  const hasPosition = status === STATUS_3D_FIX || status === STATUS_2D_FIX;
  const lat = Number(fix.latitudeDeg1e8) / ONE_E8;
  const lon = Number(fix.longitudeDeg1e8) / ONE_E8;
  const altMsl = fix.heightMslMm / 1000;
  // Fix2 reports PDOP; it is shown as measured, "—" when the receiver sent 0.
  const pdop = fix.pdop > 0 ? fix.pdop.toFixed(2) : "—";
  const tone =
    status === STATUS_3D_FIX
      ? "text-status-success"
      : status === STATUS_2D_FIX
        ? "text-status-warning"
        : "text-status-error";
  return (
    <span className={tone} data-testid="gps-fix-result">
      {statusLabel}
      <span className="text-text-tertiary ml-2">
        {t("sats")}: {fix.satsUsed} · {t("pdop")}: {pdop} ·{" "}
        {hasPosition
          ? `${lat.toFixed(7)}, ${lon.toFixed(7)} · ${altMsl.toFixed(2)} m`
          : "—"}
      </span>
    </span>
  );
}
