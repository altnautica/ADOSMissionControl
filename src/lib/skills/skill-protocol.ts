/**
 * The narrow command surface a skill actually drives.
 *
 * A skill never touches the full `DroneProtocol` (65 required members — a
 * live-connection contract covering parameters, missions, logs, calibration and
 * ~20 telemetry callback registrars). The built-in skills reach exactly nine
 * command methods, and nothing else. Typing `SkillContext.protocol` against
 * that nine-method surface is what lets a caller supply a command sink for a
 * node it holds no live connection to — a fleet-operations view commanding a
 * node that is not the selected one — without the impossible task of
 * implementing the whole connection contract.
 *
 * The set is closed on purpose. Adding a protocol call to a built-in means
 * widening this interface first, which forces every sink to answer for the new
 * method rather than throwing at runtime on a partially-implemented object.
 *
 * @module skills/skill-protocol
 * @license GPL-3.0-only
 */

import type {
  CommandResult,
  DroneProtocol,
  UnifiedFlightMode,
} from "@/lib/protocol/types";

/**
 * Every command a skill may issue. Signatures are copied verbatim from
 * `DroneProtocol` so a live protocol satisfies this structurally with no
 * adapter — see {@link DroneProtocolSatisfiesSkillProtocol}.
 */
export interface SkillProtocol {
  /** Enable motor output. */
  arm(): Promise<CommandResult>;
  /** Disable motor output. */
  disarm(): Promise<CommandResult>;
  /** Switch the vehicle to a flight mode. */
  setFlightMode(mode: UnifiedFlightMode): Promise<CommandResult>;
  /** Command a return to the launch point. */
  returnToLaunch(): Promise<CommandResult>;
  /** Command a landing at the current position. */
  land(): Promise<CommandResult>;
  /** Arm-and-climb to `altitude` metres. */
  takeoff(altitude: number): Promise<CommandResult>;
  /**
   * Emergency motor cut. `confirmed` carries the operator confirmation the
   * dispatcher already collected; the protocol layer refuses without it.
   */
  killSwitch(confirmed: boolean): Promise<CommandResult>;
  /** Hold an in-progress mission at the current item. */
  pauseMission(): Promise<CommandResult>;
  /** Continue a held mission. */
  resumeMission(): Promise<CommandResult>;
}

/** Fails to compile unless `T` is exactly `true`. */
type Assert<T extends true> = T;

/**
 * Compile-time proof that a live `DroneProtocol` is a valid `SkillProtocol`, so
 * every existing call site that hands a live protocol to a skill keeps working
 * unchanged. If a signature on either side drifts apart this alias resolves to
 * `false` and the build fails here, at the contract, rather than at each of the
 * call sites.
 */
export type DroneProtocolSatisfiesSkillProtocol = Assert<
  DroneProtocol extends SkillProtocol ? true : false
>;
