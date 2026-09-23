"use client";

/**
 * @module atlas/viewers/PointCloudViewer
 * @description Renders a dense point cloud (`.ply`) with three.js — the repo's
 * own `three` 0.183, NOT `@pnext/three-loader`, whose Potree build pins an older
 * three and so cannot be added. The renderer + the PLY load run in an in-effect
 * dynamic import (never in the static graph / SSR / a test render). On unmount or
 * a url change the rAF loop, the orbit controls, the geometry + material, AND the
 * renderer are disposed. Leak-safety comes from two things: the &lt;canvas&gt; is
 * bound to a stable ref so a url-swap re-runs the effect on the SAME WebGL2
 * context (no per-swap context leak), and the explicit geometry/material/renderer
 * dispose() frees the GPU buffers + compiled programs (a missing teardown leaks
 * those per swap). A failed chunk/artifact load surfaces an error overlay rather
 * than a silent blank viewport (no fabricated reading).
 *
 * Vertex colours are honoured when the cloud carries them; otherwise the points
 * render in a flat accent so a colourless cloud is still legible. This is a
 * single-mesh viewer — dense LOD/octree streaming for very large clouds is a
 * follow-on (it is what Potree did, and is why its loader is worth revisiting if
 * a three-0.183-compatible build appears).
 * @license GPL-3.0-only
 */

import { useEffect, useRef, useState } from "react";
import type { BufferGeometry, Material, WebGLRenderer } from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { ViewerError } from "./ViewerError";
import { ViewerLoading } from "./ViewerLoading";
import { orientCloudToYUp } from "./coordinate-frame";
import { followCanvasSize, frameCloud } from "./cloud-view";
import {
  fetchArrayBufferWithProgress,
  type FetchProgress,
} from "@/lib/net/fetch-with-progress";

export default function PointCloudViewer({ url }: { url: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState<FetchProgress | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setFailed(false);
    setLoading(true);
    setProgress(null);
    const abort = new AbortController();
    let raf = 0;
    let disposed = false;
    // Hoisted so the cleanup can release the WebGL context + GPU buffers.
    let renderer: WebGLRenderer | null = null;
    let controls: OrbitControls | null = null;
    let geometry: BufferGeometry | null = null;
    let material: Material | null = null;
    let stopResize: (() => void) | null = null;

    void (async () => {
      try {
        const THREE = await import("three");
        const { PLYLoader } = await import(
          "three/examples/jsm/loaders/PLYLoader.js"
        );
        const { OrbitControls: Orbit } = await import(
          "three/examples/jsm/controls/OrbitControls.js"
        );
        if (disposed || !canvasRef.current) return;

        const width = canvas.clientWidth || 640;
        const height = canvas.clientHeight || 360;
        const r = new THREE.WebGLRenderer({ canvas, antialias: false });
        r.setSize(width, height, false);
        renderer = r;

        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x0a0a0a);
        const camera = new THREE.PerspectiveCamera(60, width / height, 0.01, 1000);
        stopResize = followCanvasSize(canvas, r, camera);
        const ctrl = new Orbit(camera, canvas);
        controls = ctrl;

        const buffer = await fetchArrayBufferWithProgress(url, {
          signal: abort.signal,
          onProgress: (p) => {
            if (!disposed) setProgress(p);
          },
        });
        if (disposed) return;
        const geom = new PLYLoader().parse(buffer);
        // COLMAP Y-down world frame → viewer Y-up (before the framing sphere).
        orientCloudToYUp(geom);
        geom.computeBoundingSphere();
        geometry = geom;

        const hasColor = geom.hasAttribute("color");
        const mat = new THREE.PointsMaterial({
          size: 0.012,
          sizeAttenuation: true,
          vertexColors: hasColor,
          color: hasColor ? 0xffffff : 0x88ccff,
        });
        material = mat;
        scene.add(new THREE.Points(geom, mat));

        // Frame the cloud from its bounding sphere so it fills the view, with
        // clip planes fitted to its size.
        const bs = geom.boundingSphere;
        if (bs) {
          const fit = frameCloud(bs.radius);
          camera.near = fit.near;
          camera.far = fit.far;
          camera.updateProjectionMatrix();
          ctrl.maxDistance = fit.maxDistance;
          camera.position.set(bs.center.x, bs.center.y, bs.center.z + fit.distance);
          ctrl.target.copy(bs.center);
        }
        ctrl.update();
        setLoading(false);

        const frame = () => {
          ctrl.update();
          r.render(scene, camera);
          raf = requestAnimationFrame(frame);
        };
        raf = requestAnimationFrame(frame);
      } catch {
        if (!disposed) {
          setLoading(false);
          setFailed(true);
        }
      }
    })();

    return () => {
      disposed = true;
      abort.abort();
      cancelAnimationFrame(raf);
      stopResize?.();
      controls?.dispose();
      geometry?.dispose();
      material?.dispose();
      renderer?.dispose();
    };
  }, [url]);

  return (
    <div className="relative w-full h-full min-h-[320px]">
      <canvas ref={canvasRef} className="w-full h-full" />
      {loading && !failed && (
        <ViewerLoading
          percent={progress?.percent ?? undefined}
          receivedBytes={progress?.receivedBytes}
          totalBytes={progress?.totalBytes ?? undefined}
          label="Downloading cloud"
        />
      )}
      {failed && <ViewerError what="point cloud" />}
    </div>
  );
}
