"use client";

/**
 * @module drone-detail/map/LiveSweep3D
 * @description The Map tab's 3D view: Navigation's live sweep cloud
 * ({@link useLiveSweep}) as one point buffer coloured by height, with the
 * Reconstruct compute node's cloud (streamed placement, held since this
 * browser connected) drawn over it, and the drone's pose as an arrow, under
 * orbit controls. The wire is `map_ned` (x north, y east, z down); the scene
 * is y-up, so a point lands at (east, up, south). Loaded on demand by the Map
 * tab, off the panel's chunk.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useMemo } from "react";
import { useTranslations } from "next-intl";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";

import type { NavPose } from "@/lib/hud/nav-types";
import { useLiveSweep } from "@/hooks/use-live-sweep";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import { useReconstructStreamStore } from "@/stores/reconstruct-stream-store";

/** Height colour ramp ends, metres above the map origin. */
const RAMP_LOW_M = 0;
const RAMP_HIGH_M = 3;
const LOW = new THREE.Color("#2563eb");
const HIGH = new THREE.Color("#f59e0b");

interface LiveSweep3DProps {
  droneId: string;
  /** The fresh pose, or null without one. */
  pose: NavPose | null;
}

/** Scene positions and height colours for the first `count` NED triples. */
function sceneBuffers(ned: Float32Array, count: number): { positions: Float32Array; colors: Float32Array } {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const n = ned[i * 3];
    const e = ned[i * 3 + 1];
    const up = -ned[i * 3 + 2];
    positions[i * 3] = e;
    positions[i * 3 + 1] = up;
    positions[i * 3 + 2] = -n;
    const share = Math.min(1, Math.max(0, (up - RAMP_LOW_M) / (RAMP_HIGH_M - RAMP_LOW_M)));
    c.copy(LOW).lerp(HIGH, share);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  return { positions, colors };
}

function SweepPoints({ ned, count, version, voxelM }: { ned: Float32Array; count: number; version: number; voxelM: number }) {
  const geometry = useMemo(() => new THREE.BufferGeometry(), []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => {
    const { positions, colors } = sceneBuffers(ned, count);
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.computeBoundingSphere();
    // `version` changes whenever the held cloud does; `ned` may be the same
    // buffer written in place.
  }, [geometry, ned, count, version]);
  return (
    <points geometry={geometry}>
      <pointsMaterial size={Math.max(0.03, voxelM)} sizeAttenuation vertexColors />
    </points>
  );
}

/** The drone's pose: an arrow along its body x axis (forward). */
function PoseArrow({ pose }: { pose: NavPose }) {
  const arrow = useMemo(() => {
    const [n, e, d] = pose.t;
    // Body forward in the map frame is the first column of R (row-major).
    const fwd = new THREE.Vector3(pose.R[3], -pose.R[6], -pose.R[0]);
    const dir = fwd.lengthSq() > 0 ? fwd.normalize() : new THREE.Vector3(0, 0, -1);
    return new THREE.ArrowHelper(dir, new THREE.Vector3(e, -d, -n), 0.6, 0xffffff, 0.25, 0.18);
  }, [pose]);
  useEffect(() => () => arrow.dispose(), [arrow]);
  return <primitive object={arrow} />;
}

export function LiveSweep3D({ droneId, pose }: LiveSweep3DProps) {
  const t = useTranslations("hud.mapTab");
  const reducedMotion = usePrefersReducedMotion();
  const { cloud, version, state } = useLiveSweep(droneId, true);
  const node = useReconstructStreamStore((s) => s.byDrone[droneId]);
  const nodePoints = node && node.cloud.count > 0 ? node : null;

  if (state === "unavailable" && !nodePoints) {
    return <p className="p-4 text-xs text-text-secondary">{t("sweepUnavailable")}</p>;
  }
  return (
    <div className="absolute inset-0" data-testid="live-sweep-3d">
      <Canvas camera={{ position: [6, 8, 10], fov: 50 }}>
        <SweepPoints ned={cloud.positions} count={cloud.count} version={version} voxelM={cloud.voxelM ?? 0.1} />
        {nodePoints && (
          <SweepPoints
            ned={nodePoints.cloud.positions}
            count={nodePoints.cloud.count}
            version={nodePoints.version}
            voxelM={nodePoints.cloud.voxelM ?? 0.05}
          />
        )}
        {pose && <PoseArrow pose={pose} />}
        <gridHelper args={[40, 40, "#444444", "#2a2a2a"]} />
        <OrbitControls enableDamping={!reducedMotion} makeDefault />
      </Canvas>
      {cloud.count === 0 && !nodePoints && (
        <p className="pointer-events-none absolute left-3 top-3 text-xs text-text-secondary">{t("sweepEmpty")}</p>
      )}
    </div>
  );
}
