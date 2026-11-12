/**
 * @license GPL-3.0-only
 *
 * The node page names its subject: the hero's status says whose state it is,
 * the FC reads live only on a fresh heartbeat (an open port with no MAVLink is
 * not live), and the page uses the fleet's name over a default metadata name.
 */

import { describe, it, expect, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";

import messages from "../../../../../locales/en.json";
import { nodeDisplayName, useFcHeartbeatFresh, useNodeBrand } from "../node-brand";
import { useDroneStore } from "@/stores/drone-store";
import { useClockStore } from "@/stores/clock-store";

const wrapper = ({ children }: { children: ReactNode }) => (
  <NextIntlClientProvider locale="en" messages={messages}>
    {children}
  </NextIntlClientProvider>
);

afterEach(() => {
  useDroneStore.setState({ lastHeartbeat: 0 });
});

describe("node page subject", () => {
  it("prefers the fleet name over a metadata name still at its default", () => {
    expect(nodeDisplayName("node:abc", "Sierra-19 (USB FC)", ["node:abc", "abc"])).toBe("Sierra-19 (USB FC)");
    expect(nodeDisplayName("abc", "Sierra-19 (USB FC)", ["node:abc", "abc"])).toBe("Sierra-19 (USB FC)");
    expect(nodeDisplayName("My quad", "Sierra-19 (USB FC)", ["node:abc", "abc"])).toBe("My quad");
    expect(nodeDisplayName(undefined, undefined, ["node:abc", "abc"])).toBe("node:abc");
  });

  it("an open FC session with a silent heartbeat is not live", () => {
    const now = Date.now();
    useClockStore.setState({ now });
    useDroneStore.setState({ lastHeartbeat: now - 60_000 });
    expect(renderHook(() => useFcHeartbeatFresh(true)).result.current).toBe(false);
    useDroneStore.setState({ lastHeartbeat: now });
    expect(renderHook(() => useFcHeartbeatFresh(true)).result.current).toBe(true);
    expect(renderHook(() => useFcHeartbeatFresh(false)).result.current).toBe(false);
  });

  it("labels whose state the hero shows", () => {
    const fc = renderHook(() => useNodeBrand({ profile: "flight-controller", title: "x" }), { wrapper });
    expect(fc.result.current.statusSubject).toBe(messages.nodeConsole.hero.subjectFc);
    const agent = renderHook(() => useNodeBrand({ profile: "drone", title: "x" }), { wrapper });
    expect(agent.result.current.statusSubject).toBe(messages.nodeConsole.hero.subjectAgent);
  });
});
