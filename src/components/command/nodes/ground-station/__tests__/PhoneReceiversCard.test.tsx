/**
 * @module ground-station/PhoneReceiversCard.test
 * @description The phone-receivers card lists waiting phones with their
 * fingerprint and sends the operator's decision to the invite route.
 * @license GPL-3.0-only
 */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { NextIntlClientProvider } from "next-intl";

import messages from "../../../../../../locales/en.json";
import { PhoneReceiversCard } from "../PhoneReceiversCard";
import { DEMO_PHONE_INVITES } from "@/mock/demo-seed/ground-station";

const demo = vi.hoisted(() => ({ on: false }));
vi.mock("@/hooks/use-demo-mode", () => ({ useDemoMode: () => demo.on }));
const toast = vi.hoisted(() => vi.fn());
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast }) }));

const M = messages.hardware.radio.phoneReceivers;
const BASE = "http://gs.local:8080";

function renderCard() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <PhoneReceiversCard agentUrl={BASE} apiKey="k" />
    </NextIntlClientProvider>,
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("PhoneReceiversCard", () => {
  let fetchMock: Mock;

  beforeEach(() => {
    demo.on = false;
    toast.mockReset();
    fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/wfb/invite") && (!init?.method || init.method === "GET")) {
        return jsonResponse({
          pending: [
            {
              invite_id: "abc",
              label: "Pilot phone",
              phone_fingerprint: "1A2B-3C4D-5E6F-7081",
              expires_at_ms: 1,
            },
          ],
        });
      }
      if (url.endsWith("/wfb/invite/abc/approve")) {
        return jsonResponse({ invite_id: "abc", state: "approved" });
      }
      return jsonResponse({ detail: "nope" }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("lists a waiting phone with its fingerprint and approves it", async () => {
    renderCard();
    expect(await screen.findByText("1A2B-3C4D-5E6F-7081")).toBeTruthy();
    expect(screen.getByText("Pilot phone")).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Approve Pilot phone" }));
    });

    const approve = fetchMock.mock.calls.find(([u]) => String(u).endsWith("/approve"));
    expect(approve?.[0]).toBe(`${BASE}/api/v1/ground-station/wfb/invite/abc/approve`);
    expect((approve?.[1] as RequestInit).method).toBe("POST");
    expect(((approve?.[1] as RequestInit).headers as Record<string, string>)["X-ADOS-Key"]).toBe("k");
    expect(screen.queryByText("Pilot phone")).toBeNull();
    expect(screen.getByText(M.empty)).toBeTruthy();
  });

  it("reports a refused decision and keeps the row", async () => {
    renderCard();
    await screen.findByText("Pilot phone");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reject Pilot phone" }));
    });
    expect(toast).toHaveBeenCalledWith(M.decideFailed, "error");
    expect(screen.getByText("Pilot phone")).toBeTruthy();
  });

  it("shows the demo phones in demo mode and decides locally", async () => {
    demo.on = true;
    renderCard();
    for (const invite of DEMO_PHONE_INVITES) {
      expect(screen.getByText(invite.phone_fingerprint)).toBeTruthy();
    }
    const first = DEMO_PHONE_INVITES[0];
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: `Reject ${first.label}` }));
    });
    expect(screen.queryByText(first.label)).toBeNull();
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/reject"))).toBe(false);
  });
});
