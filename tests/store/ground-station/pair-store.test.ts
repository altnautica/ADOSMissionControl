/**
 * Smoke tests for the pair slice of the ground-station store. Asserts the
 * initial-state defaults for network, ap, pair, and ui fields plus the
 * synchronous clearPair pathway. Async pair flows that require an api
 * client are out of scope here.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeEach } from "vitest";

import { useGroundStationStore } from "@/stores/ground-station-store";

describe("ground-station pair slice", () => {
  beforeEach(() => {
    useGroundStationStore.getState().resetAll();
  });

  it("has correct initial state", () => {
    const s = useGroundStationStore.getState();
    expect(s.network).toBeNull();
    expect(s.ap).toBeNull();
    expect(s.ui).toBeNull();
    expect(s.pair).toEqual({
      loading: false,
      result: null,
      error: null,
      errorStatus: null,
      errorCode: null,
    });
  });

  it("clearPair restores the pair sub-state to its defaults", () => {
    useGroundStationStore.setState({
      pair: {
        loading: true,
        result: null,
        error: "bad key",
        errorStatus: 400,
        errorCode: "E_BLOB_BASE64",
      },
    });
    useGroundStationStore.getState().clearPair();
    expect(useGroundStationStore.getState().pair).toEqual({
      loading: false,
      result: null,
      error: null,
      errorStatus: null,
      errorCode: null,
    });
  });

  it("resetAll restores every pair-related field", () => {
    useGroundStationStore.setState({
      ap: { ssid: "ados-test", channel: 36 } as never,
      ui: { oled_enabled: true } as never,
      pair: {
        loading: false,
        result: null,
        error: "expired",
        errorStatus: 410,
        errorCode: null,
      },
    });
    useGroundStationStore.getState().resetAll();
    const s = useGroundStationStore.getState();
    expect(s.ap).toBeNull();
    expect(s.ui).toBeNull();
    expect(s.pair.error).toBeNull();
  });
});
