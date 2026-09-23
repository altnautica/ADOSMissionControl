/**
 * @license GPL-3.0-only
 */
import { describe, it, expect, beforeEach } from "vitest";

import {
  useLocalPluginInstallsStore,
  type LocalPluginInstall,
} from "../local-plugin-installs-store";

function mk(over: Partial<LocalPluginInstall> = {}): LocalPluginInstall {
  return {
    pluginId: "com.altnautica.follow-me",
    deviceId: "drone-1",
    version: "0.1.0",
    name: "Follow-Me",
    halves: ["agent", "gcs"],
    gcsContributes: [{ slot: "video.overlay", panelId: "fm-overlay" }],
    grantedCaps: ["command.send"],
    manifestHash: "h1",
    bundle: { kind: "agent", deviceId: "drone-1", entrypoint: "gcs/plugin.bundle.js" },
    installedAt: 1,
    ...over,
  };
}

describe("local-plugin-installs-store", () => {
  beforeEach(() => useLocalPluginInstallsStore.getState().clear());

  it("records and lists by device (drone vs fleet/gcs-only)", () => {
    const s = useLocalPluginInstallsStore.getState();
    s.record(mk());
    s.record(
      mk({
        pluginId: "com.altnautica.battery-health-panel",
        deviceId: null,
        halves: ["gcs"],
        bundle: {
          kind: "archive",
          archiveUrl: "https://example/x.adosplug",
          entrypoint: "gcs/plugin.bundle.js",
          pin: { sha256: "ab".repeat(32), signerId: null },
        },
      }),
    );
    const st = useLocalPluginInstallsStore.getState();
    expect(st.listForDevice("drone-1")).toHaveLength(1);
    expect(st.listForDevice(null)).toHaveLength(1);
    expect(st.listForDevice(null)[0].bundle.kind).toBe("archive");
  });

  it("upserts on the same plugin+device key", () => {
    const s = useLocalPluginInstallsStore.getState();
    s.record(mk({ version: "0.1.0" }));
    s.record(mk({ version: "0.2.0" }));
    const list = useLocalPluginInstallsStore.getState().listForDevice("drone-1");
    expect(list).toHaveLength(1);
    expect(list[0].version).toBe("0.2.0");
  });

  it("get and remove by plugin+device", () => {
    const s = useLocalPluginInstallsStore.getState();
    s.record(mk());
    expect(
      useLocalPluginInstallsStore
        .getState()
        .get("com.altnautica.follow-me", "drone-1")?.name,
    ).toBe("Follow-Me");
    useLocalPluginInstallsStore
      .getState()
      .remove("com.altnautica.follow-me", "drone-1");
    expect(
      useLocalPluginInstallsStore
        .getState()
        .get("com.altnautica.follow-me", "drone-1"),
    ).toBeUndefined();
  });

  it("keeps the same plugin id on different devices distinct", () => {
    const s = useLocalPluginInstallsStore.getState();
    s.record(mk({ deviceId: "drone-1" }));
    s.record(
      mk({
        deviceId: "drone-2",
        bundle: {
          kind: "agent",
          deviceId: "drone-2",
          entrypoint: "gcs/plugin.bundle.js",
        },
      }),
    );
    expect(useLocalPluginInstallsStore.getState().installs).toHaveLength(2);
  });
});
