/**
 * ArduPilot places each OSD item with three parameters per screen,
 * OSDn_<ITEM>_EN / _X / _Y. A name the firmware does not have is a write that
 * can only fail, so the editor must address exactly these.
 */

import { describe, expect, it } from 'vitest'
import { osdElementParams, osdScreenParamNames, AP_OSD_ELEMENTS } from '@/components/fc/osd/ap-osd-elements'

describe('ArduPilot OSD parameter names', () => {
  it('addresses an item as OSDn_<ITEM>_EN/_X/_Y', () => {
    expect(osdElementParams(1, 'ALTITUDE')).toEqual({
      en: 'OSD1_ALTITUDE_EN',
      x: 'OSD1_ALTITUDE_X',
      y: 'OSD1_ALTITUDE_Y',
    })
  })

  it('lists the screen switch and three parameters per item for the chosen screen', () => {
    const names = osdScreenParamNames(3)
    expect(names[0]).toBe('OSD3_ENABLE')
    expect(names).toHaveLength(1 + 3 * AP_OSD_ELEMENTS.length)
    expect(names.every((n) => /^OSD3_[A-Z0-9_]+$/.test(n))).toBe(true)
  })
})
