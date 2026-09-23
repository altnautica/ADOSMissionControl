/**
 * The failsafe alert and the alert popup duration are operator settings; each
 * must drive something. The alert fires on a failsafe starting, never on its
 * end, and warnings and errors stay up for the chosen time.
 */

import { describe, expect, it } from 'vitest'
import { isFailsafeAnnouncement } from '@/lib/telemetry/failsafe-text'
import { toastLifetimeMs } from '@/components/ui/toast'

describe('failsafe announcements', () => {
  it('recognises a failsafe starting', () => {
    expect(isFailsafeAnnouncement(2, 'Radio Failsafe - Disarming')).toBe(true)
    expect(isFailsafeAnnouncement(4, 'Battery Failsafe')).toBe(true)
    expect(isFailsafeAnnouncement(2, 'EKF Failsafe: changed to LAND Mode')).toBe(true)
    expect(isFailsafeAnnouncement(1, 'Failsafe activated')).toBe(true)
  })

  it('ignores a failsafe ending and routine text', () => {
    expect(isFailsafeAnnouncement(4, 'Radio Failsafe Cleared')).toBe(false)
    expect(isFailsafeAnnouncement(4, 'Failsafe deactivated')).toBe(false)
    expect(isFailsafeAnnouncement(6, 'Failsafe settings loaded')).toBe(false)
    expect(isFailsafeAnnouncement(2, 'PreArm: Compass not calibrated')).toBe(false)
  })
})

describe('alert popup duration', () => {
  it('keeps warnings and errors up for the chosen time, or until dismissed', () => {
    expect(toastLifetimeMs('warning', '10')).toBe(10_000)
    expect(toastLifetimeMs('error', '5')).toBe(5_000)
    expect(toastLifetimeMs('error', 'never')).toBeNull()
  })

  it('clears confirmations after 3 s whatever the setting', () => {
    expect(toastLifetimeMs('success', 'never')).toBe(3000)
    expect(toastLifetimeMs('info', '10')).toBe(3000)
  })
})
