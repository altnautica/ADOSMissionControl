/**
 * @license GPL-3.0-only
 *
 * Unit tests for the canonical node registry: nodeId derivation, the
 * presence-merge semantics across the local and cloud transports, FC
 * attach/detach, connection + telemetry merges, and the garbage-collection
 * rule (a row survives while it has a presence source OR an attached FC, and
 * is removed only when both are gone).
 *
 * The store ships dark, so these tests are its only consumer.
 */

import { describe, it, expect, beforeEach } from "vitest";

import { useNodeRegistryStore } from "../node-registry/node-registry-store";
import {
  resolveNodeId,
  shouldRemoveEntry,
  mergePresence,
  emptyPresence,
} from "../node-registry/reconcile";
import type { NodePresence } from "../node-registry/types";

function store() {
  return useNodeRegistryStore.getState();
}

beforeEach(() => {
  useNodeRegistryStore.setState({ nodes: {}, lastUpdate: 0 });
});

// ── resolveNodeId ────────────────────────────────────────────────

describe("resolveNodeId", () => {
  it("derives a stable node id from an agent device id", () => {
    expect(resolveNodeId("e8db38b4")).toBe("node:e8db38b4");
  });

  it("is stable across calls for the same device id (collapses transports)", () => {
    expect(resolveNodeId("abc123")).toBe(resolveNodeId("abc123"));
  });

  it("trims whitespace before forming the node id", () => {
    expect(resolveNodeId("  abc  ")).toBe("node:abc");
  });

  it("generates a random fc id for a direct FC with no device id", () => {
    const a = resolveNodeId();
    const b = resolveNodeId();
    expect(a.startsWith("fc:")).toBe(true);
    expect(b.startsWith("fc:")).toBe(true);
    // Two FC-only nodes must not collide.
    expect(a).not.toBe(b);
  });

  it("treats an empty / whitespace device id as a direct FC", () => {
    expect(resolveNodeId("").startsWith("fc:")).toBe(true);
    expect(resolveNodeId("   ").startsWith("fc:")).toBe(true);
  });
});

// ── pure mergePresence semantics ─────────────────────────────────

describe("mergePresence", () => {
  it("adds the source without duplicating it", () => {
    const once = mergePresence(emptyPresence(), { name: "n" }, "local");
    expect(once.sources).toEqual(["local"]);
    const twice = mergePresence(once, { name: "n" }, "local");
    expect(twice.sources).toEqual(["local"]);
  });

  it("unions both transports onto one presence", () => {
    const local = mergePresence(emptyPresence(), {}, "local");
    const both = mergePresence(local, {}, "cloud");
    expect(both.sources).toEqual(["local", "cloud"]);
  });

  it("keeps the freshest heartbeat", () => {
    const a = mergePresence(emptyPresence(), { lastHeartbeat: 100 }, "local");
    const b = mergePresence(a, { lastHeartbeat: 50 }, "cloud");
    expect(b.lastHeartbeat).toBe(100);
    const c = mergePresence(b, { lastHeartbeat: 200 }, "local");
    expect(c.lastHeartbeat).toBe(200);
  });

  it("lets cloud override an identity field set by local", () => {
    const local = mergePresence(
      emptyPresence(),
      { profile: "drone", role: "direct" },
      "local",
    );
    const cloud = mergePresence(
      local,
      { profile: "ground-station", role: "relay" },
      "cloud",
    );
    expect(cloud.profile).toBe("ground-station");
    expect(cloud.role).toBe("relay");
  });

  it("does not let a sparse local patch clobber a cloud-set optional field", () => {
    const cloud = mergePresence(
      emptyPresence(),
      { cloudPosture: "cloud", cloudDeviceId: "cd-1" },
      "cloud",
    );
    // Local heartbeat arrives carrying no posture/cloudDeviceId.
    const merged = mergePresence(cloud, { name: "renamed" }, "local");
    expect(merged.cloudPosture).toBe("cloud");
    expect(merged.cloudDeviceId).toBe("cd-1");
    expect(merged.name).toBe("renamed");
  });

  it("carries the relay hop and lists the relayed source", () => {
    const relayed = mergePresence(
      emptyPresence(),
      { deviceId: "drone-x", reachedVia: "node:gs-1", lastHeartbeat: 7 },
      "relayed",
    );
    expect(relayed.sources).toEqual(["relayed"]);
    expect(relayed.reachedVia).toBe("node:gs-1");
  });

  it("a later direct patch joins the relayed entry and keeps the hop as secondary provenance", () => {
    // Field case: the drone is first seen relayed (via the GS), then paired
    // directly. Both sources land on one presence; the hop is preserved so the
    // provenance UX can still note it, while the reach precedence prefers local.
    const relayed = mergePresence(
      emptyPresence(),
      { deviceId: "drone-x", reachedVia: "node:gs-1" },
      "relayed",
    );
    // A direct local pair carries no hop.
    const both = mergePresence(relayed, { deviceId: "drone-x" }, "local");
    expect(both.sources).toEqual(["relayed", "local"]);
    expect(both.reachedVia).toBe("node:gs-1");
  });
});

