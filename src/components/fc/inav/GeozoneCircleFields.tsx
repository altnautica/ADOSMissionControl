/**
 * @module GeozoneCircleFields
 * @description Centre and radius inputs for a circular iNav geozone. The FC
 * stores a circle as one centre vertex plus its radius, so these three values
 * are the whole geometry.
 * @license GPL-3.0-only
 */

"use client";

import { useGeozoneStore } from "@/stores/geozone-store";
import type { INavGeozoneVertex } from "@/lib/protocol/msp/msp-decoders-inav";

const INPUT_CLASS =
  "bg-bg-tertiary border border-border-default rounded px-2 py-1 text-xs font-mono text-text-primary focus:outline-none focus:border-accent-primary";

interface GeozoneCircleFieldsProps {
  zoneId: number;
  centre: INavGeozoneVertex | undefined;
}

export function GeozoneCircleFields({ zoneId, centre }: GeozoneCircleFieldsProps) {
  const setCircle = useGeozoneStore((s) => s.setCircle);
  const lat = centre?.lat ?? 0;
  const lon = centre?.lon ?? 0;
  const radiusCm = centre?.radius ?? 0;

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-text-tertiary font-mono">Centre lat</span>
          <input
            type="number"
            step="0.0000001"
            value={lat.toFixed(7)}
            onChange={(e) => setCircle(zoneId, parseFloat(e.target.value) || 0, lon, radiusCm)}
            className={INPUT_CLASS}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-text-tertiary font-mono">Centre lon</span>
          <input
            type="number"
            step="0.0000001"
            value={lon.toFixed(7)}
            onChange={(e) => setCircle(zoneId, lat, parseFloat(e.target.value) || 0, radiusCm)}
            className={INPUT_CLASS}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-text-tertiary font-mono">Radius (m)</span>
          <input
            type="number"
            step="1"
            min="0"
            value={radiusCm / 100}
            onChange={(e) =>
              setCircle(zoneId, lat, lon, Math.max(0, Math.round((parseFloat(e.target.value) || 0) * 100)))
            }
            className={INPUT_CLASS}
          />
        </label>
      </div>
      {radiusCm <= 0 && (
        <p className="text-[10px] font-mono text-status-warning">
          Circular zones need a centre and a radius before upload.
        </p>
      )}
    </div>
  );
}
