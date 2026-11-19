/**
 * @module ground-station/uplink-handover-card.test
 * @description The uplink card shows which ground transmits, never guesses
 * when the radio service is silent, and takes the uplink back only after the
 * operator confirms.
 * @license GPL-3.0-only
 */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { NextIntlClientProvider } from "next-intl";

import messages from "../../../../../../locales/en.json";
import { normaliseRadioUplink } from "@/lib/api/ground-station/uplink-handover";
import { DEMO_UPLINK_HOLDER, demoGroundStationUplink } from "@/mock/ground-station-uplink";
import { UplinkHandoverCard } from "../UplinkHandoverCard";

const demo = vi.hoisted(() => ({ on: false }));
vi.mock("@/hooks/use-demo-mode", () => ({ useDemoMode: () => demo.on }));
const toast = vi.hoisted(() => vi.fn());
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast }) }));

const M = messages.hardware.radio.uplinkHandover;
const BASE = "http://gs.local:8080";
const URL_UPLINK = `${BASE}/api/v1/ground-station/uplink`;

function renderCard() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <UplinkHandoverCard agentUrl={BASE} apiKey="k" />
    </NextIntlClientProvider>,
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const STANDBY = {
  state: "standby",
  holder_device_id: "a1b2c3d4e5f60718",
  holder_name: "Pilot phone",
  since_ms: Date.UTC(2026, 10, 19, 9, 30),
  watcher: { last_beacon_ms: Date.now() },
};

describe("UplinkHandoverCard", () => {
  let fetchMock: Mock;
  let uplink: unknown;

  beforeEach(() => {
    demo.on = false;
    toast.mockReset();
    uplink = STANDBY;
    fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url !== URL_UPLINK) return jsonResponse({ detail: "nope" }, 404);
      if (init?.method === "POST") {
        uplink = { state: "transmitting", holder_device_id: null, holder_name: null, since_ms: 1, watcher: { last_beacon_ms: null } };
        return jsonResponse({ ok: true, state: "transmitting", uplink });
      }
      return jsonResponse({ uplink });
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows the holder and takes the uplink back only after confirm", async () => {
    renderCard();
    expect(await screen.findByText("Uplink: standby — held by Pilot phone since 9:30 AM")).toBeTruthy();
    expect(screen.getByText(M.lastHeard)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: M.takeBack }));
    expect(fetchMock.mock.calls.some(([, i]) => (i as RequestInit | undefined)?.method === "POST")).toBe(false);
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("Pilot phone is told to stop transmitting");

    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: M.takeBack }).at(-1)!);
    });
    const post = fetchMock.mock.calls.find(([, i]) => (i as RequestInit | undefined)?.method === "POST");
    expect(post?.[0]).toBe(URL_UPLINK);
    expect(JSON.parse(String((post?.[1] as RequestInit).body))).toEqual({ op: "take_back" });
    expect(((post?.[1] as RequestInit).headers as Record<string, string>)["X-ADOS-Key"]).toBe("k");
    expect(await screen.findByText(M.lineTransmitting)).toBeTruthy();
    expect(screen.queryByRole("button", { name: M.takeBack })).toBeNull();
    expect(toast).toHaveBeenCalledWith(M.takenBack, "success");
  });

  it("shows unknown, with no take-back, while the radio service is silent", async () => {
    uplink = null;
    renderCard();
    expect(await screen.findByText(M.lineUnknown)).toBeTruthy();
    expect(screen.getByText(M.unknownBody)).toBeTruthy();
    expect(screen.queryByRole("button", { name: M.takeBack })).toBeNull();
  });

  it("reports the box's refusal detail", async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === "POST"
        ? jsonResponse({ error: "E_NOT_HELD", detail: "No phone holds the uplink." }, 409)
        : jsonResponse({ uplink: STANDBY }),
    );
    renderCard();
    await screen.findByText(/held by Pilot phone/);
    fireEvent.click(screen.getByRole("button", { name: M.takeBack }));
    await screen.findByRole("alertdialog");
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: M.takeBack }).at(-1)!);
    });
    expect(toast).toHaveBeenCalledWith("No phone holds the uplink.", "error");
  });

  it("hides itself on a node without the uplink route", async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ error: "E_PROFILE_MISMATCH" }, 404));
    const { container } = renderCard();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await vi.waitFor(() => expect(container.querySelector("section")).toBeNull());
  });

  it("shows the demo station in standby and takes it back locally", async () => {
    demo.on = true;
    demoGroundStationUplink.reset();
    renderCard();
    expect(screen.getByText(new RegExp(`held by ${DEMO_UPLINK_HOLDER.name}`))).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: M.takeBack }));
    await screen.findByRole("alertdialog");
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: M.takeBack }).at(-1)!);
    });
    expect(screen.getByText(M.lineTransmitting)).toBeTruthy();
    expect(fetchMock.mock.calls.some(([, i]) => (i as RequestInit | undefined)?.method === "POST")).toBe(false);
  });

  it("reads an unknown state as unknown, never as a guess", () => {
    expect(normaliseRadioUplink({ state: "linked" })).toBeNull();
    expect(normaliseRadioUplink(null)).toBeNull();
    expect(normaliseRadioUplink(STANDBY)?.last_beacon_ms).toBe(STANDBY.watcher.last_beacon_ms);
  });
});
