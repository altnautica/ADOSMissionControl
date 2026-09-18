import { describe, it, expect } from 'vitest'
import {
  INAV_MSP,
  decodeMspWp,
  decodeMspINavStatus,
  decodeMspINavMisc2,
  decodeMspINavSafehome,
  decodeMspINavNavConfigLegacy,
  decodeMspINavMisc,
  decodeMspINavBatteryConfig,
  decodeMspINavRateProfile,
  decodeMspINavAirSpeed,
  decodeMspINavMixer,
  decodeMspINavMcBraking,
  decodeMspINavGeozone,
  decodeMspINavGeozoneVertex,
  decodeMspINavAnalog,
  decodeMspINavTemperatures,
  decodeMspINavEzTune,
  decodeMspINavLogicConditions,
  decodeMspINavProgrammingPid,
  decodeMspINavOsdAlarms,
  decodeMspINavOsdPreferences,
  decodeCommonSetting,
  decodeCommonSettingInfo,
  decodeCommonPgList,
} from '@/lib/protocol/msp/msp-decoders-inav'
import {
  inavHandler,
  INAV_MIN_MAJOR,
  meetsInavMinimum,
} from '@/lib/protocol/firmware/inav'

// ── Helpers ───────────────────────────────────────────────────

function dv(bytes: number[]): DataView {
  return new DataView(new Uint8Array(bytes).buffer)
}

function le16(v: number): [number, number] {
  return [v & 0xff, (v >> 8) & 0xff]
}

function le32(v: number): [number, number, number, number] {
  return [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff]
}

function s32ToLE(v: number): [number, number, number, number] {
  const buf = new Uint8Array(4)
  new DataView(buf.buffer).setInt32(0, v, true)
  return [buf[0], buf[1], buf[2], buf[3]]
}

// ── INAV_MSP command catalog ──────────────────────────────────

describe('INAV_MSP command catalog', () => {
  it('includes MSP2_INAV_STATUS at 0x2000', () => {
    expect(INAV_MSP.MSP2_INAV_STATUS).toBe(0x2000)
  })

  it('includes MSP2_COMMON_SETTING at 0x1003', () => {
    expect(INAV_MSP.MSP2_COMMON_SETTING).toBe(0x1003)
  })

  it('includes MSP2_COMMON_SET_SETTING at 0x1004', () => {
    expect(INAV_MSP.MSP2_COMMON_SET_SETTING).toBe(0x1004)
  })

  it('includes MSP2_COMMON_SETTING_INFO at 0x1007', () => {
    expect(INAV_MSP.MSP2_COMMON_SETTING_INFO).toBe(0x1007)
  })

  it('includes MSP2_COMMON_PG_LIST at 0x1008', () => {
    expect(INAV_MSP.MSP2_COMMON_PG_LIST).toBe(0x1008)
  })

  it('includes MSP2_INAV_SAFEHOME at 0x2038', () => {
    expect(INAV_MSP.MSP2_INAV_SAFEHOME).toBe(0x2038)
  })

  it('includes MSP2_INAV_GEOZONE at 0x2210', () => {
    expect(INAV_MSP.MSP2_INAV_GEOZONE).toBe(0x2210)
  })

  it('legacy nav config ID documented at 0x2100', () => {
    expect(INAV_MSP.MSP2_INAV_NAV_CONFIG_LEGACY).toBe(0x2100)
  })
})

// ── meetsInavMinimum ──────────────────────────────────────────

describe('meetsInavMinimum', () => {
  it('passes for version at the minimum major', () => {
    expect(meetsInavMinimum(`iNav ${INAV_MIN_MAJOR}.0.0`)).toBe(true)
  })

  it('passes for a version higher than the minimum', () => {
    expect(meetsInavMinimum('INAV 8.1.0 (MSP API 2.5)')).toBe(true)
  })

  it('fails for a version below the minimum', () => {
    expect(meetsInavMinimum(`iNav ${INAV_MIN_MAJOR - 1}.9.9`)).toBe(false)
  })

  it('fails for a string without a version number', () => {
    expect(meetsInavMinimum('unknown firmware')).toBe(false)
  })
})

// ── decodeMspWp ───────────────────────────────────────────────

