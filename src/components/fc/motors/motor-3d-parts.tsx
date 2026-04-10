"use client";

import { useRef, useMemo, memo, Component, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import type { Group } from "three";
import type { MotorPosition } from "@/lib/motor-layouts";
import { useTelemetryStore } from "@/stores/telemetry-store";

// ── Brand colors ──────────────────────────────────────────────

export const COLOR_CW = "#3A82FF";
export const COLOR_CCW = "#DFF140";
const COLOR_UNKNOWN = "#444444";
export const COLOR_ARM = "#333333";
export const COLOR_BODY = "#2a2a2a";
export const COLOR_SERVO = "#f59e0b";
export const COLOR_GRID = "#0a0a0a";

export const SCALE = 2.5;

// ── Helpers ──────────────────────────────────────────────────

export function rotationColor(rotation: "CW" | "CCW" | "?"): string {
  if (rotation === "CW") return COLOR_CW;
  if (rotation === "CCW") return COLOR_CCW;
  return COLOR_UNKNOWN;
}

export function buildCoaxialOffsets(motors: MotorPosition[]): Map<number, number> {
  const offsets = new Map<number, number>();
  const seen = new Map<string, number>();

  for (const m of motors) {
    const key = `${m.roll}:${m.pitch}`;
    const prev = seen.get(key);
    if (prev !== undefined) {
      offsets.set(prev, 0);
      offsets.set(m.number, 0.25);
    } else {
      seen.set(key, m.number);
      offsets.set(m.number, 0);
    }
  }

  return offsets;
}

// ── Spinning propeller blades ────────────────────────────────

export const PropBlades = memo(function PropBlades({
  rotation,
  color,
  bladeCount = 2,
}: {
  rotation: "CW" | "CCW" | "?";
  color: string;
  bladeCount?: number;
}) {
  const groupRef = useRef<Group>(null);
  const speed = rotation === "CCW" ? -8 : 8;

  useFrame((_, delta) => {
    if (groupRef.current) {
      groupRef.current.rotation.y += speed * delta;
    }
  });

  const blades = useMemo(() => {
    const arr = [];
    for (let i = 0; i < bladeCount; i++) {
      const angle = (i / bladeCount) * Math.PI * 2;
      arr.push(angle);
    }
    return arr;
  }, [bladeCount]);

  return (
    <group ref={groupRef} position={[0, 0.12, 0]}>
      {blades.map((angle, i) => (
        <mesh
          key={i}
          rotation={[-Math.PI / 2, angle, 0]}
          position={[
            Math.sin(angle) * 0.01,
            0,
            Math.cos(angle) * 0.01,
          ]}
        >
          <planeGeometry args={[0.06, 0.32]} />
          <meshStandardMaterial
            color={color}
            transparent
            opacity={0.4}
            side={THREE.DoubleSide}
            metalness={0.3}
            roughness={0.6}
          />
        </mesh>
      ))}
    </group>
  );
});

// ── Bell motor shape ─────────────────────────────────────────

export const BellMotor = memo(function BellMotor({
  color,
  isUnknown,
}: {
  color: string;
  isUnknown: boolean;
}) {
  return (
    <group>
      <mesh position={[0, -0.02, 0]}>
        <cylinderGeometry args={[0.22, 0.24, 0.06, 24]} />
        <meshStandardMaterial
          color={color}
          metalness={0.7}
          roughness={0.3}
          transparent={isUnknown}
          opacity={isUnknown ? 0.4 : 1}
        />
      </mesh>
      <mesh position={[0, 0.04, 0]}>
        <cylinderGeometry args={[0.18, 0.22, 0.06, 24]} />
        <meshStandardMaterial
          color={color}
          metalness={0.8}
          roughness={0.2}
          transparent={isUnknown}
          opacity={isUnknown ? 0.4 : 1}
        />
      </mesh>
      <mesh position={[0, 0.08, 0]}>
        <cylinderGeometry args={[0.06, 0.06, 0.02, 12]} />
        <meshStandardMaterial
          color="#222"
          metalness={0.9}
          roughness={0.1}
        />
      </mesh>
    </group>
  );
});

// ── Single motor assembly ────────────────────────────────────

export const MotorAssembly = memo(function MotorAssembly({
  motor,
  yOffset,
  onHover,
  onUnhover,
  isHovered,
}: {
  motor: MotorPosition;
  yOffset: number;
  onHover: () => void;
  onUnhover: () => void;
  isHovered: boolean;
}) {
  const x = motor.roll * SCALE;
  const z = -motor.pitch * SCALE;
  const y = yOffset;
  const color = rotationColor(motor.rotation);
  const isUnknown = motor.rotation === "?";

  return (
    <group position={[x, y, z]}>
      <group
        onPointerEnter={(e) => { e.stopPropagation(); onHover(); }}
        onPointerLeave={(e) => { e.stopPropagation(); onUnhover(); }}
      >
        <BellMotor color={color} isUnknown={isUnknown} />
      </group>

      {!isUnknown && (
        <PropBlades rotation={motor.rotation} color={color} bladeCount={2} />
      )}

      <Html position={[0, 0.35, 0]} center distanceFactor={6} style={{ pointerEvents: "none" }}>
        <span className="text-[10px] font-mono text-white pointer-events-none select-none drop-shadow-md">
          {motor.number}
        </span>
      </Html>

      {isHovered && (
        <Html position={[0, 0.55, 0]} center distanceFactor={5} style={{ pointerEvents: "none" }}>
          <div className="bg-black/90 px-2 py-1 text-[11px] font-mono text-white whitespace-nowrap pointer-events-none select-none border border-white/10">
            Motor {motor.number} ({motor.rotation}) &middot; Test: {motor.testOrder}
          </div>
        </Html>
      )}
    </group>
  );
});

// ── Servo assembly ───────────────────────────────────────────

export const ServoAssembly = memo(function ServoAssembly({
  motor,
  yOffset,
}: {
  motor: MotorPosition;
  yOffset: number;
}) {
  const x = motor.roll * SCALE;
  const z = -motor.pitch * SCALE;
  const y = yOffset;

  return (
    <group position={[x, y, z]}>
      <mesh>
        <boxGeometry args={[0.28, 0.12, 0.18]} />
        <meshStandardMaterial color={COLOR_SERVO} metalness={0.5} roughness={0.5} wireframe={false} />
      </mesh>
      <mesh position={[0, 0.08, 0]}>
        <cylinderGeometry args={[0.02, 0.02, 0.06, 8]} />
        <meshStandardMaterial color="#fff" metalness={0.3} roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.11, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.08, 6]} />
        <meshStandardMaterial color="#ddd" metalness={0.2} roughness={0.5} side={THREE.DoubleSide} />
      </mesh>

      <Html position={[0, 0.3, 0]} center distanceFactor={6} style={{ pointerEvents: "none" }}>
        <span className="text-[10px] font-mono text-amber-400 pointer-events-none select-none drop-shadow-md">
          S{motor.number}
        </span>
      </Html>
    </group>
  );
});