// ── shouldRemoveEntry predicate ──────────────────────────────────

describe("shouldRemoveEntry", () => {
  const base = {
    nodeId: "node:x",
    connection: { fcConnected: false },
  };

  it("keeps an entry with a presence source", () => {
    const presence: NodePresence = { ...emptyPresence(), sources: ["local"] };
    expect(
      shouldRemoveEntry({ ...base, presence, fc: { managedId: null } }),
    ).toBe(false);
  });

  it("keeps an entry with an attached FC and no presence", () => {
    expect(
      shouldRemoveEntry({
        ...base,
        presence: emptyPresence(),
        fc: { managedId: "fc-7" },
      }),
    ).toBe(false);
  });

  it("removes an entry with neither presence nor FC", () => {
    expect(
      shouldRemoveEntry({
        ...base,
        presence: emptyPresence(),
        fc: { managedId: null },
      }),
    ).toBe(true);
  });
});

// ── store: upsertPresence (local-only / cloud-only / both) ───────

describe("useNodeRegistryStore.upsertPresence", () => {
  it("creates a local-only node", () => {
    const id = resolveNodeId("dev-local");
    store().upsertPresence(
      id,
      { deviceId: "dev-local", name: "Skynode", profile: "drone", lastHeartbeat: 10 },
      "local",
    );
    const entry = store().getEntry(id);
    expect(entry).toBeDefined();
    expect(entry?.presence.sources).toEqual(["local"]);
    expect(entry?.presence.name).toBe("Skynode");
    expect(entry?.fc.managedId).toBeNull();
  });

  it("creates a cloud-only node", () => {
    const id = resolveNodeId("dev-cloud");
    store().upsertPresence(
      id,
      {
        deviceId: "dev-cloud",
        name: "Cloud Drone",
        profile: "drone",
        cloudPosture: "cloud",
        cloudDeviceId: "cd-9",
        lastHeartbeat: 20,
      },
      "cloud",
    );
    const entry = store().getEntry(id);
    expect(entry?.presence.sources).toEqual(["cloud"]);
    expect(entry?.presence.cloudDeviceId).toBe("cd-9");
  });

  it("collapses local and cloud observations of one device onto one node", () => {
    const id = resolveNodeId("dev-both");
    store().upsertPresence(
      id,
      { deviceId: "dev-both", name: "Local Name", profile: "drone", lastHeartbeat: 5 },
      "local",
    );
    store().upsertPresence(
      id,
      {
        deviceId: "dev-both",
        name: "Cloud Name",
        profile: "ground-station",
        cloudPosture: "self_hosted",
        lastHeartbeat: 3,
      },
      "cloud",
    );
    // Exactly one entry; both sources present.
    expect(Object.keys(store().nodes)).toEqual([id]);
    const entry = store().getEntry(id);
    expect(entry?.presence.sources).toEqual(["local", "cloud"]);
    // Cloud is authoritative for identity.
    expect(entry?.presence.profile).toBe("ground-station");
    expect(entry?.presence.name).toBe("Cloud Name");
    expect(entry?.presence.cloudPosture).toBe("self_hosted");
    // Freshest heartbeat kept.
    expect(entry?.presence.lastHeartbeat).toBe(5);
  });
});

// ── store: attachFc / detachFc ───────────────────────────────────

