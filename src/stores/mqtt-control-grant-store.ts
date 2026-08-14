/**
 * @module stores/mqtt-control-grant-store
 * @description Owns the per-operator broker write grant: minting it, holding its
 * plaintext secret for exactly as long as the tab lives, renewing it before it
 * lapses, injecting it into the one credential singleton every in-browser MQTT
 * client dials with, and recording the first publish the broker demonstrably
 * accepted.
 *
 * Why a store rather than a hook: three consumers need the same answer at three
 * different moments. React surfaces need it reactively (the authority badge on
 * the selected drone and on every fleet row), the transports need it
 * synchronously at dial time (they are not components), and the renewal timer
 * needs it while nothing is rendering at all. A hook could serve only the first.
 *
 * The secret is deliberately NOT part of the store state. `mint` returns the
 * plaintext exactly once, and state is precisely where a devtools middleware, a
 * persist wrapper, or a serialising log would find it. It lives in the
 * credential singleton instead — no serialiser, no persistence, and already the
 * place every consumer reads it from.
 *
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import {
  getMqttBrokerCredential,
  onBrokerWriteAccepted,
  setMqttBrokerCredential,
} from "@/lib/mqtt-broker-credential";
import type { ControlGrant } from "@/lib/nodes/mqtt-control-authority";

/**
 * How far ahead of expiry the renewal fires. Comfortably wider than the
 * resolver's 5-minute warning window, so a single failed renewal still leaves
 * room for retries before the operator is told control is ending — and if every
 * retry fails, the warning arrives while control still works.
 */
export const RENEW_LEAD_MS = 10 * 60 * 1000;

/** Gap between renewal retries after a failure, while the held grant still has time. */
export const RENEW_RETRY_MS = 60 * 1000;

/**
 * How long after a mint the server's view of the grant is treated as
 * possibly-stale. The mint writes its row inside its own action, but the
 * browser's live query still has to round-trip before it reports it, and a view
 * captured mid-flight must not read as "revoked elsewhere".
 */
export const SERVER_SETTLE_MS = 10 * 1000;

/** A freshly minted grant, exactly as `cmdMqttControlGrants.mint` returns it. */
export interface MintedGrant {
  /** Broker username. Opaque, carries no operator identity. */
  principal: string;
  /** The plaintext secret, returned once and never again. */
  secret: string;
  deviceIds: string[];
  expiresAt: number;
}

/** The row `cmdMqttControlGrants.myCurrent` reports. Never carries the secret. */
export interface ServerGrant {
  principal: string;
  deviceIds: string[];
  expiresAt: number;
  lastConfirmedAt: number | null;
}

/**
 * The Convex half of the lifecycle, injected rather than imported so this module
 * stays framework-free and every transition is reachable from a unit test.
 */
export interface GrantBackend {
  mint: () => Promise<MintedGrant>;
  revoke: () => Promise<unknown>;
  confirmWrite: (principal: string) => Promise<unknown>;
}

interface MqttControlGrantState {
  /** The grant this browser holds, in the shape the authority resolver consumes. */
  grant: ControlGrant | null;
  /** Broker principal of the held grant. Needed to confirm the write server-side. */
  principal: string | null;
  /** True while a mint or renewal is in flight. Drives the `provisioning` state. */
  minting: boolean;
  /** Why the last mint failed, for a surface that offers a retry. */
  lastError: string | null;
  /**
   * Bumped every time the injected broker credential changes. MQTT clients
   * cannot swap credentials on a live socket, so every consumer that dialled
   * with the old one keys its reconnect off this.
   */
  credentialEpoch: number;
}

const INITIAL: MqttControlGrantState = {
  grant: null,
  principal: null,
  minting: false,
  lastError: null,
  credentialEpoch: 0,
};

export const useMqttControlGrantStore = create<MqttControlGrantState>(() => ({
  ...INITIAL,
}));

let backend: GrantBackend | null = null;
let renewTimer: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<void> | null = null;
let lastAppliedAt = 0;
let lastServerRow: ServerGrant | null = null;
/**
 * Whether this tab has already superseded a live grant it could not use. See
 * `ensureGrant`: the allowance is what lets a reload recover a usable
 * credential, and spending it is what stops two tabs superseding each other
 * forever.
 */
let autoSupersedeSpent = false;

function clearRenewTimer(): void {
  if (renewTimer === null) return;
  clearTimeout(renewTimer);
  renewTimer = null;
}

