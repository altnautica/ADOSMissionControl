import { describe, it, expect } from 'vitest'
import {
  encodeMspSetWp,
  encodeMspINavSetSafehome,
  encodeCommonSetting,
  encodeCommonSetSetting,
  encodeCommonSettingInfo,
  encodeMspINavSetMisc,
  encodeMspINavSetBatteryConfig,
  encodeMspINavSelectBatteryProfile,
  encodeMspINavSelectMixerProfile,
} from '@/lib/protocol/msp/msp-encoders-inav'
import type { INavWaypoint, INavSafehome } from '@/lib/protocol/msp/msp-decoders-inav'

// ── Helpers ───────────────────────────────────────────────────

function readU8(buf: Uint8Array, offset: number): number {
  return buf[offset]
}

function readU16LE(buf: Uint8Array, offset: number): number {
  return buf[offset] | (buf[offset + 1] << 8)
}

function readS32LE(buf: Uint8Array, offset: number): number {
  return new DataView(buf.buffer, buf.byteOffset + offset, 4).getInt32(0, true)
}

function readU32LE(buf: Uint8Array, offset: number): number {
  return new DataView(buf.buffer, buf.byteOffset + offset, 4).getUint32(0, true)
}

// ── encodeMspSetWp ────────────────────────────────────────────

describe('encodeMspSetWp', () => {
  it('produces a 21-byte payload', () => {
    const wp: INavWaypoint = { number: 1, action: 1, lat: 12.5, lon: 77.5, altitude: 3000, p1: 0, p2: 0, p3: 0, flag: 0 }
    expect(encodeMspSetWp(wp).byteLength).toBe(21)
  })

  it('encodes waypoint number at byte 0', () => {
    const wp: INavWaypoint = { number: 5, action: 1, lat: 0, lon: 0, altitude: 0, p1: 0, p2: 0, p3: 0, flag: 0 }
    expect(readU8(encodeMspSetWp(wp), 0)).toBe(5)
  })

  it('encodes lat x1e7 little-endian at bytes 2-5', () => {
    const lat = 12.345678
    const wp: INavWaypoint = { number: 1, action: 1, lat, lon: 0, altitude: 0, p1: 0, p2: 0, p3: 0, flag: 0 }
    const buf = encodeMspSetWp(wp)
    expect(readS32LE(buf, 2)).toBe(Math.round(lat * 1e7))
  })

  it('encodes the flag byte at position 20', () => {
    const wp: INavWaypoint = { number: 1, action: 1, lat: 0, lon: 0, altitude: 0, p1: 0, p2: 0, p3: 0, flag: 0xa5 }
    expect(readU8(encodeMspSetWp(wp), 20)).toBe(0xa5)
  })
})

// ── encodeMspINavSetSafehome ──────────────────────────────────

describe('encodeMspINavSetSafehome', () => {
  it('produces a 10-byte payload', () => {
    const sh: INavSafehome = { index: 0, enabled: true, lat: 12.5, lon: 77.5 }
    expect(encodeMspINavSetSafehome(sh).byteLength).toBe(10)
  })

  it('encodes enabled flag correctly', () => {
    const enabled: INavSafehome = { index: 0, enabled: true, lat: 0, lon: 0 }
    const disabled: INavSafehome = { index: 0, enabled: false, lat: 0, lon: 0 }
    expect(readU8(encodeMspINavSetSafehome(enabled), 1)).toBe(1)
    expect(readU8(encodeMspINavSetSafehome(disabled), 1)).toBe(0)
  })

  it('encodes lat x1e7 at bytes 2-5', () => {
    const lat = 12.345
    const sh: INavSafehome = { index: 0, enabled: true, lat, lon: 0 }
    expect(readS32LE(encodeMspINavSetSafehome(sh), 2)).toBe(Math.round(lat * 1e7))
  })
})

// ── encodeCommonSetting ───────────────────────────────────────

describe('encodeCommonSetting', () => {
  it('encodes name as null-terminated ASCII', () => {
    const name = 'nav_mc_pos_z_p'
    const buf = encodeCommonSetting(name)
    expect(buf.byteLength).toBe(name.length + 1)
    expect(buf[name.length]).toBe(0) // null terminator
    expect(String.fromCharCode(...buf.subarray(0, name.length))).toBe(name)
  })

  it('handles empty string', () => {
    const buf = encodeCommonSetting('')
    expect(buf.byteLength).toBe(1)
    expect(buf[0]).toBe(0)
  })
})

