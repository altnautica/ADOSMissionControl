/**
 * @license GPL-3.0-only
 *
 * On the cloud relay path the FC source picker used to say the picker "is
 * available over the LAN-direct connection", for every node, without checking
 * whether that node had a LAN pairing at all. For a cloud-only node it named a
 * connection that has never existed. The note now states the mechanism, which
 * is true everywhere, and adds a claim about this node only where the GCS can
 * back it up.
 */

import { describe, it, expect } from "vitest";

import { describeFcSourceReadOnly } from "../fc-source-availability";

describe("describeFcSourceReadOnly", () => {
  it("always states why the relay cannot carry the write", () => {
    for (const lanPaired of [true, false]) {
      for (const originIsHttps of [true, false]) {
        expect(describeFcSourceReadOnly({ lanPaired, originIsHttps })).toMatch(
          /no write path/i,
        );
      }
    }
  });

  it("does not claim a LAN connection for a node with no LAN pairing", () => {
    const msg = describeFcSourceReadOnly({
      lanPaired: false,
      originIsHttps: true,
    });
    expect(msg).toMatch(/No LAN pairing is held for this node/i);
    expect(msg).toMatch(/Add-a-Node/);
    // The old copy pointed at a LAN-direct connection that was never there.
    expect(msg).not.toMatch(/is paired on the LAN/i);
  });

  it("names the HTTPS block for a LAN-paired node on a secure origin", () => {
    const msg = describeFcSourceReadOnly({
      lanPaired: true,
      originIsHttps: true,
    });
    expect(msg).toMatch(/paired on the LAN/i);
    expect(msg).toMatch(/HTTPS/);
  });

  it("points a LAN-paired node on a plain origin at connecting directly", () => {
    const msg = describeFcSourceReadOnly({
      lanPaired: true,
      originIsHttps: false,
    });
    expect(msg).toMatch(/paired on the LAN/i);
    expect(msg).not.toMatch(/HTTPS/);
    expect(msg).toMatch(/enables the picker/i);
  });
});
