/**
 * @module BrowserIdentityStore
 * @description Two distinct anonymous identities, deliberately separate.
 *
 * `browserId` — a per-browser UUID used as the local pair's ``user_id`` when
 * claiming an agent over LAN. The agent's ``/api/pairing/claim`` accepts any
 * string; a browser-local UUID keeps a consistent owner identity across paired
 * nodes without ever round-tripping through a cloud account.
 *
 * `cloudSessionSecret` — a SERVER-MINTED bearer secret for the anonymous Convex
 * code-pair path. It is not interchangeable with `browserId` and must never be
 * substituted for it. The cloud path used to take the browser's own UUID as the
 * owner argument, and an argument is whatever the caller says it is: anyone who
 * learned another browser's UUID could assert ownership of that browser's cloud
 * rows. The relay now mints the secret (`cmdPairing.issueBrowserSession`),
 * stores only its digest, and derives the owner from the row it resolves — so
 * the value below is a credential, not an identifier.
 *
 * Both persisted to localStorage. Generated / fetched on first use.
 *
 * THREAT MODEL (local-first credential storage):
 *   - `browserId` is the pair OWNER identifier the agent uses to scope
 *     unpair / re-pair requests. Anyone with access to it can unpair the
 *     agent from this browser.
 *   - `cloudSessionSecret` is a bearer credential for the anonymous cloud
 *     identity. Anyone holding it is that anonymous owner. It grants nothing
 *     on a signed-in account and cannot read a signed-in user's fleet.
 *   - localStorage is plaintext. XSS that runs on the GCS origin
 *     reads everything. Browser-extension access also reads
 *     localStorage; devtools sees the same. This is the local-first
 *     trade-off: no cloud account means no server-side credential
 *     anchor.
 *   - If localStorage is cleared, the operator loses ownership of
 *     every locally-paired node. Recovery: unpair the agent from
 *     its own setup webapp (`http://<host>:8080/setup.html`), then
 *     re-pair from the GCS.
 *   - Future hardening (WebCrypto wrapping key + per-browser
 *     passphrase) is intentionally deferred. The pragmatic posture
 *     for now is "operator trusts their own browser session".
 *
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

interface BrowserIdentityState {
  browserId: string;
  /** Server-minted anonymous cloud session secret, or "" before first mint. */
  cloudSessionSecret: string;
  /** Epoch ms when the operator dismissed the first-pair UX warning,
   * or 0 if it has never been dismissed. */
  localPairWarningDismissedAt: number;
  ensureBrowserId: () => string;
  setCloudSessionSecret: (secret: string) => void;
  dismissLocalPairWarning: () => void;
}

function generateBrowserId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `browser_${crypto.randomUUID()}`;
  }
  // Fallback for older browsers — collision-resistant enough for a
  // local pair identity, never used for auth.
  const rand = () => Math.random().toString(36).slice(2, 10);
  return `browser_${rand()}${rand()}${Date.now().toString(36)}`;
}

export const useBrowserIdentityStore = create<BrowserIdentityState>()(
  persist(
    (set, get) => ({
      browserId: "",
      cloudSessionSecret: "",
      localPairWarningDismissedAt: 0,
      ensureBrowserId: () => {
        let id = get().browserId;
        if (!id) {
          id = generateBrowserId();
          set({ browserId: id });
        }
        return id;
      },
      setCloudSessionSecret: (secret: string) => {
        set({ cloudSessionSecret: secret });
      },
      dismissLocalPairWarning: () => {
        set({ localPairWarningDismissedAt: Date.now() });
      },
    }),
    {
      name: "altcmd:browser-identity",
      version: 2,
      // v1 predates `cloudSessionSecret`. Back-fill it as empty rather than
      // synthesising one: the secret is only valid if the relay minted it, so
      // an upgraded browser mints on its next anonymous pair.
      migrate: (persisted, version) => {
        const state = persisted as Partial<BrowserIdentityState>;
        if (version < 2) {
          return { ...state, cloudSessionSecret: "" } as BrowserIdentityState;
        }
        return state as BrowserIdentityState;
      },
    },
  ),
);

/** Read or generate the browser-local UUID synchronously. */
export function getBrowserId(): string {
  return useBrowserIdentityStore.getState().ensureBrowserId();
}

/** Read the stored anonymous cloud-session secret ("" when none is held). */
export function getCloudSessionSecret(): string {
  return useBrowserIdentityStore.getState().cloudSessionSecret;
}