// ── Arm from center to motor ─────────────────────────────────

export const Arm = memo(function Arm({
  motor,
  yOffset,
}: {
  motor: MotorPosition;
  yOffset: number;
}) {
  const x = motor.roll * SCALE;
  const z = -motor.pitch * SCALE;
  const y = yOffset;

  const length = Math.sqrt(x * x + z * z);
  if (length < 0.01) return null;

  const midX = x / 2;
  const midZ = z / 2;
  const angle = Math.atan2(x, z);

  return (
    <group position={[midX, y, midZ]} rotation={[0, angle, 0]}>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.025, 0.03, length, 8]} />
        <meshStandardMaterial color={COLOR_ARM} metalness={0.6} roughness={0.4} />
      </mesh>
    </group>
  );
});

// ── Forward chevron on body ──────────────────────────────────

export function ForwardChevron() {
  const shape = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(0, -0.35);
    s.lineTo(0.08, -0.22);
    s.lineTo(0, -0.26);
    s.lineTo(-0.08, -0.22);
    s.closePath();
    return s;
  }, []);

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.042, 0]}>
      <shapeGeometry args={[shape]} />
      <meshStandardMaterial color={COLOR_CW} metalness={0.5} roughness={0.4} side={THREE.DoubleSide} />
    </mesh>
  );
}

// ── Shadow disc ──────────────────────────────────────────────

export function ShadowDisc() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.15, 0]}>
      <circleGeometry args={[4, 48]} />
      <meshBasicMaterial color={COLOR_GRID} transparent opacity={0.6} />
    </mesh>
  );
}

// ── Attitude HUD overlay ─────────────────────────────────────

export function AttitudeHUD() {
  const attitude = useTelemetryStore((s) => s.attitude);
  const version = useTelemetryStore((s) => s._version);
  const latest = attitude.latest();
  void version;

  if (!latest) {
    return (
      <div className="absolute bottom-2 left-2 bg-black/70 border border-white/10 px-2 py-1.5 font-mono text-[10px] text-text-tertiary select-none pointer-events-none">
        NO TELEMETRY
      </div>
    );
  }

  return (
    <div className="absolute bottom-2 left-2 bg-black/70 border border-white/10 px-2 py-1.5 font-mono text-[10px] select-none pointer-events-none space-y-0.5">
      <div className="flex items-center gap-2">
        <span className="text-text-tertiary">R</span>
        <span className="text-accent-primary">{latest.roll.toFixed(1)}&deg;</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-text-tertiary">P</span>
        <span className="text-accent-primary">{latest.pitch.toFixed(1)}&deg;</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-text-tertiary">Y</span>
        <span className="text-accent-primary">{latest.yaw.toFixed(1)}&deg;</span>
      </div>
    </div>
  );
}

// ── WebGL error boundary ─────────────────────────────────────

interface ErrorBoundaryState {
  hasError: boolean;
}

export class WebGLErrorBoundary extends Component<
  { children: ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-[360px] flex items-center justify-center text-xs text-text-tertiary bg-bg-tertiary border border-border-default">
          <div className="text-center space-y-1">
            <p>3D rendering failed</p>
            <p className="text-[10px]">WebGL may not be supported in your browser</p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
