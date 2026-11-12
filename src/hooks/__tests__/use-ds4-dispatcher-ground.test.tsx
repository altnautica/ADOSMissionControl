/**
 * The pad's take-off / land choice and the lightbar's link-lost state read
 * the pilot only while its frame is fresh (the shared `stale_after_ms`). With
 * no fresh pilot, only a heartbeat that reads disarmed is on the ground: a
 * stalled pilot that last said "landed", or an unknown arm state, may be
 * flying, so the Triangle hold lands.
 *
 * @license GPL-3.0-only
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import type * as Skills from "@/lib/skills";

const spies = vi.hoisted(() => ({
  activate: vi.fn(async (_id: string, _ctx: unknown, _opts?: unknown) => undefined),
  lightbarState: vi.fn((_pilot: unknown, _opts: { lowBattery: boolean; linkLost: boolean }) => "idle"),
}));

vi.mock("@/lib/skills", async (importOriginal) => ({
  ...(await importOriginal<typeof Skills>()),
  activate: (id: string, ctx: unknown, opts?: unknown) => spies.activate(id, ctx, opts),
  buildSkillContext: () => ({}),
}));
vi.mock("@/lib/input/pilot-stream", () => ({ sendPilotAction: vi.fn() }));
vi.mock("@/lib/video/webrtc-client", () => ({
  captureScreenshot: vi.fn(async () => new Blob(["png"])),
  startRecording: vi.fn(),
  stopRecording: vi.fn(),
}));
vi.mock("@/lib/input/ds4-feedback", () => ({
  rumble: vi.fn(),
  rumbleHoldTick: vi.fn(),
  setLightbar: vi.fn(async () => false),
  lightbarState: (pilot: unknown, opts: { lowBattery: boolean; linkLost: boolean }) =>
    spies.lightbarState(pilot, opts),
  lightbarColour: () => [0, 0, 0],
}));

import { useDs4Dispatcher } from "@/hooks/use-ds4-dispatcher";
import { WEB_BUTTON_INDEX } from "@/lib/input/ds4-bindings";
import { CHIP_STALE_AFTER_MS } from "@/lib/hud/flight-state";
import { useControlsStore } from "@/stores/controls-store";
import { useDroneStore } from "@/stores/drone-store";
import { useInputStore } from "@/stores/input-store";
import { useNavStreamStore } from "@/stores/nav-stream-store";
import type { ArmState } from "@/lib/types";

const DRONE = "pad-drone";

function Dispatcher() {
  useDs4Dispatcher(DRONE);
  return null;
}

/** A pilot frame received `ageMs` ago. */
function pilotFrame(data: Record<string, unknown>, ageMs: number): void {
  useNavStreamStore.setState({
    byDrone: { [DRONE]: { pilot: { data, receivedAt: Date.now() - ageMs } } } as never,
  });
}

/** Hold Triangle long enough for its hold binding, then let go. */
function holdTriangle(): string[] {
  const down: boolean[] = [];
  down[WEB_BUTTON_INDEX.triangle] = true;
  act(() => useInputStore.setState({ buttons: down }));
  act(() => vi.advanceTimersByTime(1600));
  act(() => useInputStore.setState({ buttons: [] }));
  return spies.activate.mock.calls.map((c) => c[0]);
}

function heartbeat(armState: ArmState): void {
  useDroneStore.setState({ armState, lastHeartbeat: Date.now() });
}

beforeEach(() => {
  vi.useFakeTimers();
  spies.activate.mockClear();
  spies.lightbarState.mockClear();
  useControlsStore.setState({ bindings: null, tourVisible: false });
  useInputStore.setState({ buttons: [] });
  useNavStreamStore.setState({ byDrone: {} });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  useNavStreamStore.setState({ byDrone: {} });
});

describe("Triangle hold: take off or land", () => {
  it("lands when a stalled pilot last said landed while the heartbeat reads armed", () => {
    heartbeat("armed");
    pilotFrame({ landed: true, armed: true }, 5000);
    render(<Dispatcher />);
    expect(holdTriangle()).toEqual(["land"]);
  });

  it("lands when no pilot reports and the arm state is unknown", () => {
    heartbeat("unknown");
    render(<Dispatcher />);
    expect(holdTriangle()).toEqual(["land"]);
  });

  it("takes off when no pilot reports and the heartbeat reads disarmed", () => {
    heartbeat("disarmed");
    render(<Dispatcher />);
    expect(holdTriangle()).toEqual(["takeoff"]);
  });

  it("takes off when a fresh pilot says landed", () => {
    heartbeat("armed");
    pilotFrame({ landed: true, armed: true }, 0);
    render(<Dispatcher />);
    expect(holdTriangle()).toEqual(["takeoff"]);
  });
});

describe("lightbar link-lost", () => {
  it("shows link lost once the pilot frame is exactly the stale age", () => {
    pilotFrame({ landed: true }, CHIP_STALE_AFTER_MS - 100);
    render(<Dispatcher />);
    act(() => vi.advanceTimersByTime(100));
    const last = spies.lightbarState.mock.calls.at(-1);
    expect(last?.[1].linkLost).toBe(true);
  });

  it("shows the link up while the pilot frame is fresh", () => {
    pilotFrame({ landed: true }, 0);
    render(<Dispatcher />);
    act(() => vi.advanceTimersByTime(100));
    expect(spies.lightbarState.mock.calls.at(-1)?.[1].linkLost).toBe(false);
  });
});
