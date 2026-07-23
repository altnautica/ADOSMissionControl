"use client";

/**
 * The shared, profile-adaptive node hero — the first band of every profile's
 * Overview tab. Generalizes the workstation-only WorkstationBrandHeader: an
 * icon tile + a 3px identity accent rule + the node title + a type badge + a
 * live status line with a leading StatusDot. Theme-safe in light and dark.
 *
 * @module NodeBrandHeader
 * @license GPL-3.0-only
 */

import { Badge } from "@/components/ui/badge";
import { StatusDot } from "@/components/ui/status-dot";
import { NodeGlyph } from "@/components/command/nodes/node-glyph";
import { profileTint } from "@/lib/nodes/node-profile";
import {
  useNodeBrand,
  type EffProfile,
} from "@/components/dashboard/node-detail/node-brand";

export function NodeBrandHeader({
  profile,
  title,
  reachedViaName,
}: {
  profile: EffProfile;
  title: string;
  /** Display name of the ground node this drone is reached through over WFB,
   * when it is enrolled transitively. Surfaces the "via <node>" sub-badge. */
  reachedViaName?: string | null;
}) {
  const b = useNodeBrand({ profile, title, reachedViaName });
  return (
    <div
      className="relative flex items-center gap-3 overflow-hidden rounded-xl border border-border-default bg-bg-secondary p-4"
      style={{ borderLeftWidth: 3, borderLeftColor: `var(${b.accentVar})` }}
    >
      <div
        className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg border"
        style={profileTint(profile)}
      >
        <NodeGlyph profile={profile} size={22} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h2 className="truncate text-base font-semibold text-text-primary">
            {b.title}
          </h2>
          <Badge variant="neutral" className="flex-shrink-0">
            {b.typeBadge}
          </Badge>
          {b.subBadge && (
            <Badge variant="info" className="flex-shrink-0">
              {b.subBadge}
            </Badge>
          )}
        </div>
        <div className="mt-1 flex items-center gap-1.5 text-[11px] text-text-secondary">
          <StatusDot status={b.statusLevel} size="xs" />
          <span className="truncate">{b.statusLine}</span>
        </div>
      </div>
    </div>
  );
}
