"use client";

/**
 * @module atlas/WorldModelViewport
 * @description Renders the selected World Model viewer for an artifact URL. Each
 * viewer is code-split + SSR-disabled via next/dynamic, so a heavy WASM/WebGL
 * bundle loads only when its viewer is selected with a real artifact. The chunk
 * shows the loading overlay while it downloads, and a chunk that fails to load
 * (a stale tab after a redeploy) shows the viewer's error overlay in place
 * instead of taking down the surrounding view. Returns null when there is no
 * artifact (the tab shows its empty state).
 * @license GPL-3.0-only
 */

import dynamic from "next/dynamic";
import type { AtlasViewer } from "./viewer-types";
import { ReconstructionBadge } from "./ReconstructionBadge";
import { SilentErrorBoundary } from "@/components/ui/SilentErrorBoundary";
import { ViewerError } from "./viewers/ViewerError";
import { ViewerLoading } from "./viewers/ViewerLoading";

/** The frame every viewer renders into, so the overlays have a box to fill. */
const VIEWER_FRAME = "relative w-full h-full min-h-[320px]";

function ChunkLoading() {
  return (
    <div className={VIEWER_FRAME}>
      <ViewerLoading />
    </div>
  );
}

const RerunViewer = dynamic(() => import("./viewers/RerunViewer"), {
  ssr: false,
  loading: ChunkLoading,
});
const SplatViewer = dynamic(() => import("./viewers/SplatViewer"), {
  ssr: false,
  loading: ChunkLoading,
});
const PointCloudViewer = dynamic(() => import("./viewers/PointCloudViewer"), {
  ssr: false,
  loading: ChunkLoading,
});
const PointCloudLodViewer = dynamic(
  () => import("./viewers/PointCloudLodViewer"),
  { ssr: false, loading: ChunkLoading },
);

/** The name each viewer's error overlay uses for what failed to load. */
const VIEWER_WHAT: Record<AtlasViewer, string> = {
  rerun: "Rerun",
  splat: "splat",
  cloud: "point cloud",
  lod: "point cloud",
};

export function WorldModelViewport({
  viewer,
  artifactUrl,
  backend = null,
}: {
  viewer: AtlasViewer;
  artifactUrl: string | null;
  /** The concrete reconstruction backend for the honesty badge: `"mock"`
   * badges a placeholder, a real backend name badges the reconstructor,
   * null/absent shows nothing. */
  backend?: string | null;
}) {
  if (!artifactUrl) return null;
  const view = (() => {
    switch (viewer) {
      case "rerun":
        return <RerunViewer url={artifactUrl} />;
      case "splat":
        return <SplatViewer url={artifactUrl} />;
      case "cloud":
        return <PointCloudViewer url={artifactUrl} />;
      case "lod":
        return <PointCloudLodViewer url={artifactUrl} />;
      default:
        return null;
    }
  })();
  if (!view) return null;
  return (
    <>
      <SilentErrorBoundary
        label="WorldModelViewport"
        resetKey={`${viewer}|${artifactUrl}`}
        fallback={
          <div className={VIEWER_FRAME}>
            <ViewerError what={VIEWER_WHAT[viewer]} />
          </div>
        }
      >
        {view}
      </SilentErrorBoundary>
      <ReconstructionBadge backend={backend} />
    </>
  );
}
