/**
 * @module stores/mqtt-control-grant-store.test
 * @description Pins the broker write-grant lifecycle: the states an operator
 * sees while one is obtained, the renewal that keeps it alive, what a failed
 * renewal reports, and the one invariant that matters more than any of them —
 * the plaintext secret reaches the credential singleton and nothing else.
 *
 * The transitions are asserted THROUGH `resolveMqttControlAuthority`, the same
 * pure resolver every surface reads, rather than against store fields. A store
 * field that changed while the surface it feeds stayed wrong would pass a
 * field-level test and still leave the operator misinformed.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  attachGrantBackend,
  ensureGrant,
  relayWriteAuthFor,
  releaseGrant,
  requestGrant,
  syncServerGrant,
  useMqttControlGrantStore,
  RENEW_LEAD_MS,
  RENEW_RETRY_MS,
  SERVER_SETTLE_MS,
  type GrantBackend,
  type MintedGrant,
} from "../mqtt-control-grant-store";
import {
  getMqttBrokerCredential,
  notifyBrokerWriteAccepted,
  setMqttBrokerCredential,
} from "@/lib/mqtt-broker-credential";
import {
  canPublishFcFrames,
  resolveMqttControlAuthority,
  EXPIRY_WARNING_MS,
  type MqttAuthorityReason,
} from "@/lib/nodes/mqtt-control-authority";

// happy-dom in this config does not provide a working Web Storage, and Node's
// own experimental `globalThis.localStorage` is undefined without
// `--localstorage-file`, so reading `.length` off it throws. Install a real
// in-memory pair before the store modules load (`vi.hoisted` runs before
// imports). The secret-leak test below then walks storage that actually exists.
vi.hoisted(() => {
  const install = (name: "localStorage" | "sessionStorage") => {
    const map = new Map<string, string>();
    const storage = {
      get length() {
        return map.size;
      },
      clear: () => map.clear(),
      getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
      key: (i: number) => Array.from(map.keys())[i] ?? null,
      removeItem: (k: string) => {
        map.delete(k);
      },
      setItem: (k: string, v: string) => {
        map.set(k, String(v));
      },
    };
    const descriptor = { value: storage, configurable: true, writable: true };
    Object.defineProperty(globalThis, name, descriptor);
    if (typeof window !== "undefined") {
      Object.defineProperty(window, name, descriptor);
    }
  };
  install("localStorage");
  install("sessionStorage");
});

/** Matches `cmdMqttControlGrants.GRANT_TTL_MS`. */
const TTL_MS = 60 * 60 * 1000;
const BASE_TIME = 1_760_000_000_000;
const DEVICE = "drone-a";

interface PendingMint {
  promise: Promise<MintedGrant>;
  resolve: (grant: MintedGrant) => void;
  reject: (err: unknown) => void;
  settled: boolean;
}

interface FakeBackend {
  backend: GrantBackend;
  /** One entry per `mint()` call, in order, each settled by the test. */
  mints: PendingMint[];
  confirmed: string[];
  revokes: () => number;
}

function fakeBackend(): FakeBackend {
  const mints: PendingMint[] = [];
  let revokes = 0;
  const confirmed: string[] = [];
  return {
    mints,
    confirmed,
    revokes: () => revokes,
    backend: {
      mint: () => {
        let resolve!: (grant: MintedGrant) => void;
        let reject!: (err: unknown) => void;
        const promise = new Promise<MintedGrant>((res, rej) => {
          resolve = res;
          reject = rej;
        });
        const pending: PendingMint = {
          promise,
          settled: false,
          resolve: (grant) => {
            pending.settled = true;
            resolve(grant);
          },
          reject: (err) => {
            pending.settled = true;
            reject(err);
          },
        };
        mints.push(pending);
        return promise;
      },
      revoke: async () => {
        revokes += 1;
        return { revoked: 1 };
      },
      confirmWrite: async (principal: string) => {
        confirmed.push(principal);
        return { ok: true };
      },
    },
  };
}

/** The nth grant the server would mint, expiring one TTL from the clock now. */
function minted(n: number): MintedGrant {
  return {
    principal: `gcs-op-${n}`,
    secret: `secret-${n}`,
    deviceIds: [DEVICE],
    expiresAt: Date.now() + TTL_MS,
  };
}

/** Let the promise chain behind a settled mint reach the store. */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(0);
}

/**
 * What a relay surface reports right now. `transportCanCommand` mirrors the
 * hooks: a relay session that has not (re)dialled with the grant cannot publish
 * under it, so the surfaces AND the two facts together.
 */
