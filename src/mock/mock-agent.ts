/**
 * @module MockAgentClient
 * @description Barrel re-export of the demo-mode agent client. Per-domain
 * fixture data + the class itself live under `src/mock/agent/`. The
 * original path is kept as a barrel so existing imports keep working.
 * @license GPL-3.0-only
 */

export { MockAgentClient } from "./agent/client";
export { MOCK_PERIPHERALS } from "./agent/peripherals";
export {
  MOCK_MODULES,
  MOCK_NETWORK,
  MOCK_PEERS,
  type MockModule,
  type MockNetwork,
} from "./agent/fleet";
export { getMockCapabilities } from "./agent/capabilities";
