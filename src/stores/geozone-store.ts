/**
 * @module geozone-store
 * @description Zustand store for iNav geozone state.
 * Manages up to 15 geozones. A polygon zone has one vertex per corner; a
 * circular zone has a single centre vertex that carries the radius.
 * @license GPL-3.0-only
 */

import { create } from 'zustand'
import type { DroneProtocol } from '@/lib/protocol/types'
import type { INavGeozone, INavGeozoneVertex } from '@/lib/protocol/msp/msp-decoders-inav'
import { formatErrorMessage } from '@/lib/utils'

/** Maximum geozones supported by iNav. */
export const GEOZONE_MAX = 15
/** Maximum vertices per polygon geozone. */
export const GEOZONE_VERTEX_MAX = 10

/** Zone type values. */
export const GEOZONE_TYPE = { EXCLUSIVE: 0, INCLUSIVE: 1 } as const
/** Zone shape values. */
export const GEOZONE_SHAPE = { CIRCULAR: 0, POLYGON: 1 } as const
/** Vertex slots a circular zone occupies on the FC: its centre and its radius. */
const CIRCLE_VERTEX_SLOTS = 2

interface GeozoneStoreState {
  zones: INavGeozone[]
  vertices: Map<number, INavGeozoneVertex[]>
  activeId: number | null
  loading: boolean
  error: string | null
  dirty: boolean

  // Zone CRUD
  addZone: (zone?: Partial<INavGeozone>) => void
  removeZone: (id: number) => void
  updateZone: (id: number, partial: Partial<Omit<INavGeozone, 'number'>>) => void
  setActiveId: (id: number | null) => void

  // Vertex CRUD
  addVertex: (geozoneId: number, vertex: Omit<INavGeozoneVertex, 'geozoneId' | 'vertexIdx'>) => void
  /** Set a circular zone's centre (degrees) and radius (cm). */
  setCircle: (geozoneId: number, lat: number, lon: number, radiusCm: number) => void
  removeVertex: (geozoneId: number, vertexIdx: number) => void
  updateVertex: (geozoneId: number, vertexIdx: number, lat: number, lon: number) => void
  replaceVertices: (geozoneId: number, newVertices: INavGeozoneVertex[]) => void

  // FC sync
  clear: () => void
  loadFromFc: (protocol: DroneProtocol) => Promise<void>
  uploadToFc: (protocol: DroneProtocol) => Promise<void>
}

function nextId(zones: INavGeozone[]): number {
  if (zones.length === 0) return 0
  return Math.max(...zones.map((z) => z.number)) + 1
}

