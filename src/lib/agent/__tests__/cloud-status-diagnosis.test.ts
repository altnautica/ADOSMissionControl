/**
 * @license GPL-3.0-only
 *
 * A silent cloud relay used to be reported as "No cloud status received. Is the
 * agent paired and online?" for every node. Most nodes that reach this timeout
 * are not cloud nodes at all: a LAN-only pairing publishes nothing to the relay,
 * and an agent with its relay switched off never will either. Both are correct
 * configurations, so the question sent the operator to check power on a node
 * that was working. Each cause now names itself, and the offline reading is
 * reserved for a node that really is cloud-paired.
 */

import { describe, it, expect } from "vitest";

import { diagnoseMissingCloudStatus } from "../cloud-status-diagnosis";

describe("diagnoseMissingCloudStatus", () => {
  it("names the switched-off relay before anything else", () => {
    const msg = diagnoseMissingCloudStatus({
      cloudPaired: true,
      lanPaired: true,
      cloudPosture: "local",
      originIsHttps: false,
    });
    expect(msg).toMatch(/cloud relay switched off/i);
    expect(msg).toMatch(/LAN/);
    // The agent is running and reporting. Nothing may imply otherwise.
    expect(msg).not.toMatch(/offline|powered down|stopped reporting/i);
  });

  it("explains the HTTPS block for a LAN-only node on a secure origin", () => {
    const msg = diagnoseMissingCloudStatus({
      cloudPaired: false,
      lanPaired: true,
      originIsHttps: true,
    });
    expect(msg).toMatch(/paired over the LAN only/i);
    expect(msg).toMatch(/HTTPS/);
    expect(msg).not.toMatch(/offline|powered down|stopped reporting/i);
  });

  it("points a LAN-only node on a plain origin at its direct connection", () => {
    const msg = diagnoseMissingCloudStatus({
      cloudPaired: false,
      lanPaired: true,
      originIsHttps: false,
    });
    expect(msg).toMatch(/paired over the LAN only/i);
    expect(msg).not.toMatch(/HTTPS/);
    expect(msg).not.toMatch(/offline|powered down|stopped reporting/i);
  });

  it("says no pairing is held when the node has neither lane", () => {
    const msg = diagnoseMissingCloudStatus({
      cloudPaired: false,
      lanPaired: false,
      originIsHttps: false,
    });
    expect(msg).toMatch(/No pairing is held/i);
    expect(msg).toMatch(/Add-a-Node/);
  });

  it("reports a silent agent only when the node really is cloud-paired", () => {
    const msg = diagnoseMissingCloudStatus({
      cloudPaired: true,
      lanPaired: false,
      cloudPosture: "cloud",
      originIsHttps: true,
    });
    expect(msg).toMatch(/powered down|stopped reporting/i);
  });

  it("treats an unreported posture on a cloud-paired node as a silent agent", () => {
    // An older agent sends no posture. It is cloud-paired and its row is not
    // updating, which is the one case the offline reading fits.
    const msg = diagnoseMissingCloudStatus({
      cloudPaired: true,
      lanPaired: false,
      cloudPosture: undefined,
      originIsHttps: false,
    });
    expect(msg).toMatch(/powered down|stopped reporting/i);
  });
});