function authority(transportCanCommand = true) {
  const { grant, minting } = useMqttControlGrantStore.getState();
  return resolveMqttControlAuthority({
    lane: "cloud-relay",
    deviceId: DEVICE,
    grant: transportCanCommand ? grant : null,
    minting,
    now: Date.now(),
  });
}

function reason(transportCanCommand = true): MqttAuthorityReason {
  return authority(transportCanCommand).reason;
}

let b: FakeBackend;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(BASE_TIME);
  setMqttBrokerCredential(null);
  useMqttControlGrantStore.setState({
    grant: null,
    principal: null,
    minting: false,
    lastError: null,
    credentialEpoch: 0,
  });
  b = fakeBackend();
  attachGrantBackend(b.backend);
});

afterEach(async () => {
  // A mint left in flight would be handed to the NEXT test by the in-flight
  // guard, so settle every one before tearing the backend down.
  for (const pending of b.mints) {
    if (!pending.settled) pending.reject(new Error("test teardown"));
  }
  await settle();
  // `releaseGrant` is also the module's own reset: it clears the renewal timer,
  // the last observed server row, and the one-shot supersede allowance, all of
  // which are module-scoped and would otherwise leak into the next test.
  await releaseGrant();
  attachGrantBackend(null);
  setMqttBrokerCredential(null);
  vi.useRealTimers();
});

describe("mqtt control grant — obtaining one", () => {
  it("walks no-grant to provisioning to unconfirmed to active", async () => {
    // Nothing held and nothing in flight: the honest answer is that this
    // browser cannot command, not that it is about to be able to.
    expect(reason()).toBe("no-grant");

    const pending = ensureGrant();
    // `provisioning` is only reachable because a mint is in flight. It must
    // never read as ready: the credential does not exist yet.
    expect(useMqttControlGrantStore.getState().minting).toBe(true);
    expect(reason()).toBe("provisioning");
    expect(canPublishFcFrames(authority())).toBe(false);

    b.mints[0].resolve(minted(1));
    await pending;

    // Held, and injected where every MQTT client reads it.
    expect(getMqttBrokerCredential()).toEqual({
      username: "gcs-op-1",
      password: "secret-1",
    });
    // Held but never exercised: usable, and said so honestly.
    expect(reason()).toBe("grant-unconfirmed");
    expect(canPublishFcFrames(authority())).toBe(true);

    // The broker took a frame. That is the only proof available at QoS 0.
    notifyBrokerWriteAccepted();
    expect(reason()).toBe("grant-active");
    expect(b.confirmed).toEqual(["gcs-op-1"]);
  });

  it("reports a mint failure without inventing a grant", async () => {
    const pending = ensureGrant();
    b.mints[0].reject(new Error("No paired devices to grant control over"));
    await pending;

    expect(useMqttControlGrantStore.getState().lastError).toBe(
      "No paired devices to grant control over",
    );
    expect(useMqttControlGrantStore.getState().grant).toBeNull();
    expect(getMqttBrokerCredential()).toBeNull();
    expect(reason()).toBe("no-grant");
  });

  it("does not mint a second grant when it already holds a usable one", async () => {
    const first = ensureGrant();
    b.mints[0].resolve(minted(1));
    await first;
    await ensureGrant();
    expect(b.mints).toHaveLength(1);
  });

  it("re-mints over an expired grant rather than reporting it usable", async () => {
    const first = ensureGrant();
    b.mints[0].resolve(minted(1));
    await first;

    // A tab that slept through its own renewal wakes holding a dead credential.
    vi.setSystemTime(BASE_TIME + TTL_MS + 1000);
    expect(reason()).toBe("grant-expired");
    expect(canPublishFcFrames(authority())).toBe(false);

    const second = ensureGrant();
    expect(reason()).toBe("provisioning");
    b.mints[1].resolve(minted(2));
    await second;
    expect(getMqttBrokerCredential()?.username).toBe("gcs-op-2");
    expect(reason()).toBe("grant-unconfirmed");
  });
});

