import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { renderWithIntl } from '../helpers/intl-wrapper'
import { NavPidPanel } from '@/components/fc/inav/NavPidPanel'
import { useDroneManager } from '@/stores/drone-manager'
import { SettingsError } from '@/lib/protocol/msp/settings'

vi.mock('@/hooks/use-armed-lock', () => ({
  useArmedLock: () => ({ isArmed: false, lockMessage: '' }),
}))

vi.mock('@/hooks/use-unsaved-guard', () => ({
  useUnsavedGuard: () => undefined,
}))

/** The navigation gains a multirotor iNav build defines; any other name is refused. */
const REAL_SETTINGS = new Set([
  'nav_mc_pos_z_p',
  'nav_mc_vel_z_p', 'nav_mc_vel_z_i', 'nav_mc_vel_z_d',
  'nav_mc_pos_xy_p',
  'nav_mc_vel_xy_p', 'nav_mc_vel_xy_i', 'nav_mc_vel_xy_d', 'nav_mc_vel_xy_ff',
  'nav_mc_heading_p',
])

/** A settings stub that refuses unknown names the way MSP2_COMMON_SETTING does. */
function stubProtocol(requested: string[]) {
  const known = (name: string) => {
    requested.push(name)
    if (!REAL_SETTINGS.has(name)) throw new SettingsError(`Failed to read setting "${name}"`, name)
  }
  return {
    settings: {
      getSetting: vi.fn(async (name: string) => { known(name); return { type: 'uint8' as const, value: 42 } }),
      setSetting: vi.fn().mockResolvedValue({ success: true, resultCode: 0, message: 'OK' }),
      getSettingInfo: vi.fn(async (name: string) => {
        known(name)
        return { name, pgId: 0, type: 0, section: 0, mode: 0, min: 0, max: 255, index: 0, profileCurrent: 0, profileCount: 1 }
      }),
      enumerate: vi.fn().mockResolvedValue([]),
    },
  }
}

describe('NavPidPanel', () => {
  beforeEach(() => {
    useDroneManager.setState({ getSelectedProtocol: () => null } as never)
  })

  it('renders the panel title', () => {
    renderWithIntl(<NavPidPanel />)
    expect(screen.getByText('Nav PID')).toBeDefined()
  })

  it('renders the subtitle', () => {
    renderWithIntl(<NavPidPanel />)
    expect(screen.getByText('iNav navigation controller PID gains')).toBeDefined()
  })

  it('does not render PID inputs before Read is triggered', () => {
    renderWithIntl(<NavPidPanel />)
    expect(screen.queryByText('Multirotor position XY')).toBeNull()
  })

  it('hides the Read from FC button when disconnected', () => {
    renderWithIntl(<NavPidPanel />)
    expect(screen.queryByRole('button', { name: /read from fc/i })).toBeNull()
  })

  it('loads against a firmware that only has the real navigation gains', async () => {
    const requested: string[] = []
    const mockAdapter = stubProtocol(requested)
    useDroneManager.setState({ getSelectedProtocol: () => mockAdapter } as never)

    renderWithIntl(<NavPidPanel />)
    fireEvent.click(screen.getByRole('button', { name: /read/i }))

    await waitFor(() => expect(screen.getByText('Multirotor position XY')).toBeDefined())
    expect(screen.getByRole('button', { name: /write to fc/i })).toBeDefined()
    expect(requested).toContain('nav_mc_vel_xy_ff')
    expect(requested).not.toContain('nav_mc_pos_xy_i')
    expect(requested).not.toContain('nav_mc_surface_p')
  })
})