// ── encodeCommonSetSetting ────────────────────────────────────

describe('encodeCommonSetSetting', () => {
  it('concatenates name (null-terminated) with raw value bytes', () => {
    const name = 'osd_crosshairs'
    const rawValue = new Uint8Array([1])
    const buf = encodeCommonSetSetting(name, rawValue)
    expect(buf.byteLength).toBe(name.length + 1 + rawValue.length)
    // null terminator after name
    expect(buf[name.length]).toBe(0)
    // raw value follows
    expect(buf[name.length + 1]).toBe(1)
  })

  it('handles multi-byte raw values', () => {
    const name = 'nav_fw_cruise_speed'
    const rawValue = new Uint8Array([0x90, 0x01]) // 400 as little-endian u16
    const buf = encodeCommonSetSetting(name, rawValue)
    expect(buf[name.length + 1]).toBe(0x90)
    expect(buf[name.length + 2]).toBe(0x01)
  })
})

// ── encodeCommonSettingInfo ───────────────────────────────────

describe('encodeCommonSettingInfo', () => {
  it('produces the same layout as encodeCommonSetting (name only)', () => {
    const name = 'debug_mode'
    const a = encodeCommonSetting(name)
    const b = encodeCommonSettingInfo(name)
    expect(a).toEqual(b)
  })
})

// ── encodeMspINavSetMisc ──────────────────────────────────────

describe('encodeMspINavSetMisc', () => {
  const misc = {
    midrc: 1500, minthrottle: 1050, maxthrottle: 2000,
    mincommand: 1000, failsafeThrottle: 1200,
    gpsProvider: 2, gpsBaudrateIdx: 0, gpsUbxSbas: 0,
    multiwiiCurrentOutput: 0, rssiChannel: 0, placeholder: 0,
    magDeclination: 0, voltageScale: 100,
    cellMin: 33, cellMax: 42, cellWarning: 37,
  }

  it('produces a 22-byte payload', () => {
    expect(encodeMspINavSetMisc(misc).byteLength).toBe(22)
  })

  it('encodes midrc as U16LE at offset 0', () => {
    expect(readU16LE(encodeMspINavSetMisc(misc), 0)).toBe(1500)
  })

  it('encodes maxthrottle as U16LE at offset 4', () => {
    expect(readU16LE(encodeMspINavSetMisc(misc), 4)).toBe(2000)
  })

  it('encodes gpsProvider at offset 10', () => {
    expect(readU8(encodeMspINavSetMisc(misc), 10)).toBe(2)
  })

  it('encodes voltageScale at offset 18', () => {
    expect(readU8(encodeMspINavSetMisc(misc), 18)).toBe(100)
  })
})

// ── encodeMspINavSetBatteryConfig ─────────────────────────────

describe('encodeMspINavSetBatteryConfig', () => {
  const cfg = {
    capacityMah: 5000, capacityWarningMah: 1000, capacityCriticalMah: 500,
    capacityUnit: 0, voltageSource: 0, cells: 6, cellDetect: 0,
    cellMin: 3300, cellMax: 4200, cellWarning: 3700,
    currentScale: 100, currentOffset: 0,
  }

  it('produces a 26-byte payload', () => {
    expect(encodeMspINavSetBatteryConfig(cfg).byteLength).toBe(26)
  })

  it('encodes capacityMah as U32LE at offset 0', () => {
    expect(readU32LE(encodeMspINavSetBatteryConfig(cfg), 0)).toBe(5000)
  })

  it('encodes cells at offset 14', () => {
    expect(readU8(encodeMspINavSetBatteryConfig(cfg), 14)).toBe(6)
  })

  it('encodes cellMin as U16LE at offset 16', () => {
    expect(readU16LE(encodeMspINavSetBatteryConfig(cfg), 16)).toBe(3300)
  })
})

// ── profile select encoders ───────────────────────────────────

describe('encodeMspINavSelectBatteryProfile', () => {
  it('encodes index as a single byte', () => {
    const buf = encodeMspINavSelectBatteryProfile(2)
    expect(buf.byteLength).toBe(1)
    expect(buf[0]).toBe(2)
  })

  it('masks to single byte', () => {
    expect(encodeMspINavSelectBatteryProfile(256)[0]).toBe(0)
  })
})

describe('encodeMspINavSelectMixerProfile', () => {
  it('encodes index as a single byte', () => {
    const buf = encodeMspINavSelectMixerProfile(1)
    expect(buf.byteLength).toBe(1)
    expect(buf[0]).toBe(1)
  })
})
