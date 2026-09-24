/**
 * Reading an iNav mission replaces the plan in the Plan tab, so it has to
 * produce real planner waypoints (a jump is an action on a waypoint, not a
 * waypoint at 0,0), ask before replacing a plan, and leave the plan alone when
 * the read fails.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { renderWithIntl } from '../helpers/intl-wrapper'
import { INavMissionPanel } from '@/components/fc/inav/INavMissionPanel'
import { selectTestProtocol } from '../helpers/selected-drone'
import { useMissionStore } from '@/stores/mission-store'
import type { MissionItem } from '@/lib/protocol/types'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

const item = (seq: number, command: number, extra: Partial<MissionItem> = {}): MissionItem => ({
  seq, frame: 3, command, current: seq === 0 ? 1 : 0, autocontinue: 1,
  param1: 0, param2: 0, param3: 0, param4: 0,
  x: 129_716_000 + seq, y: 775_946_000, z: 50, ...extra,
})

// Two waypoints, then "jump back to the first one twice".
const FC_MISSION: MissionItem[] = [
  item(0, 16),
  item(1, 16),
  item(2, 177, { param1: 0, param2: 2, x: 0, y: 0, z: 0 }),
]

function connect(download: () => Promise<MissionItem[]>) {
  const protocol = {
    downloadMission: download,
    getVehicleInfo: () => ({ firmwareType: 'inav' }),
  }
  selectTestProtocol(protocol)
}

describe('INavMissionPanel read', () => {
  beforeEach(() => {
    useMissionStore.setState({ waypoints: [], downloadState: 'idle' } as never)
  })

  it('turns the FC mission into planner waypoints with the jump attached as an action', async () => {
    connect(async () => FC_MISSION)
    renderWithIntl(<INavMissionPanel />)
    fireEvent.click(screen.getByRole('button', { name: /read/i }))

    await waitFor(() => expect(useMissionStore.getState().waypoints).toHaveLength(2))
    const [first, second] = useMissionStore.getState().waypoints
    expect(first.lat).toBeCloseTo(12.9716, 4)
    expect(typeof (second.command ?? 'WAYPOINT')).toBe('string')
    expect(second.actions?.map((a) => a.command)).toEqual(['DO_JUMP'])
  })

  it('asks before replacing a plan, and cancelling keeps it', async () => {
    const download = vi.fn(async () => FC_MISSION)
    connect(download)
    renderWithIntl(<INavMissionPanel />)
    fireEvent.click(screen.getByRole('button', { name: /read/i }))
    await waitFor(() => expect(useMissionStore.getState().waypoints).toHaveLength(2))
    download.mockClear()

    fireEvent.click(screen.getByRole('button', { name: /refresh/i }))
    fireEvent.click(await screen.findByRole('button', { name: /cancel/i }))
    expect(download).not.toHaveBeenCalled()
    expect(useMissionStore.getState().waypoints).toHaveLength(2)
  })

  it('keeps the plan when the read fails', async () => {
    connect(async () => FC_MISSION)
    renderWithIntl(<INavMissionPanel />)
    fireEvent.click(screen.getByRole('button', { name: /read/i }))
    await waitFor(() => expect(useMissionStore.getState().waypoints).toHaveLength(2))

    connect(async () => { throw new Error('MSP timeout') })
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }))
    fireEvent.click(await screen.findByRole('button', { name: /replace plan/i }))
    await waitFor(() => expect(screen.getByText(/current plan is unchanged/)).toBeDefined())
    expect(useMissionStore.getState().waypoints).toHaveLength(2)
  })
})