describe("useNodeRegistryStore FC attach/detach", () => {
  it("attaches an FC to an existing agent node", () => {
    const id = resolveNodeId("dev-fc");
    store().upsertPresence(id, { deviceId: "dev-fc", name: "n" }, "local");
    store().attachFc(id, "managed-1");
    expect(store().getEntry(id)?.fc.managedId).toBe("managed-1");
  });

  it("creates an FC-only node when attaching with no prior presence", () => {
    const id = resolveNodeId(); // direct FC, fc:<random>
    store().attachFc(id, "managed-direct");
    const entry = store().getEntry(id);
    expect(entry).toBeDefined();
    expect(entry?.fc.managedId).toBe("managed-direct");
    expect(entry?.presence.sources).toEqual([]);
  });

  it("attachFc-before-presence: a later presence patch MERGES onto the FC row (no bare-row race)", () => {
    // The FC link can win the connect race: attachFc creates the row first,
    // then the presence bridge's heartbeat lands. The presence must merge onto
    // the existing entry, not be dropped — this is the bug-#3 fix.
    const id = resolveNodeId("dev-race");
    store().attachFc(id, "managed-race");
    expect(store().getEntry(id)?.fc.managedId).toBe("managed-race");
    expect(store().getEntry(id)?.presence.sources).toEqual([]);

    // Late presence patch arrives.
    store().upsertPresence(
      id,
      { deviceId: "dev-race", name: "Race", profile: "drone", lastHeartbeat: 99 },
      "local",
    );
    const entry = store().getEntry(id);
    // Single row carrying BOTH the FC and the presence.
    expect(entry?.fc.managedId).toBe("managed-race");
    expect(entry?.presence.sources).toEqual(["local"]);
    expect(entry?.presence.name).toBe("Race");
  });

  it("detachFc clears managedId but leaves a still-present node in place", () => {
    const id = resolveNodeId("dev-keep");
    store().upsertPresence(id, { deviceId: "dev-keep", name: "n" }, "local");
    store().attachFc(id, "managed-2");
    store().detachFc(id);
    const entry = store().getEntry(id);
    expect(entry).toBeDefined();
    expect(entry?.fc.managedId).toBeNull();
    // Presence source still holds the row.
    expect(entry?.presence.sources).toEqual(["local"]);
  });
});

// ── store: garbage collection rule ───────────────────────────────

describe("useNodeRegistryStore garbage collection", () => {
  it("survives while presence OR fc is present, removed when both gone (presence-first)", () => {
    const id = resolveNodeId("dev-gc1");
    // presence + fc both present.
    store().upsertPresence(id, { deviceId: "dev-gc1", name: "n" }, "local");
    store().attachFc(id, "managed-gc1");
    expect(store().getEntry(id)).toBeDefined();

    // Drop presence: fc still anchors the row.
    store().dropPresence(id, "local");
    expect(store().getEntry(id)).toBeDefined();
    expect(store().getEntry(id)?.fc.managedId).toBe("managed-gc1");

    // Detach fc: now neither anchor remains → removed.
    store().detachFc(id);
    expect(store().getEntry(id)).toBeUndefined();
  });

  it("survives while presence OR fc is present, removed when both gone (fc-first)", () => {
    const id = resolveNodeId("dev-gc2");
    store().upsertPresence(id, { deviceId: "dev-gc2", name: "n" }, "local");
    store().attachFc(id, "managed-gc2");

    // Detach fc first: presence still anchors the row.
    store().detachFc(id);
    expect(store().getEntry(id)).toBeDefined();
    expect(store().getEntry(id)?.presence.sources).toEqual(["local"]);

    // Drop the last presence source: removed.
    store().dropPresence(id, "local");
    expect(store().getEntry(id)).toBeUndefined();
  });

  it("only drops the named source; the row stays while another source remains", () => {
    const id = resolveNodeId("dev-gc3");
    store().upsertPresence(id, { deviceId: "dev-gc3", name: "n" }, "local");
    store().upsertPresence(id, { deviceId: "dev-gc3", name: "n" }, "cloud");

    store().dropPresence(id, "local");
    const entry = store().getEntry(id);
    expect(entry).toBeDefined();
    expect(entry?.presence.sources).toEqual(["cloud"]);

    store().dropPresence(id, "cloud");
    expect(store().getEntry(id)).toBeUndefined();
  });

  it("removes a presence-only node when its last source drops (no fc)", () => {
    const id = resolveNodeId("dev-gc4");
    store().upsertPresence(id, { deviceId: "dev-gc4", name: "n" }, "cloud");
    store().dropPresence(id, "cloud");
    expect(store().getEntry(id)).toBeUndefined();
  });

  it("removes a direct-FC-only node when its FC detaches", () => {
    const id = resolveNodeId(); // fc:<random>
    store().attachFc(id, "managed-gc5");
    expect(store().getEntry(id)).toBeDefined();
    store().detachFc(id);
    expect(store().getEntry(id)).toBeUndefined();
  });

  it("dropping the relayed source clears the hop and GCs a relayed-only node", () => {
    const id = resolveNodeId("drone-relayed");
    store().upsertPresence(
      id,
      { deviceId: "drone-relayed", name: "n", reachedVia: "node:gs-1" },
      "relayed",
    );
    expect(store().getEntry(id)?.presence.reachedVia).toBe("node:gs-1");
    // The GS stops reporting the peer → relayed source drops → node GCs.
    store().dropPresence(id, "relayed");
    expect(store().getEntry(id)).toBeUndefined();
  });

  it("dropping the relayed source clears the hop but keeps a directly-paired node", () => {
    const id = resolveNodeId("drone-both");
    store().upsertPresence(
      id,
      { deviceId: "drone-both", name: "n", reachedVia: "node:gs-1" },
      "relayed",
    );
    store().upsertPresence(id, { deviceId: "drone-both", name: "n" }, "local");
    store().dropPresence(id, "relayed");
    const entry = store().getEntry(id);
    expect(entry).toBeDefined();
    expect(entry?.presence.sources).toEqual(["local"]);
    // The stale hop is gone once the relay link drops (Rule 44).
    expect(entry?.presence.reachedVia).toBeUndefined();
  });
});

