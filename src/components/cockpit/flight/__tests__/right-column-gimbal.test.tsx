/**
 * @license GPL-3.0-only
 *
 * The right column's gimbal pad: shown only while the drone's agent reports
 * it takes gimbal rates (`GET /api/v1/gimbal/rate`). A drag maps the offset
 * from the centre to a pitch / yaw rate, at most one request in flight and
 * at most 10 per second, a zero on release and a pause after a 429. With the
 * pad focused the arrow keys hold 30 °/s and Enter recentres; Space is never
 * handled by the pad.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import { renderWithIntl } from "../../../../../tests/helpers/intl-wrapper";

vi.mock("@/lib/agent/resolve-agent", () => ({
  resolveLocalAgentForDrone: () => ({ agentUrl: "http://agent.test", apiKey: "k" }),
}));

const fire = vi.fn((_droneId: string, _ids: readonly string[]) => true);
vi.mock("@/hooks/use-ds4-dispatcher", () => ({
  firePluginSkill: (droneId: string, ids: readonly string[]) => fire(droneId, ids),
}));

import { RightColumn } from "../RightColumn";
import { GimbalPad, GIMBAL_PAD_KEY_DPS } from "../GimbalPad";
import { FlightGridContext } from "../flight-context";
import { flightGrid } from "../flight-grid";

const grid = flightGrid({ width: 1280, height: 800, widthClass: "expanded" });
const PAD = 108;

let available = true;
/** Status the next POSTs answer with. */
let postStatus = 200;
/** Hold POST answers until released, to see what goes out while one is in flight. */
let holdPosts = false;
const pending: (() => void)[] = [];
const posts: { pitch_dps: number; yaw_dps: number; at: number }[] = [];

