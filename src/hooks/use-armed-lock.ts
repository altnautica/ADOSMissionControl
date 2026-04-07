import { useDroneStore } from "@/stores/drone-store";

interface ArmedLockResult {
  /** Whether the vehicle is currently armed. */
  isArmed: boolean;
  /**
   * Soft gate. Always false now — kept for backward compatibility with
   * existing `disabled={isLocked}` call sites that should *not* hard-block.
   * Those sites silently unblock and the new banner + save-time confirm
   * dialog takes over the safety role. For true hard-blocks (motor test,
   * servo test, frame-class change, calibration trigger) use `isHardBlocked`.
   *
   * @deprecated Use `isArmed` for awareness or `isHardBlocked` for blocking.
   */
  isLocked: boolean;
  /**
   * Hard gate. True only when armed + connected. Use this to disable the
   * narrow set of controls that are genuinely unsafe in flight: motor test,
   * servo test, ESC calibration, sensor calibration triggers, frame class
   * changes. Everything else is writable with a confirmation dialog.
   */
  isHardBlocked: boolean;
  /** Message for banners / tooltips when the vehicle is armed. */
  lockMessage: string;
  /** Dedicated message for hard-blocked controls. */
  hardBlockMessage: string;
}

const SOFT_MESSAGE =
  "Vehicle is armed. Parameter changes will write live — review before saving.";
const HARD_MESSAGE =
  "This control is disabled while the vehicle is armed for safety. Disarm to use.";

export function useArmedLock(): ArmedLockResult {
  const armState = useDroneStore((s) => s.armState);
  const connectionState = useDroneStore((s) => s.connectionState);

  const isArmed = armState === "armed";
  const isConnected = connectionState !== "disconnected";
  const isHardBlocked = isArmed && isConnected;

  return {
    isArmed,
    isLocked: false,
    isHardBlocked,
    lockMessage: isArmed ? SOFT_MESSAGE : "",
    hardBlockMessage: isHardBlocked ? HARD_MESSAGE : "",
  };
}