function scheduleRenewal(expiresAt: number): void {
  clearRenewTimer();
  const delay = Math.max(0, expiresAt - RENEW_LEAD_MS - Date.now());
  renewTimer = setTimeout(() => {
    renewTimer = null;
    void renew();
  }, delay);
}

function applyMintedGrant(minted: MintedGrant): void {
  setMqttBrokerCredential({
    username: minted.principal,
    password: minted.secret,
  });
  lastAppliedAt = Date.now();
  useMqttControlGrantStore.setState((s) => ({
    principal: minted.principal,
    grant: {
      deviceIds: minted.deviceIds,
      expiresAt: minted.expiresAt,
      // Minted, not proven. The broker only learns this principal on its next
      // password regeneration, so holding the credential is not yet evidence
      // that a write under it will be accepted.
      writeConfirmed: false,
      renewalFailed: false,
    },
    minting: false,
    lastError: null,
    credentialEpoch: s.credentialEpoch + 1,
  }));
  scheduleRenewal(minted.expiresAt);
}

function recordMintFailure(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  useMqttControlGrantStore.setState((s) => ({
    minting: false,
    lastError: message,
    // A failed RENEWAL leaves the operator holding a grant that is running out
    // with nothing coming to replace it. The resolver warns on exactly this
    // flag once the lapse is inside its warning window, so the operator learns
    // control is ending while they still have it.
    grant: s.grant === null ? null : { ...s.grant, renewalFailed: true },
  }));
}

function mintNow(): Promise<void> {
  if (inFlight !== null) return inFlight;
  const active = backend;
  if (active === null) {
    return Promise.reject(new Error("No MQTT control grant backend attached"));
  }
  useMqttControlGrantStore.setState({ minting: true, lastError: null });
  const run = active
    .mint()
    .then(
      (minted) => {
        applyMintedGrant(minted);
      },
      (err: unknown) => {
        recordMintFailure(err);
        throw err;
      },
    )
    .finally(() => {
      inFlight = null;
    });
  inFlight = run;
  return run;
}

async function renew(): Promise<void> {
  const held = useMqttControlGrantStore.getState().grant;
  try {
    await mintNow();
  } catch {
    // Failure is already recorded as `renewalFailed`. Keep trying while the
    // held grant has time left: a transient network fault must not cost the
    // operator their command authority until the next page load.
    const remaining = (held?.expiresAt ?? 0) - Date.now();
    if (remaining > RENEW_RETRY_MS) {
      clearRenewTimer();
      renewTimer = setTimeout(() => {
        renewTimer = null;
        void renew();
      }, RENEW_RETRY_MS);
    }
  }
}

/**
 * True when this browser holds a grant it can actually authenticate with. The
 * secret matters as much as the metadata: a grant whose plaintext this tab never
 * saw — minted by another tab, or dropped on sign-out — cannot authenticate
 * anything, so it is not a grant this browser holds.
 */
function holdsUsableGrant(): boolean {
  const { grant, principal } = useMqttControlGrantStore.getState();
  if (grant === null || principal === null) return false;
  if (grant.expiresAt <= Date.now()) return false;
  return getMqttBrokerCredential()?.username === principal;
}

function markWriteConfirmed(): void {
  const { grant } = useMqttControlGrantStore.getState();
  if (grant === null || grant.writeConfirmed) return;
  // No epoch bump: the credential itself did not change, so nothing should
  // re-dial. Only the honesty of what the surfaces say about it changed.
  useMqttControlGrantStore.setState({ grant: { ...grant, writeConfirmed: true } });
}

function dropHeldGrant(): void {
  clearRenewTimer();
  setMqttBrokerCredential(null);
  lastAppliedAt = 0;
  useMqttControlGrantStore.setState((s) => ({
    ...INITIAL,
    credentialEpoch: s.credentialEpoch + 1,
  }));
}

/**
 * Attach (or detach) the Convex-backed lifecycle. Detaching stops the renewal
 * timer but leaves the held credential in place, because a bridge unmounting on
 * a route change must not drop a live command link.
 */
export function attachGrantBackend(next: GrantBackend | null): void {
  backend = next;
  if (next === null) clearRenewTimer();
}

/**
 * Obtain a grant if this browser does not already hold a usable one. Idempotent
 * and safe to call from an effect, and never rejects: a failure is recorded in
 * `lastError` for the surface that offers the retry.
 */
