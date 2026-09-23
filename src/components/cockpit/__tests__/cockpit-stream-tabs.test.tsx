import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import messages from "../../../../locales/en.json";
import { CockpitStreamTabs } from "@/components/cockpit/CockpitStreamTabs";
import {
  useVideoStreamsStore,
  type StreamDescriptor,
} from "@/stores/video-streams-store";

const DRONE = "node:d1";

function stream(
  over: Partial<StreamDescriptor> & Pick<StreamDescriptor, "id" | "index">,
): StreamDescriptor {
  return { label: over.id, kind: "switchable", ...over };
}

function renderTabs() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <CockpitStreamTabs droneId={DRONE} />
    </NextIntlClientProvider>,
  );
}

describe("CockpitStreamTabs", () => {
  beforeEach(() => useVideoStreamsStore.getState().clear());
  afterEach(cleanup);

  it("renders nothing for a single-stream node (auto-detect)", () => {
    useVideoStreamsStore
      .getState()
      .setStreams(DRONE, [stream({ id: "eo", index: 1, role: "eo" })]);
    const { container } = renderTabs();
    expect(container.querySelector(".strmtabs")).toBeNull();
  });

  it("renders a tab per stream when more than one, with digit + role label", () => {
    useVideoStreamsStore.getState().setStreams(DRONE, [
      stream({ id: "eo", index: 1, role: "eo" }),
      stream({ id: "ir", index: 2, role: "ir" }),
      stream({ id: "cam3", index: 3, label: "Belly Cam" }),
    ]);
    renderTabs();
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(3);
    // Role → localized label; unknown role → the raw camera name.
    expect(screen.getByText(messages.cockpitStreams.roleEo)).toBeTruthy();
    expect(screen.getByText(messages.cockpitStreams.roleIr)).toBeTruthy();
    expect(screen.getByText("Belly Cam")).toBeTruthy();
    // Digits are shown for 1..N.
    expect(screen.getByText("1")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
  });

  it("marks the active stream selected and switches on click", () => {
    useVideoStreamsStore.getState().setStreams(DRONE, [
      stream({ id: "eo", index: 1, role: "eo" }),
      stream({ id: "ir", index: 2, role: "ir" }),
    ]);
    renderTabs();
    const tabs = screen.getAllByRole("tab");
    // Defaults to the first stream.
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    expect(tabs[1].getAttribute("aria-selected")).toBe("false");
    fireEvent.click(tabs[1]);
    expect(useVideoStreamsStore.getState().activeStream(DRONE)?.id).toBe("ir");
  });

  it("uses roving tabindex and moves the selection with arrow keys", () => {
    useVideoStreamsStore.getState().setStreams(DRONE, [
      stream({ id: "eo", index: 1, role: "eo" }),
      stream({ id: "ir", index: 2, role: "ir" }),
    ]);
    renderTabs();
    const tabs = screen.getAllByRole("tab");
    // Only the active tab is in the tab order.
    expect(tabs[0].getAttribute("tabindex")).toBe("0");
    expect(tabs[1].getAttribute("tabindex")).toBe("-1");
    const tablist = screen.getByRole("tablist");
    expect(tablist.getAttribute("aria-orientation")).toBe("horizontal");
    fireEvent.keyDown(tablist, { key: "ArrowRight" });
    expect(useVideoStreamsStore.getState().activeStream(DRONE)?.id).toBe("ir");
    fireEvent.keyDown(tablist, { key: "Home" });
    expect(useVideoStreamsStore.getState().activeStream(DRONE)?.id).toBe("eo");
  });

  it("renders a dead leg (live===false) disabled and non-selectable", () => {
    useVideoStreamsStore.getState().setStreams(DRONE, [
      stream({ id: "eo", index: 1, role: "eo", kind: "concurrent", live: true }),
      stream({ id: "ir", index: 2, role: "ir", kind: "concurrent", live: false }),
    ]);
    renderTabs();
    const tabs = screen.getAllByRole("tab");
    expect(tabs[1].getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(tabs[1]);
    // The click is ignored — the video stays on the live default leg.
    expect(useVideoStreamsStore.getState().activeStream(DRONE)?.id).toBe("eo");
  });

  it("keeps an unsampled leg (live null/undefined) selectable", () => {
    useVideoStreamsStore.getState().setStreams(DRONE, [
      stream({ id: "eo", index: 1, kind: "concurrent" }), // undefined
      stream({ id: "ir", index: 2, kind: "concurrent", live: null }), // null
    ]);
    renderTabs();
    const tabs = screen.getAllByRole("tab");
    expect(tabs[1].getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(tabs[1]);
    expect(useVideoStreamsStore.getState().activeStream(DRONE)?.id).toBe("ir");
  });

  it("arrow-nav skips a dead leg", () => {
    useVideoStreamsStore.getState().setStreams(DRONE, [
      stream({ id: "eo", index: 1, kind: "concurrent", live: true }),
      stream({ id: "ir", index: 2, kind: "concurrent", live: false }),
      stream({ id: "wide", index: 3, kind: "concurrent", live: true }),
    ]);
    renderTabs();
    // active is "eo"; ArrowRight must skip the dead "ir" and land on "wide".
    fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowRight" });
    expect(useVideoStreamsStore.getState().activeStream(DRONE)?.id).toBe("wide");
  });

  it("ignores a tab click while an encoder restart is in flight", () => {
    useVideoStreamsStore.getState().setStreams(DRONE, [
      stream({ id: "eo", index: 1, role: "eo" }),
      stream({ id: "ir", index: 2, role: "ir" }),
    ]);
    useVideoStreamsStore.getState().setSwitching(DRONE, true);
    renderTabs();
    const tabs = screen.getAllByRole("tab");
    fireEvent.click(tabs[1]);
    // Still on the first stream — the click was debounced while switching.
    expect(useVideoStreamsStore.getState().activeStream(DRONE)?.id).toBe("eo");
    expect(screen.getByRole("tablist").getAttribute("aria-busy")).toBe("true");
    // Arrow-key activation is debounced too.
    fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowRight" });
    expect(useVideoStreamsStore.getState().activeStream(DRONE)?.id).toBe("eo");
  });
});
