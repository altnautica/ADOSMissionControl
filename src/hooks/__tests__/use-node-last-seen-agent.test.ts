/**
 * @license GPL-3.0-only
 *
 * A node's agent is judged live from its own presence heartbeat and status
 * row; an FC heartbeat alone (a bare FC link) does not make it online.
 */

import { afterEach, describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";

import { useNodeLastSeen } from "../use-node-last-seen";
import { useNodeRegistryStore } from "@/stores/node-registry";

afterEach(() => useNodeRegistryStore.setState({ nodes: {} } as never));

describe("useNodeLastSeen", () => {
  it("ignores an FC heartbeat", () => {
    useNodeRegistryStore.setState({
      nodes: { "node:dev-1": { presence: { lastHeartbeat: 0 }, fc: { lastHeartbeat: 5000 } } },
    } as never);
    expect(renderHook(() => useNodeLastSeen("dev-1")).result.current).toBeNull();
  });

  it("reads the presence heartbeat", () => {
    useNodeRegistryStore.setState({
      nodes: { "node:dev-1": { presence: { lastHeartbeat: 7000 }, fc: { lastHeartbeat: 9000 } } },
    } as never);
    expect(renderHook(() => useNodeLastSeen("dev-1")).result.current).toBe(7000);
  });
});
