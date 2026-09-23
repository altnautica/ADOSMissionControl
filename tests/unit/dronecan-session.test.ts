/**
 * The CAN page's node parameters, diagnostics and test utilities run on a
 * DroneCAN session. Opening one asks the FC to forward the chosen bus and
 * exists only once the FC agrees; closing it turns forwarding back off.
 */

import { describe, expect, it, vi } from 'vitest'
import { openForwardedDroneCanSession } from '@/lib/dronecan/session'
import type { DroneProtocol } from '@/lib/protocol/types/protocol'

function fc(accept: boolean) {
  const enableCanForward = vi.fn(async (bus: number) =>
    accept || bus === 0
      ? { success: true, resultCode: 0, message: 'OK' }
      : { success: false, resultCode: 4, message: 'denied' },
  )
  const protocol = {
    enableCanForward,
    onCanFrame: () => () => {},
  } as unknown as DroneProtocol
  return { protocol, enableCanForward }
}

describe('DroneCAN session over CAN forwarding', () => {
  it('asks the FC to forward the chosen bus and hands back a live client', async () => {
    const { protocol, enableCanForward } = fc(true)
    const session = await openForwardedDroneCanSession(protocol, 2)
    expect(enableCanForward).toHaveBeenCalledWith(2)
    expect(typeof session.client.getNodeInfo).toBe('function')
    await session.close()
    expect(enableCanForward).toHaveBeenLastCalledWith(0)
  })

  it('does not exist when the FC refuses forwarding', async () => {
    const { protocol } = fc(false)
    await expect(openForwardedDroneCanSession(protocol, 1)).rejects.toThrow(/denied/)
  })
})
