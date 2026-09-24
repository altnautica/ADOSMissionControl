/**
 * Each iNav settings panel must load against a flight controller that only
 * has iNav's real setting names. The demo FC rejects an unknown name the way
 * MSP2_COMMON_SETTING does, so a panel addressing a setting iNav lacks never
 * loads and shows the FC's refusal instead.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import type { ComponentType } from 'react'
import { renderWithIntl } from '../helpers/intl-wrapper'
import { selectTestProtocol } from '../helpers/selected-drone'
import { INavMockProtocol } from '@/mock/inav-mock-protocol'
import { INavFailsafePanel } from '@/components/fc/inav/INavFailsafePanel'
import { NavConfigPanel } from '@/components/fc/inav/NavConfigPanel'
import { RateDynamicsPanel } from '@/components/fc/inav/RateDynamicsPanel'

vi.mock('@/hooks/use-armed-lock', () => ({
  useArmedLock: () => ({ isArmed: false, lockMessage: '' }),
}))

vi.mock('@/hooks/use-unsaved-guard', () => ({
  useUnsavedGuard: () => undefined,
}))

const PANELS: Array<[string, ComponentType]> = [
  ['failsafe', INavFailsafePanel],
  ['navigation config', NavConfigPanel],
  ['rate dynamics', RateDynamicsPanel],
]

describe('iNav settings panels load against real setting names', () => {
  beforeEach(() => {
    const fc = new INavMockProtocol({ vehicleClass: 'copter' })
    selectTestProtocol(fc)
  })

  for (const [name, Panel] of PANELS) {
    it(`${name}`, async () => {
      renderWithIntl(<Panel />)
      fireEvent.click(screen.getByRole('button', { name: /read/i }))
      await waitFor(() => expect(screen.getByRole('button', { name: /write to fc/i })).toBeDefined())
      expect(screen.queryByText(/Failed to read setting/)).toBeNull()
    })
  }
})
