/**
 * @module fc/betaflight/bf-osd-constants.test
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";
import {
  BF_OSD_ELEMENT_DEFS, decodePosition, encodePosition, isVisibleInProfile, osdElementDef,
  videoSystemFromCode, VIDEO_SYSTEM_CODES,
} from "../bf-osd-constants";

// The firmware's position macros (osd/osd.h), written out literally.
const OSD_POSITION_BITS = 5;
const OSD_POSITION_BIT_XHD = 10;
const OSD_POSITION_XHD_MASK = 1 << OSD_POSITION_BIT_XHD;
const OSD_POSITION_XY_MASK = (1 << OSD_POSITION_BITS) - 1;
const OSD_PROFILE_FLAG = (p: number) => 1 << (p - 1 + 11);
const OSD_POS = (x: number, y: number) =>
  (x & OSD_POSITION_XY_MASK) |
  ((x << (OSD_POSITION_BIT_XHD - OSD_POSITION_BITS)) & OSD_POSITION_XHD_MASK) |
  ((y & OSD_POSITION_XY_MASK) << OSD_POSITION_BITS);
const OSD_X = (w: number) =>
  (w & OSD_POSITION_XY_MASK) | ((w & OSD_POSITION_XHD_MASK) >> (OSD_POSITION_BIT_XHD - OSD_POSITION_BITS));
const OSD_Y = (w: number) => (w >> OSD_POSITION_BITS) & OSD_POSITION_XY_MASK;

/** `osd_items_e` (osd/osd.h), in declaration order. */
const FIRMWARE_ITEMS = [
  "RSSI_VALUE", "MAIN_BATT_VOLTAGE", "CROSSHAIRS", "ARTIFICIAL_HORIZON", "HORIZON_SIDEBARS",
  "ITEM_TIMER_1", "ITEM_TIMER_2", "FLYMODE", "CRAFT_NAME", "THROTTLE_POS", "VTX_CHANNEL",
  "CURRENT_DRAW", "MAH_DRAWN", "GPS_SPEED", "GPS_SATS", "ALTITUDE", "ROLL_PIDS", "PITCH_PIDS",
  "YAW_PIDS", "POWER", "PIDRATE_PROFILE", "WARNINGS", "AVG_CELL_VOLTAGE", "GPS_LON", "GPS_LAT",
  "DEBUG", "PITCH_ANGLE", "ROLL_ANGLE", "MAIN_BATT_USAGE", "DISARMED", "HOME_DIR", "HOME_DIST",
  "NUMERICAL_HEADING", "NUMERICAL_VARIO", "COMPASS_BAR", "ESC_TMP", "ESC_RPM",
  "REMAINING_TIME_ESTIMATE", "RTC_DATETIME", "ADJUSTMENT_RANGE", "CORE_TEMPERATURE",
  "ANTI_GRAVITY", "G_FORCE", "MOTOR_DIAG", "LOG_STATUS", "FLIP_ARROW", "LINK_QUALITY",
  "FLIGHT_DIST", "STICK_OVERLAY_LEFT", "STICK_OVERLAY_RIGHT", "PILOT_NAME", "ESC_RPM_FREQ",
  "RATE_PROFILE_NAME", "PID_PROFILE_NAME", "PROFILE_NAME", "RSSI_DBM_VALUE", "RC_CHANNELS",
  "CAMERA_FRAME", "EFFICIENCY", "TOTAL_FLIGHTS", "UP_DOWN_REFERENCE", "TX_UPLINK_POWER",
  "WATT_HOURS_DRAWN", "AUX_VALUE", "READY_MODE", "RSNR_VALUE", "SYS_GOGGLE_VOLTAGE",
  "SYS_VTX_VOLTAGE", "SYS_BITRATE", "SYS_DELAY", "SYS_DISTANCE", "SYS_LQ", "SYS_GOGGLE_DVR",
  "SYS_VTX_DVR", "SYS_WARNINGS", "SYS_VTX_TEMP", "SYS_FAN_SPEED", "GPS_LAP_TIME_CURRENT",
  "GPS_LAP_TIME_PREVIOUS", "GPS_LAP_TIME_BEST3",
] as const;

