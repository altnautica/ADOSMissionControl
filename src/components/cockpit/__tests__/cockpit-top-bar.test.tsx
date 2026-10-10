import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";

const skills = vi.hoisted(() => ({ activate: vi.fn(async () => {}) }));
vi.mock("@/lib/skills", () => ({
  activate: skills.activate,
  buildSkillContext: (droneId: string) => ({ droneId }),
}));

import messages from "../../../../locales/en.json";
import { CockpitTopBar } from "@/components/cockpit/CockpitTopBar";
import { resolveBandReach } from "@/components/cockpit/band/use-band-reach";
import { useUiStore } from "@/stores/ui-store";
import { useVideoStore } from "@/stores/video-store";
import { useChecklistStore } from "@/stores/checklist-store";
import { useDroneStore } from "@/stores/drone-store";
import { useButtonTelemetryRecordingStore } from "@/hooks/use-flight-recording";
import { NO_DATA_GLYPH } from "@/lib/hud-draw";

const DRONE = "drone-band";

/** The safety band reads live telemetry + arm state from real stores; their
 * defaults (no telemetry at all) are enough — the band renders its stat
 * scaffold regardless of data, which is exactly the "always-on" contract.
 *
 * With no heartbeat the arm pill and mode MUST read the no-data glyph, not the
 * store defaults: a band that renders "DISARMED" / "STABILIZE" for a vehicle it
 * has never heard from is asserting a confirmed-safe state it never measured. */
function renderBand(props: { lean?: boolean } = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <CockpitTopBar droneId={DRONE} lean={props.lean ?? false} />
    </NextIntlClientProvider>,
  );
}

