/**
 * @module CapabilityChips
 * @description Renders the hardware-capability chips a plugin needs
 * (Camera / NPU / IMU / Thermal / LIDAR) as compact icon chips. The
 * chip set is derived once by {@link permissionsToChips}; the glyph for each
 * chip resolves through the shared named-icon registry so the same concept
 * reads with the same glyph everywhere. Renders nothing when a plugin needs
 * no recognized hardware.
 *
 * @license GPL-3.0-only
 */

"use client";

import { cn } from "@/lib/utils";
import { resolveNamedIcon } from "@/lib/icons/icon-registry";
import {
  permissionsToChips,
  type ChipDerivationContext,
} from "@/lib/plugins/capability-chips";

export interface CapabilityChipsProps extends ChipDerivationContext {
  /** The plugin's declared permissions (only the `id` is read). */
  permissions: ReadonlyArray<{ id: string }>;
  /** When set, renders an uppercase section label above the chips. The whole
   * section (label included) is suppressed when there are no chips. */
  title?: string;
  className?: string;
}

export function CapabilityChips({
  permissions,
  vendorAttribution,
  hardwareRequirements,
  telemetryFields,
  title,
  className,
}: CapabilityChipsProps) {
  const chips = permissionsToChips(
    permissions.map((p) => p.id),
    { vendorAttribution, hardwareRequirements, telemetryFields },
  );
  if (chips.length === 0) return null;
  const row = (
    <div className={cn("flex flex-wrap gap-1.5", title ? undefined : className)}>
      {chips.map((chip) => {
        const Icon = resolveNamedIcon(chip.id);
        return (
          <span
            key={chip.id}
            className="inline-flex items-center gap-1.5 rounded-md border border-border-default/50 bg-bg-tertiary/40 px-2 py-1 text-xs font-medium text-text-secondary"
          >
            <Icon className="h-3.5 w-3.5 text-text-tertiary" aria-hidden />
            {chip.label}
          </span>
        );
      })}
    </div>
  );
  if (!title) return row;
  return (
    <section className={className}>
      <h3 className="mb-3 text-[11px] font-medium uppercase tracking-[0.14em] text-text-tertiary">
        {title}
      </h3>
      {row}
    </section>
  );
}
