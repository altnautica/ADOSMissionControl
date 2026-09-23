/**
 * @module shared/node-reach-block.test
 * @description Reach provenance: the operator must be able to tell which
 * address answered, and be told when a stored one stopped answering.
 *
 * A LAN-paired node carries up to three candidate reaches and no surface named
 * any of them after the pair card closed, so a node going offline looked
 * identical whether the agent was down, its `.local` name had stopped
 * resolving, or its DHCP lease had moved.
 *
 * The honesty properties pinned here: nothing is claimed before a reading
 * exists; a failure keeps naming the address that last worked; and the only
 * diagnosis offered is the one the transport actually proves.
 *
 * @license GPL-3.0-only
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

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
      key: (i: number) => Array.from(mem.keys())[i] ?? null,
      get length() {
        return mem.size;
      },
    },
  });
});

import messages from "../../../../../locales/en.json";
import { NodeReachBlock } from "../NodeReachBlock";
import { useLocalNodesStore, type LocalNode } from "@/stores/local-nodes-store";
import { reachErrorBucket } from "@/lib/nodes/local-reach";
import { PairClientError } from "@/lib/agent/local-pair-client";

const DEVICE = "dev-1";
const NOW = Date.now();

function seed(over: Partial<LocalNode> = {}) {
  useLocalNodesStore.setState({
    nodes: [
      {
        deviceId: DEVICE,
        name: "Example drone",
        hostname: "http://drone.local:8080",
        apiKey: "k",
        profile: "drone",
        ipv4: "192.168.1.50",
        pairedAt: NOW,
        ...over,
      },
    ],
  });
}

function renderBlock() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <NodeReachBlock deviceId={DEVICE} />
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  useLocalNodesStore.setState({ nodes: [] });
});

describe("NodeReachBlock", () => {
  it("renders nothing before any reach has been recorded", () => {
    seed();
    const { container } = renderBlock();
    expect(container.textContent).toBe("");
  });

  it("names the address that answered", () => {
    seed({ lastReachOk: { host: "http://192.168.1.50:8080", at: NOW - 4000 } });
    renderBlock();
    // The scheme and the implicit :8080 are not what the operator typed.
    expect(screen.getByText(/Reached at 192\.168\.1\.50/)).toBeTruthy();
    expect(screen.queryByText(/http:\/\//)).toBeNull();
  });

  it("counts from the latest answer, not the coalesced stored stamp", () => {
    // Stored 19 s ago; the node has just answered again at the same address,
    // a success the store does not re-persist inside its coalescing window.
    seed({ lastReachOk: { host: "http://192.168.1.50:8080", at: Date.now() - 19_000 } });
    useLocalNodesStore.getState().recordReachOk(DEVICE, "http://192.168.1.50:8080");
    expect(useLocalNodesStore.getState().nodes[0].lastReachOk?.at).toBeLessThan(Date.now() - 18_000);
    renderBlock();
    expect(screen.getByText(/Reached at 192\.168\.1\.50/).textContent).not.toMatch(/1[89]s/);
  });

  it("flags a stored reach that failed, and says only what is provable", () => {
    seed({
      lastReachError: {
        host: "http://drone.local:8080",
        error: "no-answer",
        at: NOW - 12_000,
      },
    });
    renderBlock();
    const line = screen.getByText(/Last tried drone\.local/);
    expect(line.textContent).toMatch(/nothing answered/);
    // Never a fabricated diagnosis: through the server-side proxy a DNS
    // failure and a dead board are the same 502.
    expect(line.textContent).not.toMatch(/did not resolve|DNS/i);
  });

  it("distinguishes answered-and-refused from unreachable", () => {
    seed({
      lastReachError: {
        host: "http://drone.local:8080",
        error: "refused",
        at: NOW,
      },
    });
    renderBlock();
    expect(screen.getByText(/answered and refused/)).toBeTruthy();
    expect(screen.queryByText(/nothing answered/)).toBeNull();
  });

  it("keeps naming the address that last worked through a failure", () => {
    seed({
      lastReachOk: { host: "http://192.168.1.50:8080", at: NOW - 60_000 },
      lastReachError: {
        host: "http://drone.local:8080",
        error: "no-answer",
        at: NOW,
      },
    });
    renderBlock();
    expect(screen.getByText(/Last worked at 192\.168\.1\.50/)).toBeTruthy();
  });

  it("switches the node onto the offered address in one click", () => {
    seed({
      lastReachError: {
        host: "http://drone.local:8080",
        error: "no-answer",
        at: NOW,
      },
    });
    renderBlock();
    fireEvent.click(screen.getByText(/Use 192\.168\.1\.50/));
    // Rewrites the stored reach rather than re-pairing, which would mint a new
    // key and orphan the card. Stored as a base URL, because every consumer
    // appends a path to `hostname` verbatim.
    const node = useLocalNodesStore.getState().nodes[0];
    expect(node.hostname).toBe("http://192.168.1.50:8080");
    expect(node.apiKey).toBe("k");
  });

  it("offers no alternative when the stored reach is already the only one", () => {
    seed({
      hostname: "http://192.168.1.50:8080",
      ipv4: "192.168.1.50",
      lastReachError: {
        host: "http://192.168.1.50:8080",
        error: "no-answer",
        at: NOW,
      },
    });
    renderBlock();
    expect(screen.queryByText(/^Use /)).toBeNull();
  });

  it("says a still-starting node answered and offers no address switch", () => {
    seed({
      lastReachError: {
        host: "http://drone.local:8080",
        error: reachErrorBucket(new PairClientError("pairAgentNotReadyError", "x")),
        at: NOW,
      },
    });
    renderBlock();
    expect(screen.getByText(/answered but was not ready/)).toBeTruthy();
    expect(screen.queryByText(/nothing answered/)).toBeNull();
    // The name works; steering the operator onto the IPv4 would rewrite it.
    expect(screen.queryByText(/^Use /)).toBeNull();
  });

  it("does not claim the node answered when the proxy refused the host", () => {
    seed({
      lastReachError: {
        host: "http://drone.local:8080",
        error: reachErrorBucket(new PairClientError("hostNotPrivateError", "x")),
        at: NOW,
      },
    });
    renderBlock();
    expect(screen.queryByText(/answered/)).toBeNull();
    expect(screen.getByText(/not tried/)).toBeTruthy();
  });

  it("renders an unrecognised persisted bucket as unknown, never a raw key", () => {
    seed({
      lastReachError: {
        host: "http://drone.local:8080",
        error: "not-a-bucket",
        at: NOW,
      },
    });
    renderBlock();
    expect(screen.getByText(/the attempt failed/)).toBeTruthy();
  });
});

describe("reach provenance recording", () => {
  it("clears a recorded failure the moment a reach succeeds", () => {
    seed({
      lastReachError: {
        host: "http://drone.local:8080",
        error: "no-answer",
        at: NOW - 30_000,
      },
    });
    useLocalNodesStore
      .getState()
      .recordReachOk(DEVICE, "http://192.168.1.50:8080");
    const node = useLocalNodesStore.getState().nodes[0];
    expect(node.lastReachError).toBeUndefined();
    expect(node.lastReachOk?.host).toBe("http://192.168.1.50:8080");
  });

  it("writes a reach CHANGE through immediately rather than coalescing it", () => {
    seed({ lastReachOk: { host: "http://drone.local:8080", at: NOW } });
    useLocalNodesStore
      .getState()
      .recordReachOk(DEVICE, "http://192.168.1.50:8080");
    expect(useLocalNodesStore.getState().nodes[0].lastReachOk?.host).toBe(
      "http://192.168.1.50:8080",
    );
  });

  it("classifies a refusal as answered, not as unreachable", () => {
    expect(reachErrorBucket(new PairClientError("pairKeyRejectedError", "x"))).toBe(
      "refused",
    );
    expect(reachErrorBucket(new PairClientError("pairPinRequiredError", "x"))).toBe(
      "refused",
    );
    expect(reachErrorBucket(new PairClientError("pairUnreachableError", "x"))).toBe(
      "no-answer",
    );
    expect(reachErrorBucket(new PairClientError("pairAgentFaultError", "x"))).toBe(
      "fault",
    );
    expect(reachErrorBucket(new PairClientError("pairTimedOutError", "x"))).toBe(
      "not-ready",
    );
    // An unmapped failure is reported as unknown rather than guessed at.
    expect(reachErrorBucket(new Error("boom"))).toBe("unknown");
  });
});