describe('decodeMspWp', () => {
  it('decodes a valid waypoint payload', () => {
    // wp#3, action=1(WAYPOINT), lat=12.345678° lon=77.591671°
    const lat = Math.round(12.345678 * 1e7)
    const lon = Math.round(77.591671 * 1e7)
    const alt = 5000 // cm
    const bytes: number[] = [
      3,             // wp number
      1,             // action: WAYPOINT
      ...s32ToLE(lat),
      ...s32ToLE(lon),
      ...s32ToLE(alt),
      ...le16(0),   // p1
      ...le16(0),   // p2
      ...le16(0),   // p3
      0xa5,         // flag
    ]
    const result = decodeMspWp(dv(bytes))
    expect(result.number).toBe(3)
    expect(result.action).toBe(1)
    expect(result.lat).toBeCloseTo(12.345678, 5)
    expect(result.lon).toBeCloseTo(77.591671, 5)
    expect(result.altitude).toBe(5000)
    expect(result.flag).toBe(0xa5)
  })

  it('decodes signed p1/p2 (SET_HEAD -1 sentinel, below-home LAND elevation)', () => {
    const bytes: number[] = [
      5, 8, // wp#5, action LAND(8)
      ...s32ToLE(0), ...s32ToLE(0), ...s32ToLE(0),
      ...le16(0xffff), // p1 = -1 (SET_HEAD "no fixed heading" sentinel)
      ...le16(0xffe2), // p2 = -30 (landing site 30 m below home)
      ...le16(1), //     p3 = MSL altitude-datum bit
      0xa5,
    ]
    const r = decodeMspWp(dv(bytes))
    expect(r.p1).toBe(-1)
    expect(r.p2).toBe(-30)
    expect(r.p3).toBe(1) // p3 stays unsigned (bitfield)
  })
})

// ── decodeMspINavStatus ───────────────────────────────────────

describe('decodeMspINavStatus', () => {
  it('decodes the layout iNav actually writes', () => {
    // From iNav `fc_msp.c` `mspFcProcessOutCommand`, case MSP2_INAV_STATUS:
    //   U16 cycleTime, U16 i2cErrors, U16 sensorStatus, U16 averageSystemLoad,
    //   U8 batteryProfile<<4|configProfile, U32 armingFlags, boxModeFlags...
    // The decoder previously assumed a reserved gap at 6, modeFlags at 8,
    // armingFlags at 17 and nav fields at 21/22 — every field past byte 6 was
    // read from the wrong offset, and nav state is not in this message at all.
    const cycleTime = 1234
    const i2cErrors = 2
    const sensors = 0x0049
    const averageLoad = 42
    const profiles = 0x21 // battery profile 2, config profile 1
    const armingFlags = 0x00000100 // NOT_LEVEL

    const bytes: number[] = [
      ...le16(cycleTime),
      ...le16(i2cErrors),
      ...le16(sensors),
      ...le16(averageLoad),
      profiles,
      ...le32(armingFlags),
      // boxModeFlags tail — present on the wire, not decoded here.
      0xff, 0x00, 0x00, 0x00,
    ]
    const result = decodeMspINavStatus(dv(bytes))
    expect(result.cycleTime).toBe(cycleTime)
    expect(result.i2cErrors).toBe(i2cErrors)
    expect(result.sensors).toBe(sensors)
    expect(result.averageLoadPercent).toBe(averageLoad)
    expect(result.profiles).toBe(profiles)
    // The box bitmask must NOT be mistaken for the arming word: reading it
    // there made active mode boxes render as arming blockers.
    expect(result.armingFlags).toBe(armingFlags)
  })
})

// ── decodeMspINavMisc2 ────────────────────────────────────────

describe('decodeMspINavMisc2', () => {
  it('decodes timing fields', () => {
    const bytes: number[] = [
      ...le32(3600),  // onTime
      ...le32(900),   // flyTime
      ...le32(100),   // lastArmTime
      ...le32(850),   // totalArmTime
      0x01,           // flags
    ]
    const result = decodeMspINavMisc2(dv(bytes))
    expect(result.onTime).toBe(3600)
    expect(result.flyTime).toBe(900)
    expect(result.totalArmTime).toBe(850)
    expect(result.flags).toBe(1)
  })
})

// ── decodeMspINavSafehome ─────────────────────────────────────

describe('decodeMspINavSafehome', () => {
  it('decodes safehome coordinates', () => {
    const lat = Math.round(12.345 * 1e7)
    const lon = Math.round(77.591 * 1e7)
    const bytes: number[] = [
      1,           // index
      1,           // enabled
      ...s32ToLE(lat),
      ...s32ToLE(lon),
    ]
    const result = decodeMspINavSafehome(dv(bytes))
    expect(result.index).toBe(1)
    expect(result.enabled).toBe(true)
    expect(result.lat).toBeCloseTo(12.345, 4)
    expect(result.lon).toBeCloseTo(77.591, 4)
  })

  it('treats enabled=0 as false', () => {
    const bytes: number[] = [0, 0, ...s32ToLE(0), ...s32ToLE(0)]
    expect(decodeMspINavSafehome(dv(bytes)).enabled).toBe(false)
  })
})

