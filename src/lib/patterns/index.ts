/**
 * @module patterns
 * @description Barrel export for flight pattern generators and dispatcher.
 * @license GPL-3.0-only
 */

export { generateSurvey } from "./survey-generator";
export { generateOrbit } from "./orbit-generator";
export { generateCorridor } from "./corridor-generator";
export { generateExpandingSquare, generateSectorSearch, generateParallelTrack } from "./sar-generators";
export { generateStructureScan } from "./structure-scan-generator";
export { generateFixedWingLanding } from "./landing-generator";
export { generateVtolLanding } from "./vtol-landing-generator";
export * from "./types";

import type { PatternConfig, PatternResult } from "./types";
import { generateSurvey } from "./survey-generator";
import { generateOrbit } from "./orbit-generator";
import { generateCorridor } from "./corridor-generator";
import { generateExpandingSquare, generateSectorSearch, generateParallelTrack } from "./sar-generators";
import { generateStructureScan } from "./structure-scan-generator";
import { generateFixedWingLanding } from "./landing-generator";
import { generateVtolLanding } from "./vtol-landing-generator";

/**
 * Dispatch to the correct pattern generator based on config type.
 */
export function generatePattern(config: PatternConfig): PatternResult {
  switch (config.type) {
    case "survey":
      return generateSurvey(config.config);
    case "orbit":
      return generateOrbit(config.config);
    case "corridor":
      return generateCorridor(config.config);
    case "expandingSquare":
      return generateExpandingSquare(config.config);
    case "sectorSearch":
      return generateSectorSearch(config.config);
    case "parallelTrack":
      return generateParallelTrack(config.config);
    case "structureScan":
      return generateStructureScan(config.config);
    case "fixedWingLanding":
      return generateFixedWingLanding(config.config);
    case "vtolLanding":
      return generateVtolLanding(config.config);
  }
}
