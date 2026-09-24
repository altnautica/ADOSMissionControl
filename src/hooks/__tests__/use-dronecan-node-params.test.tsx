/**
 * @license GPL-3.0-only
 *
 * The DroneCAN parameter editor shows one node. Moving it to another node must
 * not keep the first node's parameters or dirty edits (a Save would write them
 * to the second node), nor land a walk that was still reading the first node.
 */

import { describe, it, expect, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { ValueTag } from "@/lib/dronecan/dsdl/param-getset";
import { useDroneCanNodeParams, type DroneCanClient } from "../use-dronecan-node-params";

const EMPTY = { tag: ValueTag.Empty } as const;

function clientWith(names: string[]): DroneCanClient {
  return {
    paramGet: vi.fn(async (_node: number, index: number) => ({
      name: names[index] ?? "",
      value: names[index] ? { tag: ValueTag.Integer, value: BigInt(index + 1) } : EMPTY,
      default_value: EMPTY,
      min_value: EMPTY,
      max_value: EMPTY,
    })),
    paramSet: vi.fn(),
    paramExecuteOpcode: vi.fn(),
    restart: vi.fn(),
  } as Partial<DroneCanClient> as DroneCanClient;
}

describe("useDroneCanNodeParams across a node switch", () => {
  it("drops the previous node's parameters and dirty edits", async () => {
    const client = clientWith(["ESC_INDEX", "ESC_RATE"]);
    const { result, rerender } = renderHook(
      ({ nodeId }: { nodeId: number }) => useDroneCanNodeParams(client, nodeId),
      { initialProps: { nodeId: 10 } },
    );
    await act(async () => {
      await result.current.refresh();
    });
    act(() => result.current.setLocal("ESC_RATE", { tag: ValueTag.Integer, value: 400n }));
    expect(result.current.dirty.has("ESC_RATE")).toBe(true);

    rerender({ nodeId: 11 });

    expect(result.current.params.size).toBe(0);
    expect(result.current.dirty.size).toBe(0);
  });
});
