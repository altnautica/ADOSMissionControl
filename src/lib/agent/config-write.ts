/**
 * @module agent/config-write
 * @description The agent config-write contract, transport-independent.
 *
 * `PUT /api/config` has three outcomes: the value landed (200, `persisted:
 * true`); the value was rejected (200 with `{error}` in the body); or the
 * config file could not be written (500 with `persisted: false` and the
 * agent's `persist_error`), in which case the route took no effect at all.
 *
 * Every caller on every lane (the direct LAN client, the server-side config
 * proxy, the ground station's relay-proxy) therefore derives success from
 * `configWriteFailure` and nothing else, and every transport hands the 500
 * persist-failure body back as a result (`persistFailureBody`) rather than
 * a bare HTTP error, so the operator sees the node's own reason. Kept free of
 * store and React imports so the transport layer can use it too.
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
  /** False when the config file could not be written (a non-root agent, a
   * full or read-only `/etc`, a lock/rename failure); the write then had no
   * effect. */
  persisted?: boolean;
  /** The agent's reason for the failed disk write. */
  persist_error?: string;
}

/** What the operator is told when the node could not store a value. Names
 * the consequence (nothing changed) and the action (fix the node's own config
 * path). */
export const PERSIST_FAILED_MESSAGE =
  "The node could not write this value to its config file, so nothing was changed. Check the agent's own config path (/etc/ados/config.yaml) — a non-root agent or a full/read-only filesystem cannot persist — then apply it again.";

/**
 * The write route's persist-failure answer carried by a non-2xx response, or
 * null when the body is anything else. Transports return it as the write's
 * result so `configWriteFailure` names the node's reason.
 */
export function persistFailureBody(body: unknown): ConfigWriteResult | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const row = body as ConfigWriteResult;
  return row.persisted === false ? row : null;
}

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
