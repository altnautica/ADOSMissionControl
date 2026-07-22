/**
 * Tests for the board's bulk dispatch: that one confirmation covers the batch
 * and every selected node is actually commanded.
 *
 * The confirm seam holds a single pending request and cancels any prior one, so
 * a naive loop over the dispatcher would have each node's dialog cancel the
 * last and quietly abort most of the batch. This is the test that would catch
 * that regression.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Both stores under test are persisted; bind an in-memory localStorage first.
vi.hoisted(() => {
  const mem = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: {
      getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
      clear: () => mem.clear(),
      key: () => null,
      get length() {
        return mem.size;
      },
    },
  });
});

import { dispatchSkillForNodes } from "@/components/command/nodes-view/use-node-skills";
import { useSkillRegistry, type Skill, type SkillTargetNode } from "@/lib/skills";
import { useSkillConfirmStore } from "@/stores/skill-confirm-store";
import { useLocalNodesStore, type LocalNode } from "@/stores/local-nodes-store";
import { useCommandFleetStore } from "@/stores/command-fleet-store";

/**
 * Each test uses its own device ids. The dispatcher debounces a repeat one-shot
 * per (node, skill) for 750 ms, so reusing ids across tests would have the
 * debounce, not the behaviour under test, decide the outcome.
 */
function nodesFor(suffix: string): SkillTargetNode[] {
  return ["alpha", "bravo"].map((name) => ({
    _id: `node:${name}-${suffix}`,
    deviceId: `${name}-${suffix}`,
  }));
}

function lanNode(deviceId: string): LocalNode {
  return {
    deviceId,
    name: deviceId,
    hostname: `http://${deviceId}.example:8080`,
    apiKey: `key-${deviceId}`,
    profile: "drone",
    pairedAt: 1,
  } as LocalNode;
}

/** Records who it was dispatched for, and whether a dialog was requested. */
function probeSkill(seen: string[]): Skill {
  return {
    id: "probe",
    label: "skills.rth",
    icon: "Home",
    category: "flight",
    source: "builtin",
    toggle: false,
    armRequirement: "any",
    confirm: {
      title: "t",
      message: "m",
      confirmLabel: "c",
      variant: "danger",
      typedPhrase: "RTL",
    },
    // Mirrors every real flight built-in: no command surface, no press.
    getState: (ctx) =>
      ctx.protocol
        ? { kind: "idle" }
        : { kind: "disabled", reason: "skills.reason.noFcLink" },
    activate: async (ctx) => {
      seen.push(ctx.droneId);
    },
  };
}

/** Make `nodes` LAN-paired and give each a live arm-state reading. */
function seedReachable(nodes: SkillTargetNode[]): void {
  useLocalNodesStore.setState({ nodes: nodes.map((n) => lanNode(n.deviceId)) });
  // A command surface is only offered for a node whose arm state is being read,
  // so each node needs a telemetry snapshot to be commandable at all.
  useCommandFleetStore.setState({
    cloudStatuses: Object.fromEntries(
      nodes.map((n) => [
        n.deviceId,
        { deviceId: n.deviceId, telemetry: { armed: false } },
      ]),
    ),
  } as never);
}

beforeEach(() => {
  useLocalNodesStore.setState({ nodes: [] });
  useCommandFleetStore.setState({ cloudStatuses: {} } as never);
  useSkillConfirmStore.setState({ pending: null });
});

describe("dispatchSkillForNodes", () => {
  it("commands every node in the batch", async () => {
    const seen: string[] = [];
    const nodes = nodesFor("batch");
    seedReachable(nodes);
    useSkillRegistry.getState().register(probeSkill(seen));

    await dispatchSkillForNodes("probe", nodes, { originIsHttps: false });

    expect(seen.sort()).toEqual(["node:alpha-batch", "node:bravo-batch"]);
  });

  it("never opens a per-node dialog, so no node's confirm cancels another's", async () => {
    const seen: string[] = [];
    const nodes = nodesFor("dialog");
    seedReachable(nodes);
    useSkillRegistry.getState().register(probeSkill(seen));

    await dispatchSkillForNodes("probe", nodes, { originIsHttps: false });

    // A single pending request would have been enough to strand the rest.
    expect(useSkillConfirmStore.getState().pending).toBeNull();
    expect(seen).toHaveLength(nodes.length);
  });

  it("leaves an unreachable node uncommanded, as the dispatcher's own gate", async () => {
    // The bars pre-filter to nodes that can take the command; this is the
    // backstop that holds even if a node drops between the filter and the send.
    const seen: string[] = [];
    const nodes = nodesFor("unreachable");
    // Deliberately not seeded: no LAN credentials and no arm-state reading.
    useSkillRegistry.getState().register(probeSkill(seen));

    await dispatchSkillForNodes("probe", nodes, { originIsHttps: false });

    expect(seen).toEqual([]);
  });
});
