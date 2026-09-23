/**
 * iNav geozone MSP2 codecs pinned against the byte layouts of the firmware's
 * MSP2_INAV_GEOZONE / MSP2_INAV_SET_GEOZONE and the matching vertex frames.
 * Every fixture is literal wire bytes.
 */
import { describe, it, expect } from 'vitest'
import {
  encodeMspINavSetGeozone,
  encodeMspINavSetGeozoneVertex,
} from '@/lib/protocol/msp/msp-encoders-inav'
import {
  decodeMspINavGeozone,
  decodeMspINavGeozoneVertex,
  type INavGeozone,
  INAV_MSP,
} from '@/lib/protocol/msp/msp-decoders-inav'
import { inavDownloadGeozones, inavUploadGeozones } from '@/lib/protocol/msp-adapter/inav/mission'
import type { MspSerialQueue } from '@/lib/protocol/msp/msp-serial-queue'

const dv = (bytes: number[]) => new DataView(new Uint8Array(bytes).buffer)

// Zone 2, EXCLUSIVE, POLYGON, minAlt -100 cm, maxAlt 12000 cm,
// isSealevelRef 1, fenceAction 3 (RTH), vertexCount 6.
const ZONE_FRAME = [
  0x02, 0x00, 0x01,
  0x9c, 0xff, 0xff, 0xff,
  0xe0, 0x2e, 0x00, 0x00,
  0x01, 0x03, 0x06,
]
const ZONE: INavGeozone = {
  number: 2, type: 0, shape: 1, minAlt: -100, maxAlt: 12000,
  isSeaLevelRef: true, fenceAction: 3, vertexCount: 6,
}

// Zone 2, vertex 1, lat 12.5, lon 77.5.
const VERTEX_FRAME = [0x02, 0x01, 0x40, 0x59, 0x73, 0x07, 0xc0, 0x8f, 0x31, 0x2e]
// Zone 4 centre, vertex 0, lat -33.8688197, lon 151.2092955, radius 15000 cm.
const CIRCLE_FRAME = [
  0x04, 0x00, 0x3b, 0x07, 0xd0, 0xeb, 0x1b, 0xb5, 0x20, 0x5a, 0x98, 0x3a, 0x00, 0x00,
]

describe('MSP2_INAV_SET_GEOZONE encode', () => {
  it('writes isSealevelRef, fenceAction and vertexCount at bytes 11, 12, 13', () => {
    expect(Array.from(encodeMspINavSetGeozone(ZONE))).toEqual(ZONE_FRAME)
  })
})

describe('MSP2_INAV_GEOZONE decode', () => {
  it('reads isSealevelRef, fenceAction and vertexCount at bytes 11, 12, 13', () => {
    expect(decodeMspINavGeozone(dv(ZONE_FRAME))).toEqual(ZONE)
  })
})

describe('MSP2_INAV_SET_GEOZONE_VERTEX encode', () => {
  it('writes a polygon corner as the 10-byte frame', () => {
    const bytes = encodeMspINavSetGeozoneVertex({ geozoneId: 2, vertexIdx: 1, lat: 12.5, lon: 77.5 })
    expect(Array.from(bytes)).toEqual(VERTEX_FRAME)
  })

  it('writes a circle centre as the 14-byte frame carrying the radius', () => {
    const bytes = encodeMspINavSetGeozoneVertex({
      geozoneId: 4, vertexIdx: 0, lat: -33.8688197, lon: 151.2092955, radius: 15000,
    })
    expect(Array.from(bytes)).toEqual(CIRCLE_FRAME)
  })
})

describe('MSP2_INAV_GEOZONE_VERTEX decode', () => {
  it('reads a polygon corner with no radius', () => {
    const v = decodeMspINavGeozoneVertex(dv(VERTEX_FRAME))
    expect(v).toEqual({ geozoneId: 2, vertexIdx: 1, lat: 12.5, lon: 77.5 })
  })

  it('reads the radius a circular zone appends', () => {
    const v = decodeMspINavGeozoneVertex(dv(CIRCLE_FRAME))
    expect(v.radius).toBe(15000)
    expect(v.lat).toBeCloseTo(-33.8688197, 7)
    expect(v.lon).toBeCloseTo(151.2092955, 7)
  })
})

describe('geozone download and upload over the link', () => {
  // Slot 0 empty, slot 1 a circle (vertexCount 2), slot 2 the polygon above; the
  // FC answers a request for the circle's radius slot (vertex 1) with an error.
  const circleZone = [0x01, 0x00, 0x00, 0, 0, 0, 0, 0xe0, 0x2e, 0x00, 0x00, 0x00, 0x01, 0x02]
  const emptyZone = (i: number) => [i, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]

  function fakeFc() {
    const sent: { command: number; payload: number[] }[] = []
    const queue = {
      send(command: number, payload?: Uint8Array) {
        const req = Array.from(payload ?? [])
        sent.push({ command, payload: req })
        let reply: number[] = []
        if (command === INAV_MSP.MSP2_INAV_GEOZONE) {
          reply = req[0] === 1 ? circleZone : req[0] === 2 ? ZONE_FRAME : emptyZone(req[0])
        } else if (command === INAV_MSP.MSP2_INAV_GEOZONE_VERTEX) {
          if (req[0] === 1 && req[1] !== 0) return Promise.reject(new Error('MSP error'))
          reply = req[0] === 1 ? [0x01, 0x00, ...CIRCLE_FRAME.slice(2)] : [0x02, req[1], ...VERTEX_FRAME.slice(2)]
        }
        return Promise.resolve({ version: 2 as const, command, payload: new Uint8Array(reply), direction: 'response' as const })
      },
    }
    return { queue: queue as unknown as MspSerialQueue, sent }
  }

  it('skips empty slots and reads a circle as its centre vertex with radius', async () => {
    const { queue } = fakeFc()
    const { zones, vertices } = await inavDownloadGeozones(queue)
    expect(zones.map((z) => z.number)).toEqual([1, 2])
    expect(vertices.filter((v) => v.geozoneId === 1)).toEqual([
      expect.objectContaining({ vertexIdx: 0, radius: 15000 }),
    ])
    expect(vertices.filter((v) => v.geozoneId === 2)).toHaveLength(6)
  })

  it('uploads a circle as one 14-byte vertex frame', async () => {
    const { queue, sent } = fakeFc()
    const zone: INavGeozone = { ...ZONE, number: 4, shape: 0, vertexCount: 2 }
    const centre = { geozoneId: 4, vertexIdx: 0, lat: -33.8688197, lon: 151.2092955, radius: 15000 }
    const result = await inavUploadGeozones(queue, [zone], [centre])
    expect(result.success).toBe(true)
    const vertexFrames = sent.filter((f) => f.command === INAV_MSP.MSP2_INAV_SET_GEOZONE_VERTEX)
    expect(vertexFrames.map((f) => f.payload)).toEqual([CIRCLE_FRAME])
  })
})