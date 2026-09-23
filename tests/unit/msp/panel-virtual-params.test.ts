/**
 * Every Betaflight setting a panel asks the MSP adapter for must resolve.
 *
 * The panels request virtual `BF_*` names through `getParameter`. An adapter
 * that looks them up in anything but the registry answers "Unknown parameter",
 * and the panel works only in demo mode. Each name here is read through the
 * real adapter path against a fake MSP queue.
 */

import { describe, expect, it } from 'vitest'
import { mspGetParameter, type MspParamContext } from '@/lib/protocol/msp-adapter-params'
import type { MspSerialQueue } from '@/lib/protocol/msp/msp-serial-queue'
import { BF_CONFIG_PARAM_NAMES } from '@/components/fc/betaflight/bf-config-constants'
import { BF_RATE_PARAM_NAMES } from '@/components/fc/betaflight/bf-rate-constants'
import { BF_MOTORS_PARAM_NAMES } from '@/components/fc/motors/bf-motors-constants'
import { BF_POWER_PARAMS } from '@/components/fc/power/bf-power-constants'
import { BF_PID_AXES, BF_FILTER_PARAMS } from '@/components/fc/pid/pid-constants'
import { GPS_PARAM_NAMES } from '@/components/fc/sensors/gps-constants'
import { BF_FAILSAFE_PARAMS } from '@/components/fc/safety/failsafe-constants'
import { BLACKBOX_PARAM_NAMES } from '@/components/fc/comms/blackbox-constants'
import { VTX_PARAM_NAMES } from '@/components/fc/misc/vtx-constants'

const PANEL_PARAMS: Record<string, readonly string[]> = {
  config: BF_CONFIG_PARAM_NAMES,
  rates: BF_RATE_PARAM_NAMES,
  motors: BF_MOTORS_PARAM_NAMES,
  power: BF_POWER_PARAMS,
  pid: BF_PID_AXES.flatMap((a) => a.params.map((p) => p.param)),
  filters: BF_FILTER_PARAMS.map((p) => p.param),
  gps: GPS_PARAM_NAMES,
  failsafe: BF_FAILSAFE_PARAMS,
  blackbox: BLACKBOX_PARAM_NAMES,
  vtx: VTX_PARAM_NAMES,
}

function betaflightContext(): MspParamContext {
  // Answers every read with a zero-filled block longer than any config layout.
  const queue = {
    send: async () => ({ payload: new Uint8Array(256) }),
  } as unknown as MspSerialQueue
  return { queue, paramCache: new Map(), paramNameCache: [], parameterCallbacks: [], isInav: false }
}

describe('Betaflight panel settings resolve through the MSP adapter', () => {
  for (const [panel, names] of Object.entries(PANEL_PARAMS)) {
    const bf = names.filter((n) => n.startsWith('BF_'))

    it(`${panel}: every BF_* name reads`, async () => {
      expect(bf.length).toBeGreaterThan(0)
      const ctx = betaflightContext()
      for (const name of bf) {
        const param = await mspGetParameter(ctx, name).catch((e: Error) => e)
        expect(param, name).not.toBeInstanceOf(Error)
      }
    })
  }
})
