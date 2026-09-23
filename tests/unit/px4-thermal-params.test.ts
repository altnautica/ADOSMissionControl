/**
 * The PX4 thermal-calibration panel must address parameters PX4 has. PX4
 * starts the calibration from SYS_CAL_ACCEL / SYS_CAL_GYRO / SYS_CAL_BARO at
 * the next boot; there is no SYS_CAL_TEMP. Checked against the bundled PX4
 * parameter metadata.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { OPTIONAL_NAMES, PARAM_NAMES } from '@/components/fc/px4/px4-thermal-params'

const px4 = new Set(
  (JSON.parse(gunzipSync(readFileSync(resolve(process.cwd(), 'public/param-metadata/px4.json.gz'))).toString('utf8')) as {
    params: Array<{ name: string }>
  }).params.map((p) => p.name),
)

describe('PX4 thermal calibration parameters', () => {
  it('reads only parameters PX4 defines', () => {
    expect(PARAM_NAMES.filter((n) => !px4.has(n))).toEqual([])
    expect(PARAM_NAMES).toEqual(expect.arrayContaining(['SYS_CAL_ACCEL', 'SYS_CAL_GYRO', 'SYS_CAL_BARO']))
  })

  it('addresses the per-instance TC_* fields PX4 defines', () => {
    expect(OPTIONAL_NAMES.filter((n) => !px4.has(n))).toEqual([])
  })
})
