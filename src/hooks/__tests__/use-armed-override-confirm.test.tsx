/**
 * @license GPL-3.0-only
 *
 * An action the agent refuses because the vehicle is armed is resent with the
 * override only after the operator confirms; a declined prompt never resends.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

import {
  AgentArmedRefusal,
  AgentHttpError,
  agentRequest,
} from "@/lib/agent/agent-client/transport";
import { useArmedOverrideConfirm } from "../use-armed-override-confirm";

const ARMED_BODY = JSON.stringify({
  error: "E_ARMED",
  message: "Vehicle is armed",
  override: "force",
});

function Harness({
  attempt,
  onSettled,
}: {
  attempt: (force: boolean) => Promise<string>;
  onSettled: (outcome: unknown) => void;
}) {
  const { withArmedOverride, armedOverrideDialog } = useArmedOverrideConfirm();
  return (
    <>
      <button onClick={() => void withArmedOverride(attempt).then(onSettled, onSettled)}>run</button>
      {armedOverrideDialog}
    </>
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("agentRequest armed refusal mapping", () => {
  it("maps a 409 E_ARMED answer to AgentArmedRefusal", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(ARMED_BODY, { status: 409 })));
    const err = await agentRequest({ baseUrl: "http://192.168.1.50:8080", apiKey: "k" }, "/api/x", {
      method: "POST",
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AgentArmedRefusal);
    expect(err).toBeInstanceOf(AgentHttpError);
    expect((err as AgentArmedRefusal).status).toBe(409);
  });

  it("keeps any other 409 a plain AgentHttpError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "E_BUSY" }), { status: 409 })),
    );
    const err = await agentRequest({ baseUrl: "http://192.168.1.50:8080", apiKey: null }, "/api/x").catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(AgentHttpError);
    expect(err).not.toBeInstanceOf(AgentArmedRefusal);
  });
});

describe("useArmedOverrideConfirm", () => {
  it("retries with force after the operator confirms", async () => {
    const attempt = vi.fn(async (force: boolean) => {
      if (!force) throw new AgentArmedRefusal(ARMED_BODY);
      return "restarted";
    });
    const onSettled = vi.fn();
    render(<Harness attempt={attempt} onSettled={onSettled} />);

    await act(async () => {
      fireEvent.click(screen.getByText("run"));
    });
    expect(screen.getByText("message")).toBeTruthy();
    expect(attempt).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.click(screen.getByText("confirm"));
    });
    expect(attempt.mock.calls.map((c) => c[0])).toEqual([false, true]);
    expect(onSettled).toHaveBeenCalledWith("restarted");
  });

  it("does not resend when the operator cancels", async () => {
    const refusal = new AgentArmedRefusal(ARMED_BODY);
    const attempt = vi.fn(async () => {
      throw refusal;
    });
    const onSettled = vi.fn();
    render(<Harness attempt={attempt} onSettled={onSettled} />);

    await act(async () => {
      fireEvent.click(screen.getByText("run"));
    });
    await act(async () => {
      fireEvent.click(screen.getByText("cancel"));
    });
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(onSettled).toHaveBeenCalledWith(refusal);
  });

  it("passes other failures through without prompting", async () => {
    const failure = new AgentHttpError(500, "boom");
    const onSettled = vi.fn();
    render(<Harness attempt={async () => Promise.reject(failure)} onSettled={onSettled} />);
    await act(async () => {
      fireEvent.click(screen.getByText("run"));
    });
    expect(screen.queryByText("message")).toBeNull();
    expect(onSettled).toHaveBeenCalledWith(failure);
  });
});