// ── decodeMspINavNavConfigLegacy ──────────────────────────────

describe('decodeMspINavNavConfigLegacy', () => {
  it('decodes without throwing and returns expected fields', () => {
    // maxNavAltitude is U32 at offset 0, maxNavSpeed is U16 at offset 4
    const bytes = new Array(26).fill(0)
    const dv2 = new DataView(new Uint8Array(bytes).buffer)
    dv2.setUint32(0, 5000, true) // maxNavAltitude (U32)
    dv2.setUint16(4, 3000, true) // maxNavSpeed (U16)
    const result = decodeMspINavNavConfigLegacy(new DataView(dv2.buffer))
    expect(result.maxNavAltitude).toBe(5000)
    expect(result.maxNavSpeed).toBe(3000)
  })
})

// ── decodeMspINavMisc ─────────────────────────────────────────

describe('decodeMspINavMisc', () => {
  it('decodes all numeric fields', () => {
    const bytes: number[] = [
      ...le16(1500),  // midrc
      ...le16(1050),  // minthrottle
      ...le16(2000),  // maxthrottle
      ...le16(1000),  // mincommand
      ...le16(1200),  // failsafeThrottle
      2,              // gpsProvider
      0,              // gpsBaudrateIdx
      0,              // gpsUbxSbas
      0,              // multiwiiCurrentOutput
      0,              // rssiChannel
      0,              // placeholder
      ...le16(0),     // magDeclination
      100,            // voltageScale
      33,             // cellMin
      42,             // cellMax
      37,             // cellWarning
    ]
    const result = decodeMspINavMisc(dv(bytes))
    expect(result.midrc).toBe(1500)
    expect(result.minthrottle).toBe(1050)
    expect(result.maxthrottle).toBe(2000)
    expect(result.gpsProvider).toBe(2)
    expect(result.voltageScale).toBe(100)
  })
})

// ── decodeMspINavBatteryConfig ────────────────────────────────

describe('decodeMspINavBatteryConfig', () => {
  it('decodes capacity and cell voltage fields', () => {
    const bytes: number[] = [
      ...le32(5000),  // capacityMah
      ...le32(1000),  // capacityWarningMah
      ...le32(500),   // capacityCriticalMah
      0,              // capacityUnit
      0,              // voltageSource
      6,              // cells
      0,              // cellDetect
      ...le16(3300),  // cellMin (mV)
      ...le16(4200),  // cellMax (mV)
      ...le16(3700),  // cellWarning (mV)
      ...le16(100),   // currentScale
      ...le16(0),     // currentOffset
    ]
    const result = decodeMspINavBatteryConfig(dv(bytes))
    expect(result.capacityMah).toBe(5000)
    expect(result.cells).toBe(6)
    expect(result.cellMin).toBe(3300)
    expect(result.cellMax).toBe(4200)
  })
})

// ── decodeMspINavRateProfile ──────────────────────────────────

describe('decodeMspINavRateProfile', () => {
  it('decodes rate fields', () => {
    const bytes = [50, 10, 0, 70, 70, 100, 0, 0, 0, 70, 70, 100]
    const result = decodeMspINavRateProfile(dv(bytes))
    expect(result.throttleMid).toBe(50)
    expect(result.rcRateRoll).toBe(70)
    expect(result.rateYaw).toBe(100)
  })
})

// ── decodeMspINavAirSpeed ─────────────────────────────────────

describe('decodeMspINavAirSpeed', () => {
  it('decodes air speed value', () => {
    const bytes = [...le32(1500)]
    const result = decodeMspINavAirSpeed(dv(bytes))
    expect(result.airSpeedCmS).toBe(1500)
  })
})

// ── decodeMspINavMixer ────────────────────────────────────────

describe('decodeMspINavMixer', () => {
  it('decodes platform type and motor count', () => {
    // platformType=0 at [0], yawMotorsReversed at [1], hasFlaps at [2],
    // appliedMixerPreset U16 at [3-4], motorCount at [5], servoCount at [6]
    const bytes = [0, 0, 0, 0, 0, 4, 0]
    const result = decodeMspINavMixer(dv(bytes))
    expect(result.platformType).toBe(0)
    expect(result.motorCount).toBe(4)
  })
})