// ── store: connection + telemetry merges, clear ──────────────────

describe("useNodeRegistryStore connection + telemetry", () => {
  it("merges connection patches onto an existing node", () => {
    const id = resolveNodeId("dev-conn");
    store().upsertPresence(id, { deviceId: "dev-conn", name: "n" }, "local");
    store().updateConnection(id, {
      transport: "websocket",
      mavlinkUrl: "ws://host:5760",
    });
    store().updateConnection(id, { fcConnected: true });
    const conn = store().getEntry(id)?.connection;
    expect(conn?.transport).toBe("websocket");
    expect(conn?.mavlinkUrl).toBe("ws://host:5760");
    expect(conn?.fcConnected).toBe(true);
  });

  it("ignores connection / telemetry updates for an unknown node", () => {
    store().updateConnection("node:ghost", { fcConnected: true });
    store().updateFcTelemetry("node:ghost", { flightMode: "AUTO" });
    expect(store().getEntry("node:ghost")).toBeUndefined();
  });

  it("merges FC telemetry without clobbering managedId", () => {
    const id = resolveNodeId("dev-tel");
    store().upsertPresence(id, { deviceId: "dev-tel", name: "n" }, "local");
    store().attachFc(id, "managed-tel");
    store().updateFcTelemetry(id, {
      flightMode: "LOITER",
      armState: "armed",
      battery: {
        timestamp: 1,
        voltage: 16.4,
        current: 12,
        remaining: 80,
        consumed: 100,
      },
    });
    store().updateFcTelemetry(id, {
      battery: {
        timestamp: 2,
        voltage: 16.4,
        current: 12,
        remaining: 70,
        consumed: 110,
      },
    });
    const fc = store().getEntry(id)?.fc;
    expect(fc?.managedId).toBe("managed-tel");
    expect(fc?.flightMode).toBe("LOITER");
    expect(fc?.armState).toBe("armed");
    // Battery sub-fields merge rather than replace.
    expect(fc?.battery?.voltage).toBe(16.4);
    expect(fc?.battery?.remaining).toBe(70);
  });

  it("clear() empties the registry", () => {
    store().upsertPresence(
      resolveNodeId("dev-clear"),
      { deviceId: "dev-clear", name: "n" },
      "local",
    );
    expect(Object.keys(store().nodes).length).toBe(1);
    store().clear();
    expect(Object.keys(store().nodes).length).toBe(0);
  });
});
