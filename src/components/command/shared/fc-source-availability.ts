"use client";

/**
 * Why the FC source picker is read-only on a node reached over the cloud relay.
 *
 * The write goes through the agent's own config surface, which answers only a
 * direct request to the agent. The relay carries the reading and nothing else,
 * so on that path the picker can only report. What it must not do is tell the
 * operator the picker "is available over the LAN-direct connection" for a node
 * that has no LAN pairing in this browser: that is a claim about this node,
 * made without checking, and it sends the operator looking for a connection
 * that was never there.
 *
 * @module command/shared/fc-source-availability
 * @license GPL-3.0-only
 */

/** What the GCS knows about reaching this node outside the relay. */
export interface FcSourceReadOnlyInput {
  /** The node holds LAN credentials in this browser. */
  lanPaired: boolean;
  /** The page origin blocks a plain-HTTP request to a LAN address. */
  originIsHttps: boolean;
}

/** The mechanism, stated for every node on the relay path. */
const RELAY_HAS_NO_WRITE_PATH =
  "Changing the source writes through the agent's own config surface, which answers a direct connection only. The cloud relay carries this reading and no write path.";

/**
 * The read-only explanation for a relay-connected node. Pure, so the claim made
 * about each case is testable without a browser or a store.
 */
export function describeFcSourceReadOnly(
  input: FcSourceReadOnlyInput,
): string {
  if (!input.lanPaired) {
    return `${RELAY_HAS_NO_WRITE_PATH} No LAN pairing is held for this node in this browser, so pair it by hostname or address from the Add-a-Node card to change the source.`;
  }
  if (input.originIsHttps) {
    return `${RELAY_HAS_NO_WRITE_PATH} This node is paired on the LAN, but this page is served over HTTPS, which blocks a direct request to a LAN address.`;
  }
  return `${RELAY_HAS_NO_WRITE_PATH} This node is paired on the LAN, so connecting to it directly enables the picker.`;
}