describe("Betaflight OSD element table", () => {
  it("has one entry per osd_items_e value, id equal to its ordinal", () => {
    expect(BF_OSD_ELEMENT_DEFS.length).toBe(FIRMWARE_ITEMS.length);
    BF_OSD_ELEMENT_DEFS.forEach((def, i) => expect(def.id).toBe(i));
  });

  it("puts the elements whose ids are easy to confuse at their firmware ordinals", () => {
    const at = (cName: (typeof FIRMWARE_ITEMS)[number]) => BF_OSD_ELEMENT_DEFS[FIRMWARE_ITEMS.indexOf(cName)].name;
    expect(at("NUMERICAL_HEADING")).toBe("Numerical Heading");
    expect(at("NUMERICAL_VARIO")).toBe("Numerical Vario");
    expect(at("COMPASS_BAR")).toBe("Compass Bar");
    expect(at("FLIP_ARROW")).toBe("Flip Arrow");
    expect(at("LINK_QUALITY")).toBe("Link Quality");
    expect(at("FLIGHT_DIST")).toBe("Flight Distance");
    expect(at("PILOT_NAME")).toBe("Pilot Name");
    expect(at("RC_CHANNELS")).toBe("RC Channels");
    expect(at("CAMERA_FRAME")).toBe("Camera Frame");
    expect(at("TX_UPLINK_POWER")).toBe("TX Uplink Power");
    expect(at("GPS_LAP_TIME_BEST3")).toBe("Lap Time Best 3");
  });

  it("names an element newer than the table by its id", () => {
    expect(osdElementDef(95).name).toBe("Element 95");
  });
});

describe("Betaflight OSD position word", () => {
  it("decodes x/y exactly as OSD_X/OSD_Y, including the HD x bit", () => {
    for (const [x, y] of [[0, 0], [1, 1], [29, 15], [31, 19], [32, 7], [52, 19], [63, 31]]) {
      const word = OSD_POS(x, y) | OSD_PROFILE_FLAG(1);
      const el = decodePosition(word, 0);
      expect([el.x, el.y]).toEqual([OSD_X(word), OSD_Y(word)]);
      expect([el.x, el.y]).toEqual([x, y]);
    }
  });

  it("reads bits 11-13 as per-profile visibility", () => {
    const el = decodePosition(OSD_POS(3, 4) | OSD_PROFILE_FLAG(1), 7);
    expect(el.profiles).toBe(0b001);
    expect(isVisibleInProfile(el, 1)).toBe(true);
    expect(isVisibleInProfile(el, 2)).toBe(false);
    const p23 = decodePosition(OSD_POS(3, 4) | OSD_PROFILE_FLAG(2) | OSD_PROFILE_FLAG(3), 7);
    expect(p23.profiles).toBe(0b110);
  });

  it("round-trips every bit, keeping the variant bits and the HD x bit", () => {
    for (const word of [0x0000, 0x0821, 0xc863, 0x4c21, 0xffff, OSD_POS(52, 19) | OSD_PROFILE_FLAG(3) | 0x8000]) {
      expect(encodePosition(decodePosition(word, 21))).toBe(word);
    }
  });

  it("hiding an element in profile 1 clears only its profile bit", () => {
    const word = OSD_POS(9, 10) | OSD_PROFILE_FLAG(1) | 0x4000;
    const el = decodePosition(word, 21);
    expect(encodePosition({ ...el, profiles: el.profiles & ~1 })).toBe(OSD_POS(9, 10) | 0x4000);
  });
});

describe("Betaflight video system", () => {
  it("maps videoSystem_e including HD", () => {
    expect(VIDEO_SYSTEM_CODES).toEqual({ AUTO: 0, PAL: 1, NTSC: 2, HD: 3 });
    expect(videoSystemFromCode(3)).toBe("HD");
    expect(videoSystemFromCode(1)).toBe("PAL");
  });
});
