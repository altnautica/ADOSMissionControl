/**
 * Human-readable explanation of a `signing.capability.reason` value from
 * the agent. Pure function.
 *
 * @module components/fc/security/signing/describe-reason
 */

export function describeReason(reason: string): string {
  switch (reason) {
    case "fc_not_connected":
      return "The flight controller is not connected.";
    case "firmware_not_supported":
      return "This firmware family does not expose a signing key store.";
    case "firmware_px4_no_persistent_store":
      return "PX4 supports the signing protocol but lacks a persistent on-board key store.";
    case "msp_protocol":
      return "Betaflight and iNav use the MSP protocol, which has no signing concept.";
    default:
      return "MAVLink signing is not available.";
  }
}