describe("CockpitTopBar (always-on safety band)", () => {
  beforeEach(() => {
    useUiStore.setState({ immersiveMode: false });
    useDroneStore.setState({ armState: "disarmed", armedAt: null, lastHeartbeat: 0 });
    useVideoStore.getState().clearForSelection();
    useVideoStore.setState({ isStreaming: false, isRecording: false, recordingStartedAt: null });
    useChecklistStore.getState().resetSession();
    skills.activate.mockClear();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    window.history.replaceState(null, "", "/");
  });

  it("always renders the safety stats (arm pill + battery/GPS/link)", () => {
    const { container } = renderBand();
    expect(container.querySelector(".safety")).not.toBeNull();
    expect(screen.queryByText(messages.cockpit.disarmed.toUpperCase())).toBeNull();
    expect(screen.getAllByText(NO_DATA_GLYPH).length).toBeGreaterThan(0);
    expect(screen.getByText(messages.cockpit.band.batt)).toBeTruthy();
    expect(screen.getByText(messages.cockpit.strip.gps)).toBeTruthy();
    expect(screen.getByText(messages.cockpit.strip.link)).toBeTruthy();
  });

  it("renders every band element in order", () => {
    renderBand();
    const ids = Array.from(document.querySelectorAll("[data-testid^='cockpit-']")).map((el) =>
      el.getAttribute("data-testid"),
    );
    expect(ids).toEqual([
      "cockpit-node-name",
      "cockpit-arm",
      "cockpit-mode",
      "cockpit-battery",
      "cockpit-gps",
      "cockpit-link",
      "cockpit-video",
      "cockpit-stick",
      "cockpit-preflight",
      "cockpit-rec",
      "cockpit-flight-time",
      "cockpit-kill",
    ]);
  });

  it("shows unknown battery as the no-data glyph, never 0%", () => {
    renderBand();
    const v = screen.getByTestId("cockpit-battery").querySelector(".v");
    expect(v?.textContent).toBe(NO_DATA_GLYPH);
    expect(screen.queryByText("0%")).toBeNull();
  });

  it("names the drone from its id prop", () => {
    renderBand();
    expect(screen.getByTestId("cockpit-node-name").textContent).toBe(DRONE);
  });

  it("shows the decorative wordmark in the full band and drops it in lean mode", () => {
    renderBand({ lean: false });
    expect(screen.getByText("ADOS")).toBeTruthy();
    cleanup();
    const { container } = renderBand({ lean: true });
    expect(screen.queryByText("ADOS")).toBeNull();
    expect(container.querySelector(".safety")).not.toBeNull();
    expect(screen.getByText(messages.cockpit.strip.gps)).toBeTruthy();
  });

  it("offers Immersive when embedded and exit when immersive", () => {
    renderBand();
    const enter = screen.getByRole("button", { name: messages.cockpit.immersive });
    act(() => {
      fireEvent.click(enter);
    });
    expect(useUiStore.getState().immersiveMode).toBe(true);
    const exit = screen.getByRole("button", { name: messages.cockpit.exitImmersiveTitle });
    act(() => {
      fireEvent.click(exit);
    });
    expect(useUiStore.getState().immersiveMode).toBe(false);
  });

  it("hides both immersive controls on a kiosk surface", () => {
    window.history.replaceState(null, "", "/?kiosk=1");
    renderBand();
    expect(screen.queryByRole("button", { name: messages.cockpit.immersive })).toBeNull();
    expect(screen.queryByRole("button", { name: messages.cockpit.exitImmersiveTitle })).toBeNull();
  });

  it("reports video as NO VIDEO, LIVE, or FROZEN", () => {
    renderBand();
    const cell = () => screen.getByTestId("cockpit-video");
    expect(cell().getAttribute("data-video-state")).toBe("none");
    act(() => useVideoStore.setState({ isStreaming: true }));
    expect(cell().textContent).toContain(messages.cockpit.band.videoLive);
    act(() => useVideoStore.getState().setVideoDegraded("no-progress"));
    expect(cell().textContent).toContain(messages.cockpit.band.videoFrozen);
  });

  it("counts the pre-flight checklist only for this drone's session", () => {
    renderBand();
    const total = useChecklistStore.getState().items.length;
    const chip = () => screen.getByTestId("cockpit-preflight").textContent ?? "";
    expect(chip()).toContain(`${NO_DATA_GLYPH}/${total}`);
    act(() => useChecklistStore.getState().startSession(DRONE));
    expect(chip()).toContain(`0/${total}`);
  });

  it("routes Kill through the skill pipeline without a local guard", () => {
    renderBand();
    act(() => {
      fireEvent.click(screen.getByTestId("cockpit-kill"));
    });
    expect(skills.activate).toHaveBeenCalledTimes(1);
    expect(skills.activate).toHaveBeenCalledWith("kill", { droneId: DRONE }, { gamepadButton: undefined });
    expect(screen.getByTestId("cockpit-kill").textContent).toContain(messages.skills.kill.label);
  });

  it("keeps the REC timer through a remount", () => {
    vi.useFakeTimers({ now: 5_000_000 });
    useVideoStore.setState({ isRecording: true, recordingStartedAt: 5_000_000 - 75_000 });
    const first = renderBand();
    expect(screen.getByTestId("cockpit-rec-timer").textContent).toBe("1:15");
    first.unmount();
    renderBand();
    expect(screen.getByTestId("cockpit-rec-timer").textContent).toBe("1:15");
    useButtonTelemetryRecordingStore.setState({ startedAt: {} });
  });

  it("announces arm transitions in a polite live region", () => {
    vi.useFakeTimers({ now: 6_000_000 });
    useDroneStore.setState({ armState: "disarmed", lastHeartbeat: 6_000_000 });
    renderBand();
    const region = document.querySelector(".safety [aria-live='polite']");
    expect(region?.textContent).toBe("");
    act(() => useDroneStore.setState({ armState: "armed", armedAt: 6_000_000 }));
    expect(region?.textContent).toContain(messages.cockpit.band.announceArmed);
  });
});

describe("band reach badge", () => {
  it("resolves the reach from the session transport and presence", () => {
    expect(resolveBandReach("serial", [])).toBe("direct");
    expect(resolveBandReach("mqtt-mavlink", ["local"])).toBe("cloud");
    expect(resolveBandReach("websocket", ["local", "relayed"])).toBe("lan");
    // A WebSocket session is never the cloud path.
    expect(resolveBandReach("websocket", ["cloud"])).toBe("direct");
    expect(resolveBandReach("websocket", ["cloud", "relayed"])).toBe("relayed");
    expect(resolveBandReach(null, ["cloud"])).toBe("cloud");
    expect(resolveBandReach("websocket", ["relayed"])).toBe("relayed");
    expect(resolveBandReach("websocket", [])).toBe("direct");
  });
});