export const useGeozoneStore = create<GeozoneStoreState>((set, get) => ({
  zones: [],
  vertices: new Map(),
  activeId: null,
  loading: false,
  error: null,
  dirty: false,

  addZone(partial = {}) {
    const { zones } = get()
    if (zones.length >= GEOZONE_MAX) {
      set({ error: `Maximum ${GEOZONE_MAX} geozones reached` })
      return
    }
    const id = nextId(zones)
    const zone: INavGeozone = {
      type: GEOZONE_TYPE.EXCLUSIVE,
      shape: GEOZONE_SHAPE.POLYGON,
      minAlt: 0,
      maxAlt: 12000, // 120 m in cm
      fenceAction: 1, // AVOID
      vertexCount: 0,
      isSeaLevelRef: false,
      ...partial,
      number: id, // always use generated id, ignore any number in partial
    }
    set({ zones: [...zones, zone], dirty: true })
  },

  removeZone(id) {
    const vertices = new Map(get().vertices)
    vertices.delete(id)
    set({
      zones: get().zones.filter((z) => z.number !== id),
      vertices,
      activeId: get().activeId === id ? null : get().activeId,
      dirty: true,
    })
  },

  updateZone(id, partial) {
    const current = get().zones.find((z) => z.number === id)
    if (!current) return
    // Polygon corners and a circle centre are not interchangeable: a shape
    // change starts the zone's geometry over.
    const shapeChanged = partial.shape !== undefined && partial.shape !== current.shape
    const zones = get().zones.map((z) =>
      z.number === id ? { ...z, ...partial, ...(shapeChanged ? { vertexCount: 0 } : {}) } : z,
    )
    if (shapeChanged) {
      const vertices = new Map(get().vertices)
      vertices.delete(id)
      set({ zones, vertices, dirty: true })
      return
    }
    set({ zones, dirty: true })
  },

  setActiveId(id) {
    set({ activeId: id })
  },

  addVertex(geozoneId, vertex) {
    const vertices = new Map(get().vertices)
    const existing = vertices.get(geozoneId) ?? []
    if (existing.length >= GEOZONE_VERTEX_MAX) {
      set({ error: `Maximum ${GEOZONE_VERTEX_MAX} vertices per geozone` })
      return
    }
    const newVert: INavGeozoneVertex = {
      geozoneId,
      vertexIdx: existing.length,
      ...vertex,
    }
    const updated = [...existing, newVert]
    vertices.set(geozoneId, updated)

    // Sync vertexCount on the zone
    const zones = get().zones.map((z) =>
      z.number === geozoneId ? { ...z, vertexCount: updated.length } : z,
    )
    set({ vertices, zones, dirty: true })
  },

  setCircle(geozoneId, lat, lon, radiusCm) {
    const vertices = new Map(get().vertices)
    vertices.set(geozoneId, [{ geozoneId, vertexIdx: 0, lat, lon, radius: radiusCm }])
    const zones = get().zones.map((z) =>
      z.number === geozoneId ? { ...z, vertexCount: CIRCLE_VERTEX_SLOTS } : z,
    )
    set({ vertices, zones, dirty: true })
  },

  removeVertex(geozoneId, vertexIdx) {
    const vertices = new Map(get().vertices)
    const existing = vertices.get(geozoneId) ?? []
    // Re-index remaining vertices
    const updated = existing
      .filter((v) => v.vertexIdx !== vertexIdx)
      .map((v, i) => ({ ...v, vertexIdx: i }))
    vertices.set(geozoneId, updated)

    const zones = get().zones.map((z) =>
      z.number === geozoneId ? { ...z, vertexCount: updated.length } : z,
    )
    set({ vertices, zones, dirty: true })
  },

  updateVertex(geozoneId, vertexIdx, lat, lon) {
    const vertices = new Map(get().vertices)
    const existing = vertices.get(geozoneId) ?? []
    const updated = existing.map((v) =>
      v.vertexIdx === vertexIdx ? { ...v, lat, lon } : v,
    )
    vertices.set(geozoneId, updated)
    set({ vertices, dirty: true })
  },

  replaceVertices(geozoneId, newVertices) {
    if (get().loading) return
    const vertices = new Map(get().vertices)
    const reindexed = newVertices.map((v, i) => ({ ...v, geozoneId, vertexIdx: i }))
    vertices.set(geozoneId, reindexed)
    const zones = get().zones.map((z) =>
      z.number === geozoneId ? { ...z, vertexCount: reindexed.length } : z,
    )
    set({ vertices, zones, dirty: true })
  },

  clear() {
    set({ zones: [], vertices: new Map(), activeId: null, loading: false, error: null, dirty: false })
  },

  async loadFromFc(protocol) {
    if (get().loading) return
    if (!protocol.downloadGeozones) {
      set({ error: 'Geozones not supported by this firmware' })
      return
    }
    set({ loading: true, error: null })
    try {
      const { zones, vertices: flatVerts } = await protocol.downloadGeozones()
      const vertexMap = new Map<number, INavGeozoneVertex[]>()
      for (const v of flatVerts) {
        const arr = vertexMap.get(v.geozoneId) ?? []
        arr.push(v)
        vertexMap.set(v.geozoneId, arr)
      }
      set({ zones, vertices: vertexMap, loading: false, dirty: false })
    } catch (err) {
      set({ loading: false, error: formatErrorMessage(err) })
    }
  },

  async uploadToFc(protocol) {
    if (get().loading) return
    if (!protocol.uploadGeozones) {
      set({ error: 'Geozones not supported by this firmware' })
      return
    }
    const { zones, vertices: vertexMap } = get()

    // Polygon zones need at least 3 corners; circular zones need a centre and a radius.
    const invalidPolygons: number[] = []
    const invalidCircles: number[] = []
    for (const zone of zones) {
      const verts = vertexMap.get(zone.number) ?? []
      if (zone.shape === GEOZONE_SHAPE.POLYGON && verts.length < 3) {
        invalidPolygons.push(zone.number)
      } else if (zone.shape === GEOZONE_SHAPE.CIRCULAR && !((verts[0]?.radius ?? 0) > 0)) {
        invalidCircles.push(zone.number)
      }
    }
    if (invalidPolygons.length > 0) {
      set({ error: `Polygon zones ${invalidPolygons.join(', ')} need at least 3 vertices before upload` })
      return
    }
    if (invalidCircles.length > 0) {
      set({ error: `Circular zones ${invalidCircles.join(', ')} need a centre and a radius before upload` })
      return
    }
    set({ loading: true, error: null })
    try {
      const allVertices: INavGeozoneVertex[] = []
      for (const verts of vertexMap.values()) {
        allVertices.push(...verts)
      }
      const result = await protocol.uploadGeozones(zones, allVertices)
      if (result.success) {
        set({ loading: false, dirty: false })
      } else {
        set({ loading: false, error: result.message })
      }
    } catch (err) {
      set({ loading: false, error: formatErrorMessage(err) })
    }
  },
}))