describe("mqtt control grant — renewal", () => {
  it("re-mints ahead of expiry on its own timer", async () => {
    const first = ensureGrant();
    b.mints[0].resolve(minted(1));
    await first;
    expect(useMqttControlGrantStore.getState().credentialEpoch).toBe(1);

    // Nothing renders and nothing clicks; the timer is the only trigger.
    await vi.advanceTimersByTimeAsync(TTL_MS - RENEW_LEAD_MS);
    expect(b.mints).toHaveLength(2);

    b.mints[1].resolve(minted(2));
    await settle();
    expect(getMqttBrokerCredential()).toEqual({
      username: "gcs-op-2",
      password: "secret-2",
    });
    // The epoch is what makes every MQTT client re-dial: a client cannot swap
    // credentials on a live socket, so a bump with no reconnect behind it would
    // leave sockets authenticated as a principal that has been superseded.
    expect(useMqttControlGrantStore.getState().credentialEpoch).toBe(2);
    expect(reason()).toBe("grant-unconfirmed");
  });

  it("flags a failed renewal and warns only once the lapse is in sight", async () => {
    const first = ensureGrant();
    b.mints[0].resolve(minted(1));
    await first;
    notifyBrokerWriteAccepted();
    expect(reason()).toBe("grant-active");

    await vi.advanceTimersByTimeAsync(TTL_MS - RENEW_LEAD_MS);
    b.mints[1].reject(new Error("network unreachable"));
    await settle();

    const state = useMqttControlGrantStore.getState();
    expect(state.grant?.renewalFailed).toBe(true);
    expect(state.lastError).toBe("network unreachable");
    // Ten minutes left, which is outside the warning window: control still
    // works, and crying wolf this early would train the operator to ignore it.
    expect(reason()).toBe("grant-active");

    await vi.advanceTimersByTimeAsync(RENEW_LEAD_MS - EXPIRY_WARNING_MS + 1000);
    // Now the lapse is inside the window. Still commandable, and the operator is
    // told while they can still act on it.
    expect(reason()).toBe("grant-expiring");
    expect(canPublishFcFrames(authority())).toBe(true);
  });

  it("keeps retrying a failed renewal while the held grant has time left", async () => {
    const first = ensureGrant();
    b.mints[0].resolve(minted(1));
    await first;

    await vi.advanceTimersByTimeAsync(TTL_MS - RENEW_LEAD_MS);
    b.mints[1].reject(new Error("network unreachable"));
    await settle();

    // A transient fault must not cost the operator their authority until the
    // next page load, so the renewal comes back on its own.
    await vi.advanceTimersByTimeAsync(RENEW_RETRY_MS);
    expect(b.mints).toHaveLength(3);
    b.mints[2].resolve(minted(3));
    await settle();

    expect(useMqttControlGrantStore.getState().grant?.renewalFailed).toBe(false);
    expect(getMqttBrokerCredential()?.username).toBe("gcs-op-3");
    expect(reason()).toBe("grant-unconfirmed");
  });

  it("mints on the operator's request even though a live grant is held", async () => {
    const first = ensureGrant();
    b.mints[0].resolve(minted(1));
    await first;
    await vi.advanceTimersByTimeAsync(TTL_MS - RENEW_LEAD_MS);
    b.mints[1].reject(new Error("network unreachable"));
    await settle();
    expect(useMqttControlGrantStore.getState().grant?.renewalFailed).toBe(true);

    // The one state `ensureGrant` cannot fix: a grant is held, so nothing needs
    // obtaining, but its renewal has failed. The operator's click must mint.
    const asked = requestGrant();
    b.mints[b.mints.length - 1].resolve(minted(4));
    await asked;
    expect(useMqttControlGrantStore.getState().grant?.renewalFailed).toBe(false);
    expect(getMqttBrokerCredential()?.username).toBe("gcs-op-4");
  });
});

describe("mqtt control grant — the secret", () => {
  it("never reaches the store, localStorage, or sessionStorage", async () => {
    const pending = ensureGrant();
    b.mints[0].resolve(minted(1));
    await pending;

    // It went somewhere usable...
    expect(getMqttBrokerCredential()?.password).toBe("secret-1");

    // ...and nowhere serialisable. The store is what a devtools middleware, a
    // persist wrapper, or a serialising log would walk.
    const snapshot = JSON.stringify(useMqttControlGrantStore.getState());
    expect(snapshot).not.toContain("secret-1");
    expect(snapshot).toContain("gcs-op-1");

    // Seed each storage so the walk below has something to walk: an empty
    // storage (or one whose `length` is undefined) would make this assertion
    // vacuous, which is how it passed while asserting nothing.
    for (const store of [localStorage, sessionStorage]) {
      store.setItem("canary", "not-the-secret");
      expect(store.length).toBeGreaterThan(0);
      let walked = 0;
      for (let i = 0; i < store.length; i += 1) {
        const key = store.key(i);
        walked += 1;
        expect(store.getItem(key ?? "") ?? "").not.toContain("secret-1");
      }
      expect(walked).toBe(store.length);
    }
  });

  it("hands the transport a publish claim only for a covered, live grant", async () => {
    const pending = ensureGrant();
    b.mints[0].resolve(minted(1));
    await pending;

    expect(relayWriteAuthFor(DEVICE)).toEqual({
      username: "gcs-op-1",
      password: "secret-1",
      canPublish: true,
    });
    // A grant for a DIFFERENT device is not a grant for this one.
    expect(relayWriteAuthFor("drone-b")).toBeUndefined();
    expect(relayWriteAuthFor(null)).toBeUndefined();

    vi.setSystemTime(BASE_TIME + TTL_MS + 1);
    expect(relayWriteAuthFor(DEVICE)).toBeUndefined();
  });
});

