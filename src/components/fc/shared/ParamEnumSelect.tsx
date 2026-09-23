"use client";

/**
 * @module fc/shared/ParamEnumSelect
 * @description Labelled enum field for an FC param plus the hook that resolves
 * its options. Options come from the connected firmware's param metadata
 * (per vehicle), falling back to the verbatim `@Values` tables in
 * `param-enum-fallbacks` while metadata is absent. A value outside the table is
 * shown as its raw number rather than a blank select.
 * @license GPL-3.0-only
 */

import { useCallback, type ReactNode } from "react";
import { useParamLabel } from "@/hooks/use-param-label";
import type { ParamMetadata } from "@/lib/protocol/param-metadata";
import { EnumSelect } from "../parameters/EnumSelect";
import { resolveParamBitmask, resolveParamEnum } from "./param-enum-fallbacks";

export interface ParamEnums {
  /** Enum options for a canonical (panel-side) param name. */
  enumValues: (canonical: string) => ReadonlyMap<number, string>;
  /** Bitmask bit labels for a canonical (panel-side) param name. */
  bitmaskBits: (canonical: string) => ReadonlyMap<number, string>;
}

/**
 * Resolve enum/bitmask options for the selected vehicle. `metadata` is the map
 * the panel already holds from `useParamMetadataMap`; canonical names are
 * mapped to the firmware-native name (e.g. PX4 `COM_LOW_BAT_ACT`) first.
 */
export function useParamEnums(metadata: Map<string, ParamMetadata>): ParamEnums {
  const { paramName, firmwareType } = useParamLabel();
  const enumValues = useCallback(
    (canonical: string) => resolveParamEnum(paramName(canonical), metadata, firmwareType),
    [paramName, metadata, firmwareType],
  );
  const bitmaskBits = useCallback(
    (canonical: string) => resolveParamBitmask(paramName(canonical), metadata, firmwareType),
    [paramName, metadata, firmwareType],
  );
  return { enumValues, bitmaskBits };
}

export function ParamEnumSelect({
  label, values, value, onChange, className, disabled,
}: {
  label?: ReactNode;
  values: ReadonlyMap<number, string>;
  value: number;
  onChange: (next: number) => void;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      {label && <div className="text-xs text-text-secondary">{label}</div>}
      <EnumSelect values={values} value={value} onChange={onChange} className={className} disabled={disabled} />
    </div>
  );
}