// ── decodeMspINavMcBraking ────────────────────────────────────

describe('decodeMspINavMcBraking', () => {
  it('decodes multicopter braking config', () => {
    const bytes: number[] = [...le16(150), ...le16(10), ...le16(50), ...le16(1000), 1, ...le16(100), ...le16(0)]
    const result = decodeMspINavMcBraking(dv(bytes))
    expect(result.speedThreshold).toBe(150)
    expect(result.disengageSpeed).toBe(10)
  })
})

// ── decodeMspINavGeozone ──────────────────────────────────────

describe('decodeMspINavGeozone', () => {
  it('decodes geozone header fields', () => {
    const minAlt = -100
    const maxAlt = 12000
    const bytes: number[] = [
      2,                 // number (zone index)
      0,                 // type: EXCLUSIVE
      1,                 // shape: POLYGON
      ...s32ToLE(minAlt),
      ...s32ToLE(maxAlt),
      2,                 // fenceAction
      4,                 // vertexCount
      0,                 // isSeaLevelRef
      1,                 // enabled
    ]
    const result = decodeMspINavGeozone(dv(bytes))
    expect(result.number).toBe(2)
    expect(result.type).toBe(0)
    expect(result.shape).toBe(1)
    expect(result.minAlt).toBe(minAlt)
    expect(result.maxAlt).toBe(maxAlt)
    expect(result.vertexCount).toBe(4)
    expect(result.enabled).toBe(true)
  })
})

// ── decodeMspINavGeozoneVertex ────────────────────────────────

describe('decodeMspINavGeozoneVertex', () => {
  it('decodes vertex coordinates', () => {
    const lat = Math.round(12.5 * 1e7)
    const lon = Math.round(77.5 * 1e7)
    const bytes: number[] = [
      1,    // geozoneId
      0,    // vertexIdx
      ...s32ToLE(lat),
      ...s32ToLE(lon),
    ]
    const result = decodeMspINavGeozoneVertex(dv(bytes))
    expect(result.geozoneId).toBe(1)
    expect(result.vertexIdx).toBe(0)
    expect(result.lat).toBeCloseTo(12.5, 4)
    expect(result.lon).toBeCloseTo(77.5, 4)
  })
})

// ── decodeCommonSetting ───────────────────────────────────────

describe('decodeCommonSetting', () => {
  it('wraps payload as raw bytes', () => {
    const bytes = [0x0A, 0x00]
    const result = decodeCommonSetting(dv(bytes))
    expect(result.raw).toBeInstanceOf(Uint8Array)
    expect(result.raw[0]).toBe(0x0A)
  })
})

// ── decodeCommonSettingInfo ───────────────────────────────────

describe('decodeCommonSettingInfo', () => {
  it('decodes all metadata fields (firmware layout: name-first)', () => {
    const name = 'nav_fw_cruise_speed'
    const bytes: number[] = [
      ...[...name].map((c) => c.charCodeAt(0)), 0, // name + null terminator
      ...le16(42),      // pgId
      2,                // type: UINT16
      0,                // section
      0,                // mode
      ...le32(0),       // min (signed)
      ...le32(1000),    // max (unsigned)
      ...le16(7),       // index
      1,                // profileCurrent
      2,                // profileCount
    ]
    const result = decodeCommonSettingInfo(dv(bytes))
    expect(result.name).toBe(name)
    expect(result.pgId).toBe(42)
    expect(result.type).toBe(2)
    expect(result.max).toBe(1000)
    expect(result.index).toBe(7)
    expect(result.profileCount).toBe(2)
  })
})

// ── decodeCommonPgList ────────────────────────────────────────

describe('decodeCommonPgList', () => {
  it('decodes multiple PG IDs', () => {
    const bytes: number[] = [...le16(100), ...le16(200), ...le16(300)]
    const result = decodeCommonPgList(dv(bytes))
    expect(result.pgIds).toHaveLength(3)
    expect(result.pgIds[0]).toBe(100)
    expect(result.pgIds[1]).toBe(200)
    expect(result.pgIds[2]).toBe(300)
  })

  it('returns empty array for empty payload', () => {
    const result = decodeCommonPgList(dv([]))
    expect(result.pgIds).toHaveLength(0)
  })
})

// ── inavHandler capabilities ──────────────────────────────────

