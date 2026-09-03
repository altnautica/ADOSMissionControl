/**
 * Round-trip tests for the iNav mock's flight-controller configuration
 * surface: battery and mixer profiles, output mapping and timer modes, servos,
 * temperature sensors, MC braking, serial ports, DShot, the LED strip, the OSD
 * layout and font, and global-variable status.
 *
 * These are the methods the real MSP adapter answers for iNav, so a panel's
 * save-then-reload has to behave the same in demo mode as against hardware.
 * Every writer here is asserted to be visible to the matching reader.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";
import { INavMockProtocol } from "@/mock/inav-mock-protocol";
import type { INavServoConfig } from "@/lib/protocol/msp/msp-decoders-inav";

// ── Factory helpers ──────────────────────────────────────────

function makeCopter() {
  return new INavMockProtocol({ vehicleClass: "copter" });
}

function makePlane() {
  return new INavMockProtocol({ vehicleClass: "plane" });
}

/** Serial function bit 9 = MAVLink telemetry. */
const SERIAL_FN_MAVLINK = 1 << 9;

/** Pack an OSD element position the way the OSD editor does. */
function osdPosition(x: number, y: number): number {
  return (x & 0x1f) | ((y & 0x3f) << 5) | 0x8000;
}

// ── Battery profiles ─────────────────────────────────────────

describe("battery config", () => {
  it("reports the 4S 2200 mAh pack the telemetry tick drains", async () => {
    const cfg = await makeCopter().getBatteryConfig();
    expect(cfg.cells).toBe(4);
    expect(cfg.capacityMah).toBe(2200);
    expect(cfg.cellMin).toBe(3300);
    expect(cfg.cellMax).toBe(4200);
  });

  it("agrees with the named battery settings", async () => {
    const proto = makeCopter();
    const cfg = await proto.getBatteryConfig();
    expect(await proto.settings.getSetting("battery_capacity")).toEqual({
      type: "uint16", value: cfg.capacityMah,
    });
    expect(await proto.settings.getSetting("bat_cells")).toEqual({
      type: "uint8", value: cfg.cells,
    });
    expect(await proto.settings.getSetting("vbat_max_cell_voltage")).toEqual({
      type: "uint8", value: cfg.cellMax / 10,
    });
  });

  it("a write is visible to the next read", async () => {
    const proto = makeCopter();
    const before = await proto.getBatteryConfig();
    const result = await proto.setBatteryConfig({
      ...before, capacityMah: 1800, capacityWarningMah: 360, cellWarning: 3600,
    });
    expect(result.success).toBe(true);

    const after = await proto.getBatteryConfig();
    expect(after.capacityMah).toBe(1800);
    expect(after.capacityWarningMah).toBe(360);
    expect(after.cellWarning).toBe(3600);
  });

  it("a write moves the named settings the FC shares with the battery group", async () => {
    const proto = makeCopter();
    const before = await proto.getBatteryConfig();
    await proto.setBatteryConfig({ ...before, capacityMah: 1800, cellWarning: 3600 });

    expect(await proto.settings.getSetting("battery_capacity")).toEqual({ type: "uint16", value: 1800 });
    expect(await proto.settings.getSetting("vbat_warning_cell_voltage")).toEqual({ type: "uint8", value: 360 });
  });

  it("a profile switch swaps the reported config and keeps the other profile's edits", async () => {
    const proto = makeCopter();
    const profile0 = await proto.getBatteryConfig();
    await proto.setBatteryConfig({ ...profile0, capacityMah: 1800 });

    expect((await proto.selectBatteryProfile(1)).success).toBe(true);
    expect((await proto.getBatteryConfig()).capacityMah).toBe(1500);

    await proto.selectBatteryProfile(0);
    expect((await proto.getBatteryConfig()).capacityMah).toBe(1800);
  });

  it("refuses a profile index outside the three the FC carries", async () => {
    const proto = makeCopter();
    expect((await proto.selectBatteryProfile(3)).success).toBe(false);
    expect((await proto.selectBatteryProfile(-1)).success).toBe(false);
    expect((await proto.getBatteryConfig()).capacityMah).toBe(2200);
  });
});

// ── Mixer profiles ───────────────────────────────────────────

