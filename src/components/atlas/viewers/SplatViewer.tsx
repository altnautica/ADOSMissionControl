"use client";

/**
 * @module atlas/viewers/SplatViewer
 * @description Plays a photoreal gaussian splat (`.ply` / `.splat` / `.ksplat`)
 * with the gaussian-splats-3d viewer — a purpose-built splat renderer
 * with a GPU-accelerated worker depth-sort, spherical-harmonics colour, and
 * native device-pixel-ratio.
 *
 * Three things this viewer must do that the library does not do for us:
 *  1. **Pass an explicit format.** The artifact is reached through the
 *     same-origin proxy `/api/lan-pair/artifact?host=…&path=…`, so the URL ends
 *     in the key, not a file extension — the loader's `endsWith('.ply')` sniffing
 *     fails and `addSplatScene` throws "file format not supported". We derive the
 *     real format from the proxy `path` param (see `splat-format`).
 *  2. **Correct the world frame.** Reconstructions are in the COLMAP Y-down
 *     frame; the viewer is Y-up, so a raw scene loads upside-down. We pass an
 *     `orientation` quaternion (180° about X) — see `coordinate-frame`.
 *  3. **Frame the camera.** The library does not auto-frame; a reconstruction lives
 *     in its own world coordinates, so we sample the loaded splat centres for a
 *     bounding box and point the camera at it (else it can render off-screen).
 *
 * Client-only WebGL: the viewer + scene load run in an in-effect dynamic import
 * (never in the static graph / SSR / a test render). `dispose()` releases the
 * WebGL context, sort worker, and GPU buffers. It is async, so the effect
 * serializes construct-after-dispose across runs — otherwise React StrictMode's
 * mount→unmount→mount races two viewers on the same host (the jitter). A failed
 * load surfaces an error overlay and tears its viewer down (no fabricated reading).
 * @license GPL-3.0-only
 */

import { useEffect, useRef, useState } from "react";
import type { Viewer } from "@mkkellogg/gaussian-splats-3d";
import { ViewerError } from "./ViewerError";
import { ViewerLoading } from "./ViewerLoading";
import { splatArtifactExt } from "./splat-format";
import { COLMAP_TO_YUP_QUAT } from "./coordinate-frame";

/** Frame the camera on the loaded splats. The library's default camera is a fixed
 * [0,10,15] → [0,0,0]; an arbitrary reconstruction is elsewhere in world space,
 * so we sample splat centres for a bounding box and look at its centre from
 * ~1.6× the scene radius. */
function frameCameraToSplats(
  viewer: Viewer,
  THREE: typeof import("three"),
): void {
  const mesh = viewer.getSplatMesh();
  const count = mesh ? mesh.getSplatCount() : 0;
  if (!mesh || count <= 0) return;
  const box = new THREE.Box3();
  const pt = new THREE.Vector3();
  // Sampling ~3k centres is plenty for a framing sphere and stays instant on a
  // multi-hundred-thousand-splat scene.
  const step = Math.max(1, Math.floor(count / 3000));
  for (let i = 0; i < count; i += step) {
    mesh.getSplatCenter(i, pt, true);
    box.expandByPoint(pt);
  }
  if (box.isEmpty()) return;
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const center = sphere.center;
  const radius = Math.max(sphere.radius, 0.001);
  // Distance so the whole scene fits the vertical FOV (with margin). A fixed
  // multiple of the radius (e.g. 1.6×) lands INSIDE the cloud and reads as a
  // smear; `radius / tan(fov/2)` frames the whole sphere.
  const fov = ((viewer.camera.fov ?? 50) * Math.PI) / 180;
  const dist = (radius / Math.tan(fov / 2)) * 1.25;
  // Fit the clip planes to the scene (the library's fixed far=1000 would clip a
  // large drone-scale reconstruction).
  viewer.camera.near = Math.max(dist / 1000, 0.01);
  viewer.camera.far = dist * 20;
  viewer.camera.updateProjectionMatrix();
  const dir = new THREE.Vector3(0.5, 0.45, 1).normalize();
  viewer.camera.position.copy(center).addScaledVector(dir, dist);
  if (viewer.controls) {
    viewer.controls.target.copy(center);
    viewer.controls.update();
  }
  viewer.camera.lookAt(center);
}

