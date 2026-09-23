/**
 * The OSD preference selects write the option's index straight into the FC
 * setting, so each list must follow the firmware table's enum order: a
 * shifted or padded list writes a different unit, scroll mode or style than
 * the one the pilot picked.
 */

import { describe, expect, it } from 'vitest'
import {
  ADSB_WARNING_STYLE_OPTIONS,
  CROSSHAIRS_OPTIONS,
  SIDEBAR_SCROLL_OPTIONS,
  UNITS_OPTIONS,
  VIDEO_SYSTEM_OPTIONS,
} from '@/components/fc/inav/osd-preference-options'

const labelOf = (options: { value: string; label: string }[], value: number) =>
  options.find((o) => o.value === String(value))?.label

describe('iNav OSD preference options', () => {
  it('maps osd_unit indices to IMPERIAL, METRIC, METRIC_MPH, UK, GA', () => {
    expect(UNITS_OPTIONS.map((o) => o.value)).toEqual(['0', '1', '2', '3', '4'])
    expect(labelOf(UNITS_OPTIONS, 2)).toBe('Metric + mph')
    expect(labelOf(UNITS_OPTIONS, 3)).toBe('UK')
    expect(labelOf(UNITS_OPTIONS, 4)).toBe('General aviation')
  })

  it('offers only the four sidebar scroll modes the firmware has', () => {
    expect(SIDEBAR_SCROLL_OPTIONS.map((o) => o.label)).toEqual(['None', 'Altitude', 'Speed', 'Home distance'])
  })

  it('maps the ADS-B warning style to COMPACT and EXTENDED', () => {
    expect(ADSB_WARNING_STYLE_OPTIONS.map((o) => o.label)).toEqual(['Compact', 'Extended'])
  })

  it('covers the HD video systems up to DJI native', () => {
    expect(VIDEO_SYSTEM_OPTIONS).toHaveLength(9)
    expect(labelOf(VIDEO_SYSTEM_OPTIONS, 3)).toBe('HDZero')
    expect(labelOf(VIDEO_SYSTEM_OPTIONS, 8)).toBe('DJI native')
  })

  it('covers all eight crosshair styles', () => {
    expect(CROSSHAIRS_OPTIONS).toHaveLength(8)
    expect(labelOf(CROSSHAIRS_OPTIONS, 1)).toBe('Aircraft')
  })
})
