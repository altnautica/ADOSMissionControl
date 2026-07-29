/**
 * Verifies the plugin registry compat hook. The SoC gate is the
 * load-bearing test here: a plugin manifest that declares
 * `supported_boards: ["rk3582"]` must compat-pass on a Radxa ROCK 5C
 * Lite whose board.model is "rock-5c-lite" and board.name is
 * "Radxa ROCK 5C Lite". Before this change the matcher only looked at
 * model + name, so SoC entries in manifests were silently dead weight.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";

import { useRegistryCompatibility } from "@/components/plugins/install-dialog/use-registry-compatibility";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import { useAgentSystemStore } from "@/stores/agent-system-store";
import type { AgentStatus } from "@/lib/agent/types";

const capsInitial = useAgentCapabilitiesStore.getState();
const sysInitial = useAgentSystemStore.getState();

function statusFor(board: {
  name: string;
  model: string;
  soc: string;
  version?: string;
}): AgentStatus {
  return {
    version: board.version ?? "0.36.2",
    uptime_seconds: 100,
    board: {
      name: board.name,
      model: board.model,
      tier: 4,
      ram_mb: 16384,
      cpu_cores: 8,
      vendor: "Radxa",
      soc: board.soc,
      arch: "aarch64",
      hw_video_codecs: [],
    },
    health: {
      cpu_percent: 1,
      memory_percent: 1,
      disk_percent: 1,
      temperature: 30,
      timestamp: new Date().toISOString(),
    },
    fc_connected: false,
  } as unknown as AgentStatus;
}

beforeEach(() => {
  useAgentCapabilitiesStore.setState({ ...capsInitial, loaded: true }, true);
});

afterEach(() => {
  useAgentCapabilitiesStore.setState(capsInitial, true);
  useAgentSystemStore.setState(sysInitial, true);
});

describe("useRegistryCompatibility — SoC matching", () => {
  it("matches a manifest declaring a SoC against a board with that SoC", () => {
    useAgentSystemStore.getState().setStatus(
      statusFor({
        name: "Radxa ROCK 5C Lite",
        model: "rock-5c-lite",
        soc: "RK3582",
      }),
    );

    const { result } = renderHook(() =>
      useRegistryCompatibility({
        agent_min_version: "0.13.0",
        supported_boards: ["rk3582"],
      }),
    );

    expect(result.current.compatible).toBe(true);
    expect(result.current.reason).toBeUndefined();
  });

  it("falls back to model match when SoC is not in supported_boards", () => {
    useAgentSystemStore.getState().setStatus(
      statusFor({
        name: "Radxa ROCK 5C Lite",
        model: "rock-5c-lite",
        soc: "RK3582",
      }),
    );

    const { result } = renderHook(() =>
      useRegistryCompatibility({
        agent_min_version: "0.13.0",
        supported_boards: ["rock-5c-lite"],
      }),
    );

    expect(result.current.compatible).toBe(true);
  });

  it("rejects when neither model, name, nor SoC matches", () => {
    useAgentSystemStore.getState().setStatus(
      statusFor({
        name: "Radxa ROCK 5C Lite",
        model: "rock-5c-lite",
        soc: "RK3582",
      }),
    );

    const { result } = renderHook(() =>
      useRegistryCompatibility({
        agent_min_version: "0.13.0",
        supported_boards: ["jetson-orin-nano"],
      }),
    );

    expect(result.current.compatible).toBe(false);
    expect(result.current.reason).toBe("board");
  });

  it("matches case-insensitively on SoC (RK3582 manifest, rk3582 board, mixed)", () => {
    useAgentSystemStore.getState().setStatus(
      statusFor({
        name: "Radxa ROCK 5C Lite",
        model: "rock-5c-lite",
        soc: "rk3582",
      }),
    );

    const { result } = renderHook(() =>
      useRegistryCompatibility({
        agent_min_version: "0.13.0",
        supported_boards: ["RK3582"],
      }),
    );

    expect(result.current.compatible).toBe(true);
  });

  it("passes when supported_boards is omitted entirely", () => {
    useAgentSystemStore.getState().setStatus(
      statusFor({
        name: "Anything",
        model: "any-model",
        soc: "any-soc",
      }),
    );

    const { result } = renderHook(() =>
      useRegistryCompatibility({ agent_min_version: "0.10.0" }),
    );

    expect(result.current.compatible).toBe(true);
  });
});

// ── disable matrix on the card ──────────────────────────────
//
// These tests reason about the gating logic that lives inline in
// RegistryPluginCard.tsx (per-node surface). The contract: "no_agent",
// "version", AND "board" are all hard blocks — an operator must never see
// a clickable Install next to "Not compatible with this drone's board".
// The only surviving soft state is a still-loading version row, which
// blocks nothing.
describe("RegistryPluginCard disable matrix (semantic)", () => {
  function classify(opts: {
    installed?: boolean;
    isLoading?: boolean;
    latestVersionRow: object | null;
    compat: { compatible: boolean; reason?: "no_agent" | "version" | "board" };
  }): { disabled: boolean; warning: boolean } {
    const compatBlock = !opts.compat.compatible;
    const disabled = Boolean(opts.installed || opts.isLoading || compatBlock);
    const warning = !opts.latestVersionRow && !disabled;
    return { disabled, warning };
  }

  it("hard-blocks when the agent is disconnected", () => {
    const out = classify({
      latestVersionRow: null,
      compat: { compatible: false, reason: "no_agent" },
    });
    expect(out.disabled).toBe(true);
    expect(out.warning).toBe(false);
  });

  it("hard-blocks on version mismatch", () => {
    const out = classify({
      latestVersionRow: { version: "1.0.0" },
      compat: { compatible: false, reason: "version" },
    });
    expect(out.disabled).toBe(true);
  });

  it("soft-warns + keeps clickable when latestVersionRow is missing but compat passes", () => {
    const out = classify({
      latestVersionRow: null,
      compat: { compatible: true },
    });
    expect(out.disabled).toBe(false);
    expect(out.warning).toBe(true);
  });

  it("hard-blocks on board mismatch (defect fix: no longer a clickable soft warning)", () => {
    const out = classify({
      latestVersionRow: { version: "1.0.0" },
      compat: { compatible: false, reason: "board" },
    });
    expect(out.disabled).toBe(true);
    expect(out.warning).toBe(false);
  });

  it("disables when already installed", () => {
    const out = classify({
      installed: true,
      latestVersionRow: { version: "1.0.0" },
      compat: { compatible: true },
    });
    expect(out.disabled).toBe(true);
  });

  it("disables during an in-flight install", () => {
    const out = classify({
      isLoading: true,
      latestVersionRow: { version: "1.0.0" },
      compat: { compatible: true },
    });
    expect(out.disabled).toBe(true);
  });

  it("happy path: all gates pass, no warning, no disable", () => {
    const out = classify({
      latestVersionRow: { version: "1.0.0" },
      compat: { compatible: true },
    });
    expect(out.disabled).toBe(false);
    expect(out.warning).toBe(false);
  });
});