export default function SplatViewer({ url }: { url: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  // A promise chain that serializes construct-after-dispose across effect runs
  // (see the effect body).
  const lifecycle = useRef<Promise<void>>(Promise.resolve());
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const [percent, setPercent] = useState<number | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    setFailed(false);
    setReady(false);
    setPercent(null);
    let disposed = false;
    let viewer: Viewer | null = null;

    // The library's dispose() is async. Under StrictMode the effect runs
    // mount→unmount→mount, and a naive teardown would race the remount's
    // construct on the same host. Chain each run after the previous dispose so
    // only one viewer ever touches the host at a time.
    const run = lifecycle.current.then(async () => {
      if (disposed || !hostRef.current) return;
      try {
        const [GS3D, THREE] = await Promise.all([
          import("@mkkellogg/gaussian-splats-3d"),
          import("three"),
        ]);
        if (disposed || !hostRef.current) return;
        host.replaceChildren();

        const ext = splatArtifactExt(url);
        const format =
          ext === "splat"
            ? GS3D.SceneFormat.Splat
            : ext === "ksplat"
              ? GS3D.SceneFormat.KSplat
              : ext === "spz"
                ? GS3D.SceneFormat.Spz
                : GS3D.SceneFormat.Ply;

        const v = new GS3D.Viewer({
          rootElement: host,
          selfDrivenMode: true,
          useBuiltInControls: true,
          // Native device pixel ratio (sharp on retina).
          ignoreDevicePixelRatio: false,
          // CPU/worker sort (library default). The GPU transform-feedback sort
          // is the flakiest path on ANGLE/Metal; the worker sort is robust.
          gpuAcceleratedSort: false,
          // Plain (non-shared) worker memory: no COOP/COEP requirement.
          sharedMemoryForWorkers: false,
          dynamicScene: false,
          // View-dependent colour; a Brush `.ply` carries the coefficients.
          sphericalHarmonicsDegree: 1,
          // Show the scene immediately instead of a distance-based fade-in.
          sceneRevealMode: GS3D.SceneRevealMode.Instant,
        });
        viewer = v;
        await v.addSplatScene(url, {
          format,
          // Correct the COLMAP Y-down world frame to the viewer's Y-up (180°
          // about X) so the reconstruction isn't upside-down. See coordinate-frame.
          orientation: COLMAP_TO_YUP_QUAT,
          progressiveLoad: ext === "ksplat",
          showLoadingUI: false,
          splatAlphaRemovalThreshold: 5,
          onProgress: (p) => {
            if (!disposed) setPercent(Math.max(0, Math.min(100, p)));
          },
        });
        if (disposed) return;
        frameCameraToSplats(v, THREE);
        v.start();
        setReady(true);
      } catch {
        // After cleanup the rejection is the abort that dispose() caused, and
        // cleanup already owns the teardown.
        if (disposed) return;
        setFailed(true);
        // Tear down a partially-constructed viewer so a failed load never leaves
        // a half-alive viewer (canvas / sort worker) behind.
        try {
          await viewer?.dispose();
        } catch {
          /* already gone */
        }
        viewer = null;
      }
    });
    lifecycle.current = run;

    return () => {
      disposed = true;
      // dispose() is the only thing that aborts the library's in-flight download,
      // so call it now rather than after the load finishes; a newer url or an
      // unmount must not wait for (or compete with) the old download. The next
      // effect's construct is chained on both settling.
      let disposing: Promise<void> | undefined;
      try {
        disposing = viewer?.dispose();
      } catch {
        /* already gone */
      }
      lifecycle.current = Promise.allSettled([run, disposing]).then(() => undefined);
    };
  }, [url]);

  return (
    <div className="relative w-full h-full min-h-[320px]">
      {/* `absolute inset-0` gives the host a concrete pixel box floored by the
          wrapper's min-height. A percentage height (`h-full`) collapses to 0 in
          a flex/min-h ancestor chain, and the library reads `offsetHeight`
          verbatim as the canvas height — a 0-height canvas renders black. */}
      <div ref={hostRef} className="absolute inset-0" />
      {!ready && !failed && (
        <ViewerLoading percent={percent ?? undefined} label="Loading splat" />
      )}
      {failed && <ViewerError what="splat" />}
    </div>
  );
}