export async function ensureGrant(): Promise<void> {
  if (backend === null) return;
  if (holdsUsableGrant()) return;

  // A live grant belonging to this operator that THIS tab cannot use: minted in
  // another tab, or in a session before this page load, so the plaintext is
  // gone. Minting supersedes it, because the server keeps one live grant per
  // operator — and that is exactly right once, since it is how a reload recovers
  // a usable credential. It must not happen every time: two tabs each watching
  // the other's mint would supersede one another forever, one mint per round
  // trip. After the allowance is spent the operator decides, from the surface
  // that offers it.
  const { principal } = useMqttControlGrantStore.getState();
  const supersedes =
    lastServerRow !== null &&
    lastServerRow.expiresAt > Date.now() &&
    lastServerRow.principal !== principal;
  if (supersedes) {
    if (autoSupersedeSpent) return;
    autoSupersedeSpent = true;
  }

  try {
    await mintNow();
  } catch {
    // Recorded in `lastError`.
  }
}

/**
 * Mint a fresh grant now, whether or not one is held. This is the operator's
 * remedy for the one state `ensureGrant` cannot fix on its own: a grant that is
 * still live, so nothing needs obtaining, but whose automatic renewal failed.
 */
export async function requestGrant(): Promise<void> {
  try {
    await mintNow();
  } catch {
    // Recorded in `lastError`.
  }
}

/**
 * Observe the operator's server-side grant row. Two facts come from it that this
 * tab cannot know on its own: that the grant was revoked or superseded
 * elsewhere, and that the broker has demonstrably accepted a write under it.
 */
export function syncServerGrant(row: ServerGrant | null): void {
  lastServerRow = row;
  const { principal } = useMqttControlGrantStore.getState();
  if (principal === null) return;
  if (row !== null && row.principal === principal) {
    if (row.lastConfirmedAt !== null) markWriteConfirmed();
    return;
  }
  // A view that predates our own mint is not evidence of a revocation.
  if (inFlight !== null || Date.now() - lastAppliedAt < SERVER_SETTLE_MS) return;
  dropHeldGrant();
}

/**
 * Give up the grant: sign-out, or any point the operator's session ends. The
 * local credential goes first so nothing can publish under it while the revoke
 * is in flight; the server row follows, and its own expiry bounds the gap if the
 * revoke cannot be delivered.
 */
export async function releaseGrant(): Promise<void> {
  const active = backend;
  const held = useMqttControlGrantStore.getState().principal !== null;
  dropHeldGrant();
  // The next sign-in is a fresh start: it gets its own allowance to supersede
  // whatever grant it finds, and knows nothing about rows observed before it.
  lastServerRow = null;
  autoSupersedeSpent = false;
  if (active === null || !held) return;
  try {
    await active.revoke();
  } catch {
    // The grant's expiry bounds the window; nothing else to do from here.
  }
}

/**
 * The broker credential a relay transport should dial `deviceId` with, or
 * undefined when this browser holds no write grant covering it.
 *
 * This is the ONLY producer of `canPublish: true`. The transport refuses to
 * infer publish authority from an open socket, because a credential that streams
 * telemetry perfectly can have every publish silently discarded, so the claim
 * has to come from whoever knows which credential was minted for what.
 */
export function relayWriteAuthFor(
  deviceId: string | null | undefined,
): { username: string; password: string; canPublish: true } | undefined {
  if (!deviceId) return undefined;
  const { grant, principal } = useMqttControlGrantStore.getState();
  const cred = getMqttBrokerCredential();
  if (grant === null || principal === null || cred?.username !== principal) {
    return undefined;
  }
  if (grant.expiresAt <= Date.now()) return undefined;
  if (!grant.deviceIds.includes(deviceId)) return undefined;
  return { username: cred.username, password: cred.password, canPublish: true };
}

/**
 * Record that the broker accepted a publish under the held credential. This is
 * the only evidence that exists: at QoS 0 nothing is acknowledged, so a grant
 * that was issued but never exercised proves nothing about whether the host's
 * password regeneration has run yet.
 *
 * Subscribed at module scope rather than on attach so the proof is never missed
 * by an ordering accident between the first publish and the bridge mounting.
 */
onBrokerWriteAccepted(() => {
  const { grant, principal } = useMqttControlGrantStore.getState();
  if (grant === null || grant.writeConfirmed || principal === null) return;
  markWriteConfirmed();
  void backend?.confirmWrite(principal).catch(() => {
    // The local observation is the proof; the server row only carries it to the
    // operator's other tabs and to the next page load.
  });
});
