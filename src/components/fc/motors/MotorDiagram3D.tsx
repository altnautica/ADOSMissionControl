"use client";

import { useRef, useState, useMemo, useCallback } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Environment } from "@react-three/drei";
import * as THREE from "three";
import type { Group } from "three";
import type { FrameLayout } from "@/lib/motor-layouts";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { isFresh } from "@/lib/telemetry/freshness";
import {
  COLOR_CW, COLOR_BODY, SCALE,
  buildCoaxialOffsets,
  MotorAssembly, ServoAssembly, Arm, ForwardChevron, ShadowDisc,
  AttitudeHUD, WebGLErrorBoundary,
} from "./motor-3d-parts";
import { attitudeToSceneEuler } from "./motor-scene-frame";

// ── Scene contents ───────────────────────────────────────────

function DroneScene({ layout }: { layout: FrameLayout }) {
  const [hoveredMotor, setHoveredMotor] = useState<number | null>(null);
  const droneGroupRef = useRef<Group>(null);
  const [isGyroActive, setIsGyroActive] = useState(false);

  const coaxOffsets = useMemo(
    () => buildCoaxialOffsets(layout.motors),
    [layout.motors],
  );

  // The ring is read inside useFrame, so the scene does not re-render on
  // every telemetry push.
  const attitude = useTelemetryStore((s) => s.attitude);
  // Reused per frame so the render loop does not allocate.
  const targetEuler = useMemo(() => new THREE.Euler(), []);
  const targetQuat = useMemo(() => new THREE.Quaternion(), []);

  useFrame(() => {
    if (!droneGroupRef.current) return;
    const latest = attitude.latest();

    // Stale attitude after a link loss must not hold the model at its last pose.
    if (!latest || !isFresh(latest.timestamp, Date.now())) {
      if (isGyroActive) setIsGyroActive(false);
      return;
    }

    if (!isGyroActive) setIsGyroActive(true);

    attitudeToSceneEuler(latest.roll, latest.pitch, latest.yaw, targetEuler);
    targetQuat.setFromEuler(targetEuler);
    // Slerp takes the short way round, so a yaw wrap at ±180° does not spin the model.
    droneGroupRef.current.quaternion.slerp(targetQuat, 0.15);
  });

  const handleHover = useCallback((n: number) => setHoveredMotor(n), []);
  const handleUnhover = useCallback(() => setHoveredMotor(null), []);

  return (
    <>
      <ambientLight intensity={0.4} />
      <directionalLight position={[5, 8, 5]} intensity={0.7} />
      <directionalLight position={[-3, 4, -3]} intensity={0.25} />
      <pointLight position={[0, 3, 0]} intensity={0.15} color={COLOR_CW} />
      <Environment preset="night" background={false} />
      <ShadowDisc />

      <group ref={droneGroupRef}>
        <mesh position={[0, 0, 0]}>
          <cylinderGeometry args={[0.5, 0.48, 0.08, 32]} />
          <meshStandardMaterial color={COLOR_BODY} metalness={0.7} roughness={0.3} />
        </mesh>
        <mesh position={[0, 0.035, 0]}>
          <torusGeometry args={[0.46, 0.008, 8, 32]} />
          <meshStandardMaterial color="#3a3a3a" metalness={0.5} roughness={0.3} />
        </mesh>
        <ForwardChevron />

        {layout.motors.map((motor) => (
          <Arm key={`arm-${motor.number}`} motor={motor} yOffset={coaxOffsets.get(motor.number) ?? 0} />
        ))}

        {layout.motors.map((motor) => {
          const yOffset = coaxOffsets.get(motor.number) ?? 0;
          if (motor.isServo) {
            return <ServoAssembly key={`servo-${motor.number}`} motor={motor} yOffset={yOffset} />;
          }
          return (
            <MotorAssembly key={`motor-${motor.number}`} motor={motor} yOffset={yOffset}
              onHover={handleHover} onUnhover={handleUnhover}
              isHovered={hoveredMotor === motor.number} />
          );
        })}
      </group>

      <OrbitControls autoRotate={!isGyroActive} autoRotateSpeed={0.8} enableDamping dampingFactor={0.1} minDistance={3} maxDistance={12} />
    </>
  );
}

// ── Exported component ───────────────────────────────────────

export function MotorDiagram3D({ layout }: { layout: FrameLayout }) {
  return (
    <WebGLErrorBoundary>
      <div className="relative h-[360px] w-full min-h-[360px] max-h-[500px] bg-[#0a0a0a]">
        <Canvas camera={{ position: [4, 3.5, 4], fov: 45 }} gl={{ antialias: true }}
          onCreated={({ gl }) => { gl.setClearColor(0x0a0a0a, 1); }}>
          <DroneScene layout={layout} />
        </Canvas>
        <AttitudeHUD />
      </div>
    </WebGLErrorBoundary>
  );
}
