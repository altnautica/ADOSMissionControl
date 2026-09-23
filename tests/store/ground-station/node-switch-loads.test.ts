/**
 * A late read from the previously shown ground station never lands on the
 * one now shown: the shared store tags the UI config, the paired Bluetooth
 * list and the load-once uplink slices with the node they were read from.
 *
 * @license GPL-3.0-only
 */

import { beforeEach, describe, expect, it } from "vitest";

import { useGroundStationStore } from "@/stores/ground-station-store";
import type { GroundStationApi, UiConfig } from "@/lib/api/ground-station-api";

function uiWithBrightness(brightness: number): UiConfig {
  return {
    oled: { brightness, auto_dim_enabled: true, screen_cycle_seconds: 10 },
    buttons: {},
    screens: { order: [], enabled: [] },
  } as unknown as UiConfig;
}

/** An api fake whose reads resolve only when the test releases them. */
function deferredApi(baseUrl: string) {
  const ui = Promise.withResolvers<UiConfig>();
  const paired = Promise.withResolvers<{ devices: { mac: string; name: string }[] }>();
  const modem = Promise.withResolvers<{ enabled: boolean; apn: string }>();
  const api = {
    baseUrl,
    getUi: () => ui.promise,
    getPairedBluetooth: () => paired.promise,
    getModem: () => modem.promise,
  } as unknown as GroundStationApi;
  return { api, ui, paired, modem };
}

describe("ground-station store node switch", () => {
  beforeEach(() => {
    useGroundStationStore.getState().resetAll();
  });

  it("drops node A's late UI config after node B loaded", async () => {
    const a = deferredApi("http://192.168.1.50:8080");
    const b = deferredApi("http://192.168.1.51:8080");
    const store = useGroundStationStore.getState();

    const loadA = store.loadUi(a.api);
    const loadB = store.loadUi(b.api);
    b.ui.resolve(uiWithBrightness(40));
    expect((await loadB)?.oled.brightness).toBe(40);
    a.ui.resolve(uiWithBrightness(250));
    expect(await loadA).toBeNull();

    const s = useGroundStationStore.getState();
    expect(s.uiFor).toBe("http://192.168.1.51:8080");
    expect(s.ui?.oled.brightness).toBe(40);
  });

  it("drops node A's late paired-device list after switching to node B", async () => {
    const a = deferredApi("http://192.168.1.50:8080");
    const b = deferredApi("http://192.168.1.51:8080");
    const store = useGroundStationStore.getState();

    const loadA = store.loadPairedBluetooth(a.api);
    const loadB = store.loadPairedBluetooth(b.api);
    b.paired.resolve({ devices: [] });
    a.paired.resolve({ devices: [{ mac: "AA:BB:CC:DD:EE:FF", name: "pad" }] });
    await Promise.all([loadA, loadB]);

    const bt = useGroundStationStore.getState().bluetooth;
    expect(bt.pairedFor).toBe("http://192.168.1.51:8080");
    expect(bt.paired).toEqual([]);
  });

  it("drops node A's late modem read after switching to node B", async () => {
    const a = deferredApi("http://192.168.1.50:8080");
    const b = deferredApi("http://192.168.1.51:8080");
    const store = useGroundStationStore.getState();

    const loadA = store.loadModem(a.api);
    store.loadModem(b.api);
    a.modem.resolve({ enabled: true, apn: "node-a-apn" });
    await loadA;

    const s = useGroundStationStore.getState();
    expect(s.uplinkFor).toBe("http://192.168.1.51:8080");
    expect(s.modem).toBeNull();
  });
});
