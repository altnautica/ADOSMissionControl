/**
 * Unpair with an unreachable node: nothing is removed until the operator
 * chooses to forget it on this GCS only.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { useEffect } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../locales/en.json";

const { forget } = vi.hoisted(() => ({ forget: vi.fn() }));
vi.mock("@/hooks/use-forget-node", () => ({ useForgetNode: () => forget }));

import { useUnpairNode } from "@/hooks/use-unpair-node";
import { boardFlightSkills } from "@/components/command/nodes-view/NodeActionsMenu";

const onDone = vi.fn();
const harness: { start: () => Promise<unknown> } = { start: async () => undefined };

function Harness() {
  const { unpair, fallbackDialog } = useUnpairNode();
  useEffect(() => {
    harness.start = () => unpair("node:dev-1", { convexId: null, name: "Alpha", onDone });
  });
  return <>{fallbackDialog}</>;
}

function mount() {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <Harness />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  forget.mockReset();
  onDone.mockReset();
});

describe("useUnpairNode", () => {
  it("asks before forgetting an unreachable node on this GCS only", async () => {
    forget
      .mockResolvedValueOnce({ ok: false, reason: "agentUnreachable", message: "timeout" })
      .mockResolvedValueOnce({ ok: true });
    mount();
    await act(() => harness.start());
    expect(onDone).not.toHaveBeenCalled();
    const confirm = screen.getByRole("button", { name: en.nodesView.unpairUnreachable.forgetHere });
    await act(async () => fireEvent.click(confirm));
    expect(forget).toHaveBeenLastCalledWith("node:dev-1", { convexId: null, localOnly: true });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("finishes without a prompt when the node releases its pairing", async () => {
    forget.mockResolvedValueOnce({ ok: true });
    mount();
    await act(() => harness.start());
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(en.nodesView.unpairUnreachable.title)).toBeNull();
  });
});

describe("boardFlightSkills", () => {
  it("offers no flight actions on a ground station or workstation", () => {
    expect(boardFlightSkills("ground-station", true)).toEqual([]);
    expect(boardFlightSkills("workstation", false)).toEqual([]);
  });

  it("offers a Visor with a hub only disarm and kill", () => {
    expect(boardFlightSkills("visor", true)).toEqual(["disarm", "kill"]);
    expect(boardFlightSkills("visor", false)).toEqual([]);
  });

  it("offers a drone every flight action", () => {
    expect(boardFlightSkills("drone", false)).toContain("arm");
  });
});