describe("mqtt control grant — the server's view", () => {
  it("takes the broker's confirmation from the grant row", async () => {
    const pending = ensureGrant();
    b.mints[0].resolve(minted(1));
    await pending;
    expect(reason()).toBe("grant-unconfirmed");

    // Another tab, or a previous session, already proved this principal.
    syncServerGrant({
      principal: "gcs-op-1",
      deviceIds: [DEVICE],
      expiresAt: Date.now() + TTL_MS,
      lastConfirmedAt: Date.now(),
    });
    expect(reason()).toBe("grant-active");
  });

  it("ignores a server view that predates the mint, then drops on a real revoke", async () => {
    const pending = ensureGrant();
    b.mints[0].resolve(minted(1));
    await pending;

    // The live query has not round-tripped yet, so it still reports the state
    // from before the mint. Treating that as a revocation would kill a grant
    // one moment after issuing it.
    syncServerGrant(null);
    expect(getMqttBrokerCredential()?.username).toBe("gcs-op-1");
    expect(reason()).toBe("grant-unconfirmed");

    await vi.advanceTimersByTimeAsync(SERVER_SETTLE_MS + 1);
    // Now it is the server's settled answer: revoked, or superseded elsewhere.
    syncServerGrant(null);
    expect(getMqttBrokerCredential()).toBeNull();
    expect(relayWriteAuthFor(DEVICE)).toBeUndefined();
    expect(reason()).toBe("no-grant");
  });

  it("supersedes a live grant it cannot use, and does so only once", async () => {
    // A reload inside the grant's hour: the row is live and the plaintext that
    // went with it is gone, so the credential this tab holds is nothing at all.
    // Minting supersedes the row, which is how a reload recovers control.
    syncServerGrant({
      principal: "gcs-op-elsewhere",
      deviceIds: [DEVICE],
      expiresAt: Date.now() + TTL_MS,
      lastConfirmedAt: null,
    });
    const first = ensureGrant();
    b.mints[0].resolve(minted(1));
    await first;
    expect(getMqttBrokerCredential()?.username).toBe("gcs-op-1");

    // Another tab now mints over us. Left unbounded, each tab would supersede
    // the other forever, one mint per round trip, so the second observation
    // leaves it to the operator.
    await vi.advanceTimersByTimeAsync(SERVER_SETTLE_MS + 1);
    syncServerGrant({
      principal: "gcs-op-other-tab",
      deviceIds: [DEVICE],
      expiresAt: Date.now() + TTL_MS,
      lastConfirmedAt: null,
    });
    expect(getMqttBrokerCredential()).toBeNull();

    await ensureGrant();
    expect(b.mints).toHaveLength(1);
    expect(reason()).toBe("no-grant");

    // The operator's own click is not bounded: it is a decision, not a race.
    const asked = requestGrant();
    b.mints[1].resolve(minted(2));
    await asked;
    expect(getMqttBrokerCredential()?.username).toBe("gcs-op-2");
  });

  it("releases the grant on sign-out, locally first and then server-side", async () => {
    const pending = ensureGrant();
    b.mints[0].resolve(minted(1));
    await pending;

    await releaseGrant();
    expect(getMqttBrokerCredential()).toBeNull();
    expect(useMqttControlGrantStore.getState().grant).toBeNull();
    expect(b.revokes()).toBe(1);
    // The epoch bump is what tears down the sockets still authenticated as the
    // released principal.
    expect(useMqttControlGrantStore.getState().credentialEpoch).toBe(2);
  });
});
