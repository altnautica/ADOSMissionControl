/**
 * @module nodes/index
 * @description Node type registry for the React Flow architecture diagram.
 * @license GPL-3.0-only
 */

import { SbcNode } from "./SbcNode";
import { DeviceNode } from "./DeviceNode";

export const nodeTypes = {
  sbc: SbcNode,
  device: DeviceNode,
};