describe('inavHandler capabilities', () => {
  const caps = inavHandler.getCapabilities()

  it('supports safehomes', () => {
    expect(caps.supportsSafehome).toBe(true)
  })

  it('supports geozones', () => {
    expect(caps.supportsGeozone).toBe(true)
  })

  it('supports logic conditions', () => {
    expect(caps.supportsLogicConditions).toBe(true)
  })

  it('supports multi-mission', () => {
    expect(caps.supportsMultiMission).toBe(true)
  })

  it('supports the settings system', () => {
    expect(caps.supportsSettings).toBe(true)
  })

  it('does not support mavlink inspector', () => {
    expect(caps.supportsMavlinkInspector).toBe(false)
  })
})

// ── Zero-length / short-payload safety ────────────────────────
//
// List decoders return [] on empty or truncated payloads.
// Scalar decoders throw RangeError when the payload is shorter than the
// minimum required size (DataView enforces bounds at the byte level).

describe('decodeMspINavAnalog - short payload', () => {
  it('throws RangeError on empty payload (requires at least 7 bytes)', () => {
    expect(() =>
      decodeMspINavAnalog(new DataView(new Uint8Array(0).buffer))
    ).toThrow(RangeError)
  })
})

describe('decodeMspINavMisc - short payload', () => {
  it('throws RangeError on empty payload (fixed-width struct)', () => {
    expect(() =>
      decodeMspINavMisc(new DataView(new Uint8Array(0).buffer))
    ).toThrow(RangeError)
  })
})

describe('decodeMspINavBatteryConfig - short payload', () => {
  it('throws RangeError on empty payload (fixed-width struct)', () => {
    expect(() =>
      decodeMspINavBatteryConfig(new DataView(new Uint8Array(0).buffer))
    ).toThrow(RangeError)
  })
})

describe('decodeMspINavMixer - short payload', () => {
  it('throws RangeError on empty payload (fixed-width struct)', () => {
    expect(() =>
      decodeMspINavMixer(new DataView(new Uint8Array(0).buffer))
    ).toThrow(RangeError)
  })
})

describe('decodeMspINavLogicConditions - short payload', () => {
  it('returns empty array on empty payload', () => {
    const result = decodeMspINavLogicConditions(new DataView(new Uint8Array(0).buffer))
    expect(result).toEqual([])
  })

  it('returns empty array on payload shorter than one entry (13 bytes)', () => {
    const result = decodeMspINavLogicConditions(new DataView(new Uint8Array(13).buffer))
    expect(result).toEqual([])
  })
})

describe('decodeMspINavProgrammingPid - short payload', () => {
  it('returns empty array on empty payload', () => {
    const result = decodeMspINavProgrammingPid(new DataView(new Uint8Array(0).buffer))
    expect(result).toEqual([])
  })
})

describe('decodeMspINavGeozone - short payload', () => {
  it('throws RangeError on empty payload (fixed-width struct)', () => {
    expect(() =>
      decodeMspINavGeozone(new DataView(new Uint8Array(0).buffer))
    ).toThrow(RangeError)
  })
})

describe('decodeMspINavGeozoneVertex - short payload', () => {
  it('throws RangeError on empty payload (fixed-width struct)', () => {
    expect(() =>
      decodeMspINavGeozoneVertex(new DataView(new Uint8Array(0).buffer))
    ).toThrow(RangeError)
  })
})

describe('decodeMspINavTemperatures - short payload', () => {
  it('returns 8 sentinel values on empty payload', () => {
    const result = decodeMspINavTemperatures(new DataView(new Uint8Array(0).buffer))
    expect(result).toHaveLength(8)
    expect(result[0]).toBe(0x8000)
    expect(result[7]).toBe(0x8000)
  })
})

describe('decodeMspINavEzTune - short payload', () => {
  it('throws RangeError on empty payload (fixed-width struct)', () => {
    expect(() =>
      decodeMspINavEzTune(new DataView(new Uint8Array(0).buffer))
    ).toThrow(RangeError)
  })
})

describe('decodeMspINavOsdAlarms - short payload', () => {
  it('returns zero-filled defaults on empty payload', () => {
    const result = decodeMspINavOsdAlarms(new DataView(new Uint8Array(0).buffer))
    expect(result.rssi).toBe(0)
    expect(result.flyMinutes).toBe(0)
    expect(result.imuTempMin).toBe(0)
    expect(result.adsbDistanceAlert).toBe(0)
  })
})

describe('decodeMspINavOsdPreferences - short payload', () => {
  it('returns zero-filled defaults on empty payload', () => {
    const result = decodeMspINavOsdPreferences(new DataView(new Uint8Array(0).buffer))
    expect(result.videoSystem).toBe(0)
    expect(result.units).toBe(0)
    expect(result.adsbWarningStyle).toBe(0)
  })
})