beforeEach(() => {
  available = true;
  postStatus = 200;
  holdPosts = false;
  pending.length = 0;
  posts.length = 0;
  fire.mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("http://agent.test/api/v1/gimbal/rate");
      if (init?.method === "POST") {
        posts.push({ ...JSON.parse(String(init.body)), at: Date.now() });
        const status = postStatus;
        if (holdPosts) {
          const { promise, resolve } = Promise.withResolvers<void>();
          pending.push(resolve);
          await promise;
        }
        return new Response("{}", { status });
      }
      return new Response(JSON.stringify({ available, reason: available ? null : "no gimbal" }), { status: 200 });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Let pending promises (the driver's fetch chain) settle. */
async function flush(ms = 0): Promise<void> {
  await act(async () => {
    if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(ms);
    else await new Promise((r) => setTimeout(r, ms));
  });
}

function renderPad(): HTMLElement {
  render(<GimbalPad droneId="gimbal-drone" />);
  const pad = screen.getByTestId("fs-gimbal_pad");
  pad.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: PAD, bottom: PAD, width: PAD, height: PAD, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  return pad;
}

/** Press at the centre, then drag to (x, y) in pad pixels. */
function drag(pad: HTMLElement, x: number, y: number): void {
  fireEvent.pointerMove(pad, { pointerId: 1, buttons: 1, clientX: x, clientY: y });
}

describe("right column gimbal pad", () => {
  it("is hidden while the agent reports no gimbal rates", async () => {
    available = false;
    renderWithIntl(
      <FlightGridContext.Provider value={grid}>
        <RightColumn droneId="gimbal-drone" />
      </FlightGridContext.Provider>,
    );
    await flush();
    expect(screen.queryByTestId("fs-gimbal_pad")).toBeNull();
  });

  it("shows one drag pad, not hold buttons, while the agent takes rates", async () => {
    renderWithIntl(
      <FlightGridContext.Provider value={grid}>
        <RightColumn droneId="gimbal-drone" />
      </FlightGridContext.Provider>,
    );
    await flush();
    const pad = screen.getByTestId("fs-gimbal_pad");
    expect(pad.getAttribute("aria-label")).toBe("Gimbal");
    expect(pad.getAttribute("title")).toBe("Drag to aim the camera");
    expect(pad.getAttribute("tabindex")).toBe("0");
    expect(screen.queryByTestId("fs-gimbal-up")).toBeNull();
    expect(screen.getByTestId("fs-gimbal-recentre").getAttribute("aria-label")).toBe("Recentre gimbal");
  });

  it("maps the drag offset to a rate and sends a zero on release", async () => {
    const pad = renderPad();
    fireEvent.pointerDown(pad, { pointerId: 1, buttons: 1, clientX: PAD / 2, clientY: PAD / 2 });
    drag(pad, PAD / 2, 0);
    await flush(150);
    expect(posts[0]).toMatchObject({ pitch_dps: 60, yaw_dps: 0 });
    drag(pad, PAD, PAD / 2);
    await flush(150);
    expect(posts.at(-1)).toMatchObject({ pitch_dps: 0, yaw_dps: 60 });
    fireEvent.pointerUp(pad, { pointerId: 1 });
    await flush(150);
    expect(posts.at(-1)).toMatchObject({ pitch_dps: 0, yaw_dps: 0 });
  });

  it("sends at most 10 rates a second with one request in flight", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    holdPosts = true;
    const pad = renderPad();
    fireEvent.pointerDown(pad, { pointerId: 1, buttons: 1, clientX: PAD / 2, clientY: PAD / 2 });
    drag(pad, PAD / 2, 0);
    await flush();
    expect(posts).toHaveLength(1);
    // While the first request is in flight, further drags send nothing.
    for (let i = 0; i < 10; i += 1) {
      drag(pad, PAD / 2 + (i % 2 ? 30 : -30), 10);
      await flush(20);
    }
    expect(posts).toHaveLength(1);
    holdPosts = false;
    pending.splice(0).forEach((r) => r());
    await flush();

    // One second of a drag moving every 10 ms.
    const start = posts.length;
    for (let i = 0; i < 100; i += 1) {
      drag(pad, PAD / 2 + Math.round(40 * Math.sin(i / 4)), Math.round(PAD / 2 + 40 * Math.cos(i / 4)));
      await flush(10);
    }
    const sent = posts.slice(start);
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.length).toBeLessThanOrEqual(11);
    for (let i = 1; i < sent.length; i += 1) {
      expect(sent[i].at - sent[i - 1].at).toBeGreaterThanOrEqual(100);
    }
    fireEvent.pointerUp(pad, { pointerId: 1 });
    await flush(200);
    expect(posts.at(-1)).toMatchObject({ pitch_dps: 0, yaw_dps: 0 });
  });

  it("waits after a 429 before the next request", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    postStatus = 429;
    const pad = renderPad();
    fireEvent.pointerDown(pad, { pointerId: 1, buttons: 1, clientX: PAD / 2, clientY: PAD / 2 });
    drag(pad, PAD / 2, 0);
    await flush();
    expect(posts).toHaveLength(1);
    postStatus = 200;
    await flush(900);
    expect(posts).toHaveLength(1);
    await flush(200);
    expect(posts).toHaveLength(2);
  });

  it("holds 30 °/s on an arrow key while focused and stops on its release", async () => {
    const pad = renderPad();
    pad.focus();
    fireEvent.keyDown(pad, { key: "ArrowUp" });
    await flush(150);
    expect(posts[0]).toMatchObject({ pitch_dps: GIMBAL_PAD_KEY_DPS, yaw_dps: 0 });
    expect(GIMBAL_PAD_KEY_DPS).toBe(30);
    fireEvent.keyUp(pad, { key: "ArrowUp" });
    await flush(150);
    expect(posts.at(-1)).toMatchObject({ pitch_dps: 0, yaw_dps: 0 });
    fireEvent.keyDown(pad, { key: "ArrowLeft" });
    await flush(150);
    expect(posts.at(-1)).toMatchObject({ pitch_dps: 0, yaw_dps: -30 });
    fireEvent.keyUp(pad, { key: "ArrowLeft" });
    await flush(150);
    expect(posts.at(-1)).toMatchObject({ pitch_dps: 0, yaw_dps: 0 });
  });

  it("recentres on Enter and never handles Space", async () => {
    const pad = renderPad();
    const seen: { key: string; prevented: boolean }[] = [];
    const onKey = (e: KeyboardEvent): void => {
      seen.push({ key: e.key, prevented: e.defaultPrevented });
    };
    window.addEventListener("keydown", onKey);
    try {
      pad.focus();
      fireEvent.keyDown(pad, { key: " ", code: "Space" });
      fireEvent.keyUp(pad, { key: " ", code: "Space" });
      await flush(150);
      expect(posts).toEqual([]);
      expect(fire).not.toHaveBeenCalled();
      expect(seen).toEqual([{ key: " ", prevented: false }]);
      fireEvent.keyDown(pad, { key: "Enter" });
      await flush(150);
      expect(fire).toHaveBeenCalledWith("gimbal-drone", ["center", "recenter", "gimbal-recenter"]);
      expect(posts).toEqual([]);
    } finally {
      window.removeEventListener("keydown", onKey);
    }
  });

  it("aims on a drag that starts on the knob and does not recentre on its release", async () => {
    const pad = renderPad();
    const knob = screen.getByTestId("fs-gimbal-recentre");
    fireEvent.pointerDown(knob, { pointerId: 1, buttons: 1, clientX: PAD / 2, clientY: PAD / 2 });
    drag(pad, PAD / 2, 0);
    await flush(150);
    expect(posts[0]).toMatchObject({ pitch_dps: 60, yaw_dps: 0 });
    fireEvent.pointerUp(knob, { pointerId: 1 });
    fireEvent.click(knob, { detail: 1 });
    await flush(150);
    expect(posts.at(-1)).toMatchObject({ pitch_dps: 0, yaw_dps: 0 });
    expect(fire).not.toHaveBeenCalled();
  });

  it("recentres on a tap on the knob", async () => {
    renderPad();
    const knob = screen.getByTestId("fs-gimbal-recentre");
    fireEvent.pointerDown(knob, { pointerId: 1, buttons: 1, clientX: PAD / 2, clientY: PAD / 2 });
    fireEvent.pointerUp(knob, { pointerId: 1 });
    fireEvent.click(knob, { detail: 1 });
    await flush(150);
    expect(fire).toHaveBeenCalledWith("gimbal-drone", ["center", "recenter", "gimbal-recenter"]);
    expect(posts.every((p) => p.pitch_dps === 0 && p.yaw_dps === 0)).toBe(true);
  });

  it("recentres on a tap off the knob's centre and sends no rate", async () => {
    renderPad();
    const knob = screen.getByTestId("fs-gimbal-recentre");
    const at = { pointerId: 1, buttons: 1, clientX: PAD / 2 + 20, clientY: PAD / 2 };
    fireEvent.pointerDown(knob, at);
    // A finger wobbles a pixel or two without dragging.
    fireEvent.pointerMove(knob, { ...at, clientX: at.clientX + 2 });
    fireEvent.pointerUp(knob, { pointerId: 1 });
    fireEvent.click(knob, { detail: 1 });
    await flush(150);
    expect(fire).toHaveBeenCalledWith("gimbal-drone", ["center", "recenter", "gimbal-recenter"]);
    expect(posts.every((p) => p.pitch_dps === 0 && p.yaw_dps === 0)).toBe(true);
  });

  it("keeps the knob out of the tab order and ignores Space on it", async () => {
    renderPad();
    const knob = screen.getByTestId("fs-gimbal-recentre");
    expect(knob.getAttribute("tabindex")).toBe("-1");
    knob.focus();
    const notPrevented = fireEvent.keyDown(knob, { key: " ", code: "Space" });
    fireEvent.keyUp(knob, { key: " ", code: "Space" });
    // A browser turns Space on a focused button into a click with no pointer.
    fireEvent.click(knob, { detail: 0 });
    await flush(150);
    expect(notPrevented).toBe(true);
    expect(fire).not.toHaveBeenCalled();
    expect(posts).toEqual([]);
  });

  it.each([
    ["pointercancel", (pad: HTMLElement) => void fireEvent.pointerCancel(pad, { pointerId: 1 })],
    ["lost capture", (pad: HTMLElement) => void fireEvent.lostPointerCapture(pad, { pointerId: 1 })],
    ["unmount", () => cleanup()],
  ])("sends a zero rate on %s", async (_name, end: (pad: HTMLElement) => void) => {
    const pad = renderPad();
    fireEvent.pointerDown(pad, { pointerId: 1, buttons: 1, clientX: PAD / 2, clientY: PAD / 2 });
    drag(pad, PAD, PAD / 2);
    await flush(150);
    expect(posts.at(-1)).toMatchObject({ pitch_dps: 0, yaw_dps: 60 });
    end(pad);
    await flush(150);
    expect(posts.at(-1)).toMatchObject({ pitch_dps: 0, yaw_dps: 0 });
  });
});
