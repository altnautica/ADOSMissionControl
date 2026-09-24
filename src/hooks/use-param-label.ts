"use client";

import { useCallback } from "react";
import { useDroneManager, selectSelectedDrone } from "@/stores/drone-manager";

/**
 * Returns firmware-aware label helpers.
 *
 * - `label(raw)` — splits a `"PARAM — Description"` string, maps the param
 *   portion via the firmware handler, reassembles. Identity for ArduPilot.
 * - `paramName(canonical)` — maps a bare canonical param name to the
 *   firmware-native name. For standalone param name display (PID subtitles).
 *
 * Falls back to identity (ArduPilot canonical names) when no drone is
 * connected or no firmware handler is available.
 */
export function useParamLabel() {
  const handler = useDroneManager(selectSelectedDrone)?.protocol?.getFirmwareHandler() ?? null;

  const label = useCallback(
    (raw: string): string => {
      if (!handler) return raw;
      const sep = raw.indexOf(" \u2014 ");
      if (sep !== -1) {
        return handler.mapParameterName(raw.slice(0, sep)) + raw.slice(sep);
      }
      return handler.mapParameterName(raw);
    },
    [handler],
  );

  const paramName = useCallback(
    (canonical: string): string => {
      return handler?.mapParameterName(canonical) ?? canonical;
    },
    [handler],
  );

  return { label, paramName, firmwareType: handler?.firmwareType ?? null };
}
