/**
 * @module SimBottomDock
 * @description Arranges the Simulate viewer's bottom overlays inside the map
 * column. A wide column (64rem and up, measured on the viewer's `@container`)
 * keeps the transport bar centred with the camera cluster at its right; a
 * narrower one stacks the cluster above a full-width bar. Neither covers the
 * other, and the bar never runs under the side panels.
 * @license GPL-3.0-only
 */

"use client";

import type { ReactNode } from "react";

interface SimBottomDockProps {
  /** The playback transport bar. */
  bar: ReactNode;
  /** The camera cluster; absent until the viewer is ready. */
  cluster?: ReactNode;
}

export function SimBottomDock({ bar, cluster }: SimBottomDockProps) {
  return (
    <div
      data-testid="sim-bottom-dock"
      className="pointer-events-none absolute inset-x-4 bottom-4 flex flex-col-reverse items-end gap-2 @5xl:grid @5xl:grid-cols-[1fr_auto_1fr] @5xl:items-end"
    >
      <div
        data-testid="sim-bottom-dock-bar"
        className="pointer-events-auto flex min-w-0 justify-center self-stretch @5xl:col-start-2 @5xl:row-start-1"
      >
        {bar}
      </div>
      {cluster && (
        <div
          data-testid="sim-bottom-dock-cluster"
          className="pointer-events-auto @5xl:col-start-3 @5xl:row-start-1 @5xl:justify-self-end"
        >
          {cluster}
        </div>
      )}
    </div>
  );
}