describe("mixer config", () => {
  it("reports the quad airframe for the copter mock", async () => {
    const mixer = await makeCopter().getMixerConfig();
    expect(mixer.platformType).toBe(0);
    expect(mixer.motorCount).toBe(4);
    expect(mixer.servoCount).toBe(0);
    expect(mixer.hasFlaps).toBe(false);
  });

  it("motor count matches the seeded motor mixer", async () => {
    const proto = makeCopter();
    const mixer = await proto.getMixerConfig();
    expect((await proto.downloadMotorMixer()).length).toBe(mixer.motorCount);
  });

  it("reports the plane airframe for the plane mock", async () => {
    const mixer = await makePlane().getMixerConfig();
    expect(mixer.platformType).toBe(1);
    expect(mixer.motorCount).toBe(1);
    expect(mixer.servoCount).toBe(5);
    expect(mixer.hasFlaps).toBe(true);
  });

  it("selecting the second profile changes the reported mixer", async () => {
    const proto = makeCopter();
    expect((await proto.getMixerConfig()).yawMotorsReversed).toBe(false);

    expect((await proto.selectMixerProfile(1)).success).toBe(true);
    expect((await proto.getMixerConfig()).yawMotorsReversed).toBe(true);

    await proto.selectMixerProfile(0);
    expect((await proto.getMixerConfig()).yawMotorsReversed).toBe(false);
  });

  it("a profile switch republishes the platform settings", async () => {
    const proto = makeCopter();
    await proto.settings.setSetting("motor_count", 0);
    await proto.selectMixerProfile(1);
    expect(await proto.settings.getSetting("motor_count")).toEqual({ type: "uint8", value: 4 });
    expect(await proto.settings.getSetting("platform_type")).toEqual({ type: "uint8", value: 0 });
  });

  it("refuses a profile index outside the two the FC carries", async () => {
    expect((await makeCopter().selectMixerProfile(2)).success).toBe(false);
  });
});

// ── MC braking ───────────────────────────────────────────────

describe("mc braking", () => {
  it("reports the iNav nav_mc_braking defaults", async () => {
    const braking = await makeCopter().getMcBraking();
    expect(braking.speedThreshold).toBe(100);
    expect(braking.disengageSpeed).toBe(75);
    expect(braking.bankAngle).toBe(40);
  });

  it("a write is visible to the next read", async () => {
    const proto = makeCopter();
    const before = await proto.getMcBraking();
    const result = await proto.setMcBraking({ ...before, boostFactor: 150, timeout: 2500, bankAngle: 30 });
    expect(result.success).toBe(true);

    const after = await proto.getMcBraking();
    expect(after.boostFactor).toBe(150);
    expect(after.timeout).toBe(2500);
    expect(after.bankAngle).toBe(30);
  });
});

// ── Outputs, timers, servos ──────────────────────────────────

describe("output mapping and timer modes", () => {
  it("reports eight outputs and one mode entry per timer they use", async () => {
    const proto = makeCopter();
    const [mapping, modes] = await Promise.all([
      proto.getOutputMapping(),
      proto.getTimerOutputModes(),
    ]);
    expect(mapping.length).toBe(8);

    const mappedTimers = [...new Set(mapping.map((m) => m.timerId))].sort((a, b) => a - b);
    expect(modes.map((m) => m.timerId).sort((a, b) => a - b)).toEqual(mappedTimers);
  });

  it("a timer mode write is visible to the next read and leaves other timers alone", async () => {
    const proto = makeCopter();
    const before = await proto.getTimerOutputModes();
    expect((await proto.setTimerOutputMode([{ timerId: 2, mode: 3 }])).success).toBe(true);

    const after = await proto.getTimerOutputModes();
    expect(after.find((m) => m.timerId === 2)?.mode).toBe(3);
    expect(after.find((m) => m.timerId === 0)?.mode).toBe(before.find((m) => m.timerId === 0)?.mode);
  });

  it("ignores a timer id this board does not have", async () => {
    const proto = makeCopter();
    await proto.setTimerOutputMode([{ timerId: 9, mode: 3 }]);
    expect((await proto.getTimerOutputModes()).some((m) => m.timerId === 9)).toBe(false);
  });
});

describe("servo config", () => {
  it("reports eight slots at 1000-2000 us neutral travel", async () => {
    const servos = await makeCopter().getServoConfigs();
    expect(servos.length).toBe(8);
    expect(servos[0]).toEqual({
      rate: 100, min: 1000, max: 2000, middle: 1500,
      forwardFromChannel: 255, reversedInputSources: 0, flags: 0,
    });
  });

  it("a per-slot write is visible to the next read", async () => {
    const proto = makePlane();
    const before = await proto.getServoConfigs();
    const result = await proto.setServoConfig(2, {
      ...before[2], rate: 80, min: 1100, max: 1900, middle: 1520,
    });
    expect(result.success).toBe(true);

    const after = await proto.getServoConfigs();
    expect(after[2]).toMatchObject({ rate: 80, min: 1100, max: 1900, middle: 1520 });
    expect(after[3]).toEqual(before[3]);
  });

  it("refuses a slot index the FC does not have", async () => {
    const proto = makePlane();
    const cfg: INavServoConfig = (await proto.getServoConfigs())[0];
    expect((await proto.setServoConfig(8, cfg)).success).toBe(false);
    expect((await proto.setServoConfig(-1, cfg)).success).toBe(false);
  });
});

