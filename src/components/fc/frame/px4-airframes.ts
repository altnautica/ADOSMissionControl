/**
 * @module fc/frame/px4-airframes
 * @description The PX4 airframes a SYS_AUTOSTART value selects. Each id is the
 * numeric prefix of an airframe script shipped in PX4's ROMFS
 * (init.d/airframes); an id with no script leaves the autostart with nothing to
 * load, so only ids that exist there belong in this list. Simulation-only
 * airframes are left out.
 * @license GPL-3.0-only
 */

export interface AirframeEntry {
  id: number;
  name: string;
  category: string;
}

export const PX4_AIRFRAMES: readonly AirframeEntry[] = [
  // Multirotor
  { id: 4001, name: "Generic Quadrotor X", category: "Quadrotor X" },
  { id: 4014, name: "S500", category: "Quadrotor X" },
  { id: 4015, name: "Holybro S500", category: "Quadrotor X" },
  { id: 4016, name: "Holybro PX4 Vision", category: "Quadrotor X" },
  { id: 4017, name: "NXP HoverGames", category: "Quadrotor X" },
  { id: 4019, name: "Holybro X500 V2", category: "Quadrotor X" },
  { id: 4020, name: "Holybro PX4 Vision 1.5", category: "Quadrotor X" },
  { id: 4041, name: "BetaFPV Beta75X", category: "Quadrotor X" },
  { id: 4050, name: "Generic 250 Racer", category: "Quadrotor X" },
  { id: 4052, name: "Holybro QAV250", category: "Quadrotor X" },
  { id: 4053, name: "Holybro Kopis 2", category: "Quadrotor X" },
  { id: 4061, name: "ATL Mantis EDU", category: "Quadrotor X" },
  { id: 4071, name: "IFO", category: "Quadrotor X" },
  { id: 4073, name: "IFO-S", category: "Quadrotor X" },
  { id: 4500, name: "Clover 4", category: "Quadrotor X" },
  { id: 4601, name: "DroneBlocks DEXI 5", category: "Quadrotor X" },
  { id: 4901, name: "Crazyflie 2.1", category: "Quadrotor X" },
  { id: 5001, name: "Generic Quadrotor +", category: "Quadrotor +" },
  { id: 6001, name: "Generic Hexarotor X", category: "Hexarotor X" },
  { id: 6002, name: "Draco-R", category: "Hexarotor X" },
  { id: 7001, name: "Generic Hexarotor +", category: "Hexarotor +" },
  { id: 8001, name: "Generic Octorotor X", category: "Octorotor X" },
  { id: 9001, name: "Generic Octorotor +", category: "Octorotor +" },
  { id: 11001, name: "Generic Hexarotor Coaxial", category: "Coaxial" },
  { id: 12001, name: "Generic Octorotor Coaxial", category: "Coaxial" },
  { id: 24001, name: "Generic Dodecarotor Coaxial", category: "Coaxial" },
  { id: 14001, name: "Generic Multirotor with Tilt", category: "Tilting Multirotor" },
  { id: 16001, name: "Generic Helicopter", category: "Helicopter" },
  // Fixed wing
  { id: 2100, name: "Standard Plane", category: "Standard Plane" },
  { id: 2106, name: "Albatross", category: "Standard Plane" },
  { id: 3000, name: "Generic Flying Wing", category: "Flying Wing" },
  // VTOL
  { id: 13000, name: "Generic Standard VTOL", category: "VTOL" },
  { id: 13030, name: "Generic Quad Tiltrotor VTOL", category: "VTOL" },
  { id: 13100, name: "Generic Tiltrotor VTOL", category: "VTOL" },
  { id: 13200, name: "Generic Tailsitter VTOL", category: "VTOL" },
  // Ground
  { id: 50000, name: "Generic Differential Rover", category: "Rover" },
  { id: 50001, name: "Aion Robotics R1", category: "Rover" },
  { id: 50002, name: "Hiwonder Tracked", category: "Rover" },
  { id: 51000, name: "Generic Ackermann Rover", category: "Rover" },
  { id: 51001, name: "Axial SCX10 2 Trail Honcho", category: "Rover" },
  { id: 51002, name: "NXP B3RB", category: "Rover" },
  { id: 51003, name: "Hiwonder Ackermann", category: "Rover" },
  { id: 52000, name: "Generic Mecanum Rover", category: "Rover" },
  { id: 52001, name: "Hiwonder Mecanum", category: "Rover" },
  // Underwater
  { id: 60000, name: "Generic UUV", category: "Underwater" },
  { id: 60001, name: "HippoCampus UUV", category: "Underwater" },
  { id: 60002, name: "BlueROV2 Heavy", category: "Underwater" },
  // Lighter than air / rotorcraft
  { id: 2500, name: "Generic Airship", category: "Airship" },
  { id: 2507, name: "Cloudship", category: "Airship" },
  { id: 17002, name: "TF-AutoG2", category: "Autogyro" },
  { id: 17003, name: "TF-G2", category: "Autogyro" },
  { id: 18001, name: "TF-B1", category: "Balloon" },
];
