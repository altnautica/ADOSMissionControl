/**
 * @license GPL-3.0-only
 *
 * The adapters read's honest edges: `present: false` (no receive plane) is an
 * empty state, never adapters borrowed from the capability block, and a
 * per-stream `fec_rec: null` renders as a dash with the loss marked estimated.
 */

import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../locales/en.json";
import {
  diversitySummary,
  getRadioAdapters,
  normalizeRadioAdapters,
} from "@/lib/api/ground-station/radio-adapters";
import type { RadioAdaptersResponse } from "@/lib/api/ground-station-api";
import { RadioAdaptersView } from "../RadioAdaptersView";
import { RadioTab } from "../RadioTab";

const adaptersRead = vi.hoisted(() => ({ value: null as RadioAdaptersResponse | null }));

vi.mock("@/components/command/settings/use-node-direct-agent", () => ({
  useNodeDirectAgent: () => ({ agentUrl: "http://192.168.1.60:8080", apiKey: null, client: null }),
}));
vi.mock("../use-radio-adapters", () => ({ useRadioAdapters: () => adaptersRead.value }));
vi.mock("@/components/hardware/radio/RadioPanel", () => ({ RadioPanel: () => null }));
vi.mock("@/components/hardware/VideoLinkPanel", () => ({ VideoLinkPanel: () => null }));
vi.mock("../PhoneReceiversCard", () => ({ PhoneReceiversCard: () => null }));
vi.mock("../UplinkHandoverCard", () => ({ UplinkHandoverCard: () => null }));
vi.mock("@/stores/agent-capabilities-store", () => ({
  // The capability block still lists two adapters: the REST verdict must win.
  selectDeviceCapabilities: () => ({
    radio: { adapters: normalizeRadioAdapters([{ iface: "wlan1", role: "rx" }, { iface: "wlan2", role: "rx" }]) },
  }),
  useAgentCapabilitiesStore: (sel: (s: unknown) => unknown) => sel({}),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const wrap = (node: ReactNode) => (
  <NextIntlClientProvider locale="en" messages={messages}>
    {node}
  </NextIntlClientProvider>
);

describe("GET /api/v1/radio/adapters · present", () => {
  it("reads present:false, and treats an agent without the field as present", async () => {
    const reply = (body: unknown) =>
      vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
    vi.stubGlobal("fetch", reply({ present: false, adapters: [], diversity: null }));
    const ctx = { baseUrl: "http://192.168.1.60:8080", apiKey: null };
    expect((await getRadioAdapters(ctx)).present).toBe(false);
    vi.stubGlobal("fetch", reply({ adapters: [{ iface: "wlan1", role: "rxtx" }] }));
    expect((await getRadioAdapters(ctx)).present).toBe(true);
  });
});

describe("RadioTab · no receive plane", () => {
  it("shows the empty state instead of capability adapters", () => {
    adaptersRead.value = { present: false, adapters: [], diversity: null };
    render(wrap(<RadioTab nodeDeviceId="gs-1" />));
    expect(screen.getByText("No radio adapters")).toBeTruthy();
    expect(screen.queryByRole("group", { name: "wlan1" })).toBeNull();
  });

  it("falls back to the capability adapters when the read is present but empty", () => {
    adaptersRead.value = { present: true, adapters: [], diversity: null };
    render(wrap(<RadioTab nodeDeviceId="gs-1" />));
    expect(screen.queryByText("No radio adapters")).toBeNull();
    expect(screen.getByRole("group", { name: "wlan1" })).toBeTruthy();
  });
});

describe("RadioAdaptersView · per-stream FEC", () => {
  it("renders a null fec_rec as a dash and marks the loss estimated", () => {
    const adapters = normalizeRadioAdapters([
      { iface: "wlan1", role: "rxtx", packets: 990, lost: 10, fec_rec: null },
      { iface: "wlan2", role: "rx", packets: 980, lost: 20, fec_rec: 612 },
    ]);
    render(wrap(<RadioAdaptersView adapters={adapters} summary={diversitySummary(adapters)} historyKey="gs-fec" />));
    const shared = screen.getByRole("group", { name: "wlan1" });
    expect(shared.textContent).toContain("FEC recovered—");
    expect(shared.textContent).toContain("≈ 1.00 %");
    const own = screen.getByRole("group", { name: "wlan2" });
    expect(own.textContent).toContain("FEC recovered612");
    expect(own.textContent).not.toContain("≈");
  });
});