describe("temperature sensor config", () => {
  it("reports eight slots with two populated probes", async () => {
    const sensors = await makeCopter().getTempSensorConfigs();
    expect(sensors.length).toBe(8);
    expect(sensors[0].label).toBe("ESC");
    expect(sensors[0].address.length).toBe(8);
    expect(sensors[1].label).toBe("VREG");
    expect(sensors.slice(2).every((s) => s.type === 0)).toBe(true);
  });

  it("hands back a copy, so a caller cannot reach into mock state", async () => {
    const proto = makeCopter();
    const first = await proto.getTempSensorConfigs();
    first[0].address[0] = 0xff;
    expect((await proto.getTempSensorConfigs())[0].address[0]).toBe(0x28);
  });
});

// ── Serial ports ─────────────────────────────────────────────

describe("serial config", () => {
  it("reports USB VCP plus five UARTs", async () => {
    const ports = await makeCopter().getSerialConfig();
    expect(ports.map((p) => p.identifier)).toEqual([20, 0, 1, 2, 3, 5]);
  });

  it("the 32-bit function mask reads live only after a read has happened", async () => {
    const proto = makeCopter();
    expect(proto.serialConfigExtended()).toBe(false);
    await proto.getSerialConfig();
    expect(proto.serialConfigExtended()).toBe(true);
  });

  it("a write is visible to the next read", async () => {
    const proto = makeCopter();
    const ports = await proto.getSerialConfig();
    ports[4] = { ...ports[4], functions: ports[4].functions | SERIAL_FN_MAVLINK, telemetryBaudRate: 5 };
    expect((await proto.setSerialConfig(ports)).success).toBe(true);

    const after = await proto.getSerialConfig();
    expect(after[4].functions & SERIAL_FN_MAVLINK).toBe(SERIAL_FN_MAVLINK);
    expect(after[4].telemetryBaudRate).toBe(5);
    expect(after[3]).toEqual(ports[3]);
  });
});

// ── DShot ────────────────────────────────────────────────────

describe("dshot command", () => {
  it("records the last command handed to the mock", async () => {
    const proto = makeCopter();
    expect(proto.getLastDshotCommand()).toBeNull();

    expect((await proto.sendDshotCommand(1, 2, [20, 21])).success).toBe(true);
    expect(proto.getLastDshotCommand()).toEqual({ commandType: 1, motorIndex: 2, commands: [20, 21] });
  });
});

// ── LED strip ────────────────────────────────────────────────

describe("led strip config", () => {
  it("reports a full strip with four configured arm LEDs", async () => {
    const leds = await makeCopter().getLedStripConfig();
    expect(leds.length).toBe(32);
    expect(leds.slice(0, 4).every((v) => v !== 0)).toBe(true);
    expect(leds.slice(4).every((v) => v === 0)).toBe(true);
    // Packed configs must stay unsigned; a signed value breaks the strip panel.
    expect(leds.every((v) => v >= 0 && v <= 0xffffffff)).toBe(true);
  });

  it("a write is visible to the next read and leaves untouched slots alone", async () => {
    const proto = makeCopter();
    const before = await proto.getLedStripConfig();
    expect((await proto.setLedStripConfig([0x1234, 0x5678])).success).toBe(true);

    const after = await proto.getLedStripConfig();
    expect(after[0]).toBe(0x1234);
    expect(after[1]).toBe(0x5678);
    expect(after.slice(2)).toEqual(before.slice(2));
  });

  it("the 16-colour palette round-trips", async () => {
    const proto = makeCopter();
    const palette = await proto.getLedColors();
    expect(palette.length).toBe(16);

    palette[2] = { h: 45, s: 200, v: 180 };
    expect((await proto.setLedColors(palette)).success).toBe(true);
    expect((await proto.getLedColors())[2]).toEqual({ h: 45, s: 200, v: 180 });
  });

  it("mode colours update in place by (mode, function)", async () => {
    const proto = makeCopter();
    const before = await proto.getLedStripModeColors();
    expect(before.length).toBe(48);

    expect((await proto.setLedStripModeColor(2, 3, 9)).success).toBe(true);
    const after = await proto.getLedStripModeColors();
    expect(after.length).toBe(48);
    expect(after.find((m) => m.mode === 2 && m.fun === 3)?.color).toBe(9);
    expect(after.find((m) => m.mode === 2 && m.fun === 4)?.color)
      .toBe(before.find((m) => m.mode === 2 && m.fun === 4)?.color);
  });
});

