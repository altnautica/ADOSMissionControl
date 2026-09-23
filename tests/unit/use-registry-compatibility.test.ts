/**
 * The plugin registry compat hook judges the install TARGET by its own
 * reported version and board, never another node's. Board ids match on the
 * SoC as well as the board name, case-insensitively.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";

import { useRegistryCompatibility } from "@/components/plugins/install-dialog/use-registry-compatibility";
import { useCommandFleetStore } from "@/stores/command-fleet-store";

const fleetInitial = useCommandFleetStore.getState();

function report(
  deviceId: string,
  board: { name: string; soc: string; version?: string },
): void {
  useCommandFleetStore.getState().upsertCloudStatuses([
    {
      deviceId,
      version: board.version ?? "0.36.2",
      boardName: board.name,
      boardSoc: board.soc,
      updatedAt: Date.now(),
    },
  ]);
}

afterEach(() => {
  useCommandFleetStore.setState(fleetInitial, true);
});

function compatFor(
  deviceId: string | null,
  version: { agent_min_version: string; supported_boards?: string[] },
) {
  return renderHook(() => useRegistryCompatibility(version, { deviceId })).result
    .current;
}

describe("useRegistryCompatibility", () => {
  it("judges the target's board, not another reporting node's", () => {
    report("gs-1", { name: "Raspberry Pi 3", soc: "bcm2710a1" });
    report("drone-7", { name: "Radxa ROCK 5C Lite", soc: "RK3582" });

    const rkOnly = { agent_min_version: "0.13.0", supported_boards: ["rk3582"] };
    expect(compatFor("drone-7", rkOnly).compatible).toBe(true);
    expect(compatFor("gs-1", rkOnly)).toMatchObject({
      compatible: false,
      reason: "board",
      detail: "Raspberry Pi 3",
    });
  });

  it("gates on the target having reported, not on some other node being connected", () => {
    report("gs-1", { name: "Raspberry Pi 3", soc: "bcm2710a1" });
    expect(compatFor("drone-7", { agent_min_version: "0.10.0" }).reason).toBe(
      "no_agent",
    );
    expect(compatFor(null, { agent_min_version: "0.10.0" }).reason).toBe("no_agent");
  });

  it("gates on the target's agent version", () => {
    report("drone-7", { name: "Radxa ROCK 5C Lite", soc: "rk3582", version: "0.12.9" });
    expect(compatFor("drone-7", { agent_min_version: "0.13.0" })).toMatchObject({
      compatible: false,
      reason: "version",
      detail: "0.13.0",
    });
  });

  it("matches the board name as well as the SoC, case-insensitively", () => {
    report("drone-7", { name: "Radxa ROCK 5C Lite", soc: "rk3582" });
    expect(
      compatFor("drone-7", {
        agent_min_version: "0.13.0",
        supported_boards: ["RK3582"],
      }).compatible,
    ).toBe(true);
    expect(
      compatFor("drone-7", {
        agent_min_version: "0.13.0",
        supported_boards: ["radxa rock 5c lite"],
      }).compatible,
    ).toBe(true);
    expect(
      compatFor("drone-7", {
        agent_min_version: "0.13.0",
        supported_boards: ["jetson-orin-nano"],
      }).reason,
    ).toBe("board");
  });

  it("passes any board when supported_boards is omitted", () => {
    report("drone-7", { name: "Anything", soc: "any-soc" });
    expect(compatFor("drone-7", { agent_min_version: "0.10.0" }).compatible).toBe(true);
  });
});
