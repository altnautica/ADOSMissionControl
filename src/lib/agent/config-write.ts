/**
 * @module agent/config-write
 * @description The agent config-write contract, transport-independent.
 *
 * `PUT /api/config` answers HTTP 200 for three different outcomes: the value
 * landed, the value was rejected (`{error}` in the body), or the value was
 * accepted into the running model but never written to disk
 * (`persisted: false`). The route mutates the in-memory model BEFORE it saves,
 * so a read-back confirms the new value in all three cases — which is why a
 * status code, an echoed value, and a successful re-read are each, on their
 * own, worthless as proof.
 *
 * Every caller on every lane (the direct LAN client, the server-side config
 * proxy, the ground station's relay-proxy) therefore derives success from
 * `configWriteFailure` and nothing else. Kept free of store and React imports
 * so the transport layer can use it too.
 * @license GPL-3.0-only
 */

/** Response shape of the agent's single-key config write. */
export interface ConfigWriteResult {
  status?: string;
  key?: string;
  value?: unknown;
  /** The agent's rejection reason for an unknown key or an uncoercible value.
   * Carried in a 200 body, not a status code. */
  error?: string;
  /** False when the value was accepted in memory but never reached disk (a
   * non-root agent, a full or read-only `/etc`, a lock/rename failure), so it
   * dies at the next service restart. Absent on agents that predate the flag,
   * which is treated as persisted. */
  persisted?: boolean;
  /** The agent's reason for a failed disk write, when it has one. Absent when
   * the save merely returned false (e.g. a non-root agent). */
  persist_error?: string;
}

/** What the operator is told when the node took a value it could not store.
 * Names the consequence (lost on restart) and the action (fix the node's own
 * config path), because "Saved" for a RAM-only write is the failure this
 * message exists to replace. */
export const PERSIST_FAILED_MESSAGE =
  "The node accepted this value but could not write it to disk, so it will be lost when the node restarts. Check the agent's own config path (/etc/ados/config.yaml) — a non-root agent or a full/read-only filesystem cannot persist — then apply it again.";

/**
 * The reason a config write did not land, or null when it did.
 *
 * ONE truth check for every caller: a caller that hand-rolls half of the pair
 * reports "Saved" for a change the node never stored.
 */
export function configWriteFailure(
  res: ConfigWriteResult | null | undefined,
): string | null {
  if (!res) return null;
  if (typeof res.error === "string") return res.error;
  if (res.persisted === false) {
    const reason =
      typeof res.persist_error === "string" && res.persist_error.length > 0
        ? res.persist_error
        : null;
    return reason
      ? `${PERSIST_FAILED_MESSAGE} (node reported: ${reason})`
      : PERSIST_FAILED_MESSAGE;
  }
  return null;
}
