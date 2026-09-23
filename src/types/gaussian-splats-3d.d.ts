/**
 * Ambient types for `@mkkellogg/gaussian-splats-3d` (the package ships no
 * declarations). Only the surface the splat viewer uses is declared — the
 * self-driven `Viewer`, its construction options, and `addSplatScene`'s progress
 * callback. Kept minimal on purpose; extend when a new option is used.
 */
declare module "@mkkellogg/gaussian-splats-3d" {
  export interface ViewerOptions {
    /** Element the viewer builds its `<canvas>` into; sized to this element. */
    rootElement?: HTMLElement;
    /** Run the viewer's own render loop (default true); call `start()` to begin. */
    selfDrivenMode?: boolean;
    /** Attach built-in orbit controls (default true). */
    useBuiltInControls?: boolean;
    /** True renders at CSS resolution (DPR 1); false renders at the native
     * device pixel ratio (sharper on retina). */
    ignoreDevicePixelRatio?: boolean;
    /** GPU-accelerated depth sort of splats (default true). */
    gpuAcceleratedSort?: boolean;
    /** Use a `SharedArrayBuffer` for the sort worker — requires cross-origin
     * isolation (COOP/COEP). False works on any origin. */
    sharedMemoryForWorkers?: boolean;
    /** Whether splats can move after load (default false). */
    dynamicScene?: boolean;
    /** Spherical-harmonics degree to render: 0 = DC colour only, 1–2 add
     * view-dependent colour (needs the source to carry the coefficients). */
    sphericalHarmonicsDegree?: number;
    /** How a scene reveals after load (a `SceneRevealMode` value). `Instant`
     * skips the distance-based fade-in. */
    sceneRevealMode?: number;
  }

  export interface AddSplatSceneOptions {
    /** Explicit scene format (a `SceneFormat` value). Pass this when the URL does
     * not end in a recognized extension — e.g. a same-origin proxy URL whose
     * query string (`?path=…&key=…`) defeats the loader's `endsWith` sniffing. */
    format?: number;
    /** Scene orientation quaternion `[x, y, z, w]`. The library applies
     * `rotation || orientation` to the whole scene (positions + covariance); we
     * use it to correct the COLMAP Y-down world frame to the viewer's Y-up. */
    orientation?: readonly [number, number, number, number];
    /** Scene rotation quaternion `[x, y, z, w]` (same slot as `orientation`,
     * takes precedence when both are set). */
    rotation?: readonly [number, number, number, number];
    /** Scene translation `[x, y, z]`. */
    position?: readonly [number, number, number];
    /** Scene scale `[x, y, z]`. */
    scale?: readonly [number, number, number];
    /** Let the viewer draw its own loading spinner (pass false to own it). */
    showLoadingUI?: boolean;
    /** Stream a coarse preview then refine — supported by the `.ksplat` format. */
    progressiveLoad?: boolean;
    /** Drop splats below this 0–255 alpha at load. */
    splatAlphaRemovalThreshold?: number;
    /** Progress callback: `percent` 0–100, a display label, and the loader
     * phase (an internal `LoaderStatus` enum value; treated as opaque). */
    onProgress?: (percent: number, label: string, status: number) => void;
  }

  /** Scene file formats (the loader's own numeric enum). */
  export const SceneFormat: {
    readonly Splat: 0;
    readonly KSplat: 1;
    readonly Ply: 2;
    readonly Spz: 3;
  };

  /** How a newly-added scene becomes visible. `Instant` skips the fade. */
  export const SceneRevealMode: {
    readonly Default: 0;
    readonly Gradual: 1;
    readonly Instant: 2;
  };

  /** The loaded splat geometry — enough of it to sample centers for framing. */
  export interface SplatMesh {
    getSplatCount(): number;
    /** Write splat `i`'s world-space centre into `outCenter` (a THREE.Vector3);
     * `applySceneTransform` places it in the scene's frame. */
    getSplatCenter(
      i: number,
      outCenter: unknown,
      applySceneTransform?: boolean,
    ): void;
  }

  /** The scene camera — a three PerspectiveCamera (position / fov / near / far
   * / updateProjectionMatrix, all used to frame the loaded scene). */
  type ViewerCamera = import("three").PerspectiveCamera;

  /** The built-in orbit controls — re-targetable after framing. */
  interface ViewerControls {
    target: import("three").Vector3;
    update(): void;
  }

  export class Viewer {
    constructor(options?: ViewerOptions);
    /** The scene camera (populated once constructed). */
    readonly camera: ViewerCamera;
    /** The built-in orbit controls, or null before they are set up. */
    readonly controls: ViewerControls | null;
    /** Load a `.ply` / `.splat` / `.ksplat` / `.spz` scene from a URL. */
    addSplatScene(url: string, options?: AddSplatSceneOptions): Promise<void>;
    /** The loaded splat mesh, or null before a scene is added. */
    getSplatMesh(): SplatMesh | null;
    /** Begin the self-driven render loop (call after `addSplatScene` resolves). */
    start(): void;
    /** Release the WebGL context, sort worker, and GPU buffers. */
    dispose(): Promise<void>;
  }
}