// ── OSD ──────────────────────────────────────────────────────

describe("osd config", () => {
  it("item count matches the layouts header the mock reports", async () => {
    const proto = makeCopter();
    const [header, cfg] = await Promise.all([proto.getOsdLayoutsHeader(), proto.getOsdConfig()]);
    expect(cfg.items.length).toBe(header.itemCount);
  });

  it("derives its scalar fields from the OSD and battery state the panels write", async () => {
    const proto = makeCopter();
    const [cfg, prefs, alarms, battery] = await Promise.all([
      proto.getOsdConfig(),
      proto.getOsdPreferences(),
      proto.getOsdAlarms(),
      proto.getBatteryConfig(),
    ]);
    expect(cfg.videoSystem).toBe(prefs.videoSystem);
    expect(cfg.units).toBe(prefs.units);
    expect(cfg.rssiAlarm).toBe(alarms.rssi);
    expect(cfg.capacityWarning).toBe(battery.capacityWarningMah);
  });

  it("a layout write is visible to the next read", async () => {
    const proto = makeCopter();
    const before = await proto.getOsdConfig();
    const position = osdPosition(7, 3);
    expect((await proto.writeOsdLayout([{ index: 6, position }])).success).toBe(true);

    const after = await proto.getOsdConfig();
    expect(after.items[6].position).toBe(position);
    expect(after.items[7].position).toBe(before.items[7].position);
  });

  it("a layout write carrying a video system moves the OSD preference too", async () => {
    const proto = makeCopter();
    await proto.writeOsdLayout([{ index: 0, position: osdPosition(2, 2) }], 2);
    expect((await proto.getOsdConfig()).videoSystem).toBe(2);
    expect((await proto.getOsdPreferences()).videoSystem).toBe(2);
  });

  it("font upload reports progress once per glyph, ending at the total", async () => {
    const proto = makeCopter();
    const glyphs = Array.from({ length: 6 }, () => new Uint8Array(54));
    const seen: Array<[number, number]> = [];

    const result = await proto.uploadOsdFont(glyphs, (done, total) => seen.push([done, total]));
    expect(result.success).toBe(true);
    expect(seen.map(([done]) => done)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(seen.every(([, total]) => total === glyphs.length)).toBe(true);
    expect(seen[seen.length - 1]).toEqual([6, 6]);
  });
});

// ── Programming global variables ─────────────────────────────

describe("global variable status", () => {
  it("reports eight values that stay stable across reads", async () => {
    const proto = makeCopter();
    const first = await proto.downloadGvarStatus();
    expect(first.values.length).toBe(8);
    expect((await proto.downloadGvarStatus()).values).toEqual(first.values);
  });
});

// ── FTP and the MAVLink-only surface ─────────────────────────

describe("ftp download", () => {
  it("refuses the way the real MSP adapter does", async () => {
    await expect(makeCopter().downloadFileViaFtp()).rejects.toThrow(
      "MAVLink FTP is not available over MSP",
    );
  });
});

describe("MAVLink-only surface", () => {
  it("stays absent, so panels keep showing the honest not-supported answer", () => {
    const proto = makeCopter() as unknown as Record<string, unknown>;
    for (const name of ["actuatorTest", "listDirectoryViaFtp", "removeFileViaFtp", "uploadFileViaFtp"]) {
      expect(proto[name]).toBeUndefined();
    }
  });
});

// ── Instance isolation ───────────────────────────────────────

describe("instance isolation", () => {
  it("one drone's config edits do not leak into another's", async () => {
    const edited = makeCopter();
    const untouched = makeCopter();

    await edited.setLedStripConfig([0xdeadbeef]);
    await edited.setTimerOutputMode([{ timerId: 0, mode: 3 }]);
    await edited.setServoConfig(0, { ...(await edited.getServoConfigs())[0], min: 1200 });
    await edited.setLedStripModeColor(0, 0, 12);

    expect((await untouched.getLedStripConfig())[0]).not.toBe(0xdeadbeef);
    expect((await untouched.getTimerOutputModes()).find((m) => m.timerId === 0)?.mode).toBe(1);
    expect((await untouched.getServoConfigs())[0].min).toBe(1000);
    expect((await untouched.getLedStripModeColors())[0].color).not.toBe(12);
  });
});
