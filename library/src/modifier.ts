import { extractMeshes } from './mesh.ts'
import { extractObjects } from './object.ts'

import type { Mesh } from './mesh.ts'
import type { SceneObject } from './object.ts'
import type { BlendFileData } from './parser.ts'

/**
 * Blender modifier type codes (from `DNA_modifier_types.h`).
 * Only the ones jsblender can evaluate are listed; the rest go through as
 * `{ type: 'unknown' }`.
 */
export const MOD_TYPE = {
  SUBSURF: 1,
  LATTICE: 2,
  CURVE: 3,
  BUILD: 4,
  MIRROR: 5,
  DECIMATE: 6,
  WAVE: 7,
  ARMATURE: 8,
  HOOK: 9,
  SOFTBODY: 10,
  BOOLEAN: 11,
  ARRAY: 12,
} as const

/** Bits of `MirrorModifierData.flag` we care about. */
const MIRROR_FLAG = {
  CLIPPING: 1 << 0,
  AXIS_X: 1 << 3,
  AXIS_Y: 1 << 4,
  AXIS_Z: 1 << 5,
  NO_MERGE: 1 << 7,
} as const

/** `ArrayModifierData.fit_type` values. */
const ARRAY_FIT = {
  FIXED_COUNT: 0,
  FIT_LENGTH: 1,
  FIT_CURVE: 2,
} as const

/** Bits of `ArrayModifierData.offset_type`. */
const ARRAY_OFFSET = {
  CONSTANT: 1 << 0,
  RELATIVE: 1 << 1,
  OBJECT: 1 << 2,
} as const

export interface MirrorModifier {
  type: 'mirror'
  name: string
  axisX: boolean
  axisY: boolean
  axisZ: boolean
  merge: boolean
  tolerance: number
  /** Name of an Object the mirror plane uses as its frame. Falls back to local origin. */
  mirrorObjectName?: string
}

export interface ArrayModifier {
  type: 'array'
  name: string
  fitType: 'fixed' | 'length' | 'curve'
  count: number
  fitLength: number
  useConstantOffset: boolean
  useRelativeOffset: boolean
  useObjectOffset: boolean
  constantOffset: [number, number, number]
  relativeOffset: [number, number, number]
  /** Name of the offset object, when `useObjectOffset`. */
  offsetObjectName?: string
}

export interface UnknownModifier {
  type: 'unknown'
  name: string
  typeCode: number
}

export type Modifier = MirrorModifier | ArrayModifier | UnknownModifier

// ── Decoders ────────────────────────────────────────────────────────────────
const decodeMirror = (data: BlendFileData, offset: number): MirrorModifier => {
  const { reader } = data
  const layout = reader.layoutOf('MirrorModifierData')
  const modLayout = reader.layoutOf('ModifierData')
  const idLayout = reader.layoutOf('ID')
  const fIdName = reader.fieldOf(idLayout, 'name')
  const fName = reader.fieldOf(modLayout, 'name')
  const fFlag = reader.fieldOf(layout, 'flag')
  const fTolerance = reader.fieldOf(layout, 'tolerance')
  const fMirrorOb = reader.fieldOf(layout, 'mirror_ob')

  const flag = reader.readInt16(offset + fFlag.offset)
  const tolerance = reader.readFloat32(offset + fTolerance.offset)
  const mirrorObPtr = reader.readPointer(offset + fMirrorOb.offset)
  const mirrorObBlock = reader.blockAt(mirrorObPtr)
  const mirrorObjectName = mirrorObBlock
    ? reader.readCString(mirrorObBlock.dataOffset + fIdName.offset, 64).slice(2)
    : undefined

  return {
    type: 'mirror',
    name: reader.readCString(offset + fName.offset, 64),
    axisX: (flag & MIRROR_FLAG.AXIS_X) !== 0,
    axisY: (flag & MIRROR_FLAG.AXIS_Y) !== 0,
    axisZ: (flag & MIRROR_FLAG.AXIS_Z) !== 0,
    merge: (flag & MIRROR_FLAG.NO_MERGE) === 0,
    tolerance,
    mirrorObjectName,
  }
}

const decodeArray = (data: BlendFileData, offset: number): ArrayModifier => {
  const { reader } = data
  const layout = reader.layoutOf('ArrayModifierData')
  const modLayout = reader.layoutOf('ModifierData')
  const idLayout = reader.layoutOf('ID')
  const fIdName = reader.fieldOf(idLayout, 'name')
  const fName = reader.fieldOf(modLayout, 'name')
  const fFitType = reader.fieldOf(layout, 'fit_type')
  const fCount = reader.fieldOf(layout, 'count')
  const fLength = reader.fieldOf(layout, 'length')
  const fOffsetType = reader.fieldOf(layout, 'offset_type')
  const fOffset = reader.fieldOf(layout, 'offset')
  const fScale = reader.fieldOf(layout, 'scale')
  const fOffsetOb = reader.fieldOf(layout, 'offset_ob')

  const fitTypeInt = reader.readInt32(offset + fFitType.offset)
  const offsetType = reader.readInt32(offset + fOffsetType.offset)
  const constantOffset: [number, number, number] = [
    reader.readFloat32(offset + fOffset.offset),
    reader.readFloat32(offset + fOffset.offset + 4),
    reader.readFloat32(offset + fOffset.offset + 8),
  ]
  const relativeOffset: [number, number, number] = [
    reader.readFloat32(offset + fScale.offset),
    reader.readFloat32(offset + fScale.offset + 4),
    reader.readFloat32(offset + fScale.offset + 8),
  ]
  const offsetObPtr = reader.readPointer(offset + fOffsetOb.offset)
  const offsetObBlock = reader.blockAt(offsetObPtr)
  const offsetObjectName = offsetObBlock
    ? reader.readCString(offsetObBlock.dataOffset + fIdName.offset, 64).slice(2)
    : undefined

  return {
    type: 'array',
    name: reader.readCString(offset + fName.offset, 64),
    fitType: fitTypeInt === ARRAY_FIT.FIXED_COUNT ? 'fixed' : fitTypeInt === ARRAY_FIT.FIT_LENGTH ? 'length' : 'curve',
    count: Math.max(1, reader.readInt32(offset + fCount.offset)),
    fitLength: reader.readFloat32(offset + fLength.offset),
    useConstantOffset: (offsetType & ARRAY_OFFSET.CONSTANT) !== 0,
    useRelativeOffset: (offsetType & ARRAY_OFFSET.RELATIVE) !== 0,
    useObjectOffset: (offsetType & ARRAY_OFFSET.OBJECT) !== 0,
    constantOffset,
    relativeOffset,
    offsetObjectName,
  }
}

/**
 * Walks `Object.modifiers` for every object in the file and returns a map
 * keyed by object name. Each entry is the modifier stack in evaluation order.
 */
export const extractObjectModifiers = (data: BlendFileData): Map<string, Modifier[]> => {
  const { reader, blocks } = data
  const obLayout = reader.layoutOf('Object')
  const idLayout = reader.layoutOf('ID')
  const modLayout = reader.layoutOf('ModifierData')
  const fIdName = reader.fieldOf(idLayout, 'name')
  const fModifiers = reader.fieldOf(obLayout, 'modifiers')
  const fNext = reader.fieldOf(modLayout, 'next')
  const fType = reader.fieldOf(modLayout, 'type')
  const fName = reader.fieldOf(modLayout, 'name')

  const out = new Map<string, Modifier[]>()
  for (const block of blocks) {
    if (block.code !== 'OB') continue
    const objName = reader.readCString(block.dataOffset + fIdName.offset, 64).slice(2)
    const mods: Modifier[] = []
    let cursor = reader.readPointer(block.dataOffset + fModifiers.offset)
    let anchor = block.dataOffset
    let safety = 0
    while (cursor !== 0n) {
      if (++safety > 1000) break
      const modBlock = reader.blockAt(cursor, anchor)
      if (!modBlock) break
      const offset = Number(cursor - modBlock.oldPtr) + modBlock.dataOffset
      const typeCode = reader.readInt32(offset + fType.offset)
      if (typeCode === MOD_TYPE.MIRROR) mods.push(decodeMirror(data, offset))
      else if (typeCode === MOD_TYPE.ARRAY) mods.push(decodeArray(data, offset))
      else
        mods.push({
          type: 'unknown',
          name: reader.readCString(offset + fName.offset, 64),
          typeCode,
        })
      cursor = reader.readPointer(offset + fNext.offset)
      anchor = modBlock.dataOffset
    }
    if (mods.length > 0) out.set(objName, mods)
  }
  return out
}

// ── Mesh-evaluation helpers ─────────────────────────────────────────────────
const buildCornerEdges = (cornerVertices: Uint32Array, faceOffsets: Uint32Array): Uint32Array => {
  const out = new Uint32Array(cornerVertices.length)
  const edgeMap = new Map<string, number>()
  let nextEdge = 0
  const fCount = faceOffsets.length - 1
  for (let f = 0; f < fCount; f++) {
    const start = faceOffsets[f] ?? 0
    const end = faceOffsets[f + 1] ?? start
    const size = end - start
    for (let k = 0; k < size; k++) {
      const v1 = cornerVertices[start + k] ?? 0
      const v2 = cornerVertices[start + ((k + 1) % size)] ?? 0
      const key = v1 < v2 ? `${v1}|${v2}` : `${v2}|${v1}`
      let ei = edgeMap.get(key)
      if (ei === undefined) {
        ei = nextEdge++
        edgeMap.set(key, ei)
      }
      out[start + k] = ei
    }
  }
  return out
}

const triangulateFaces = (offsets: Uint32Array, cornerVerts: Uint32Array): Uint32Array => {
  const fCount = offsets.length - 1
  let triCount = 0
  for (let i = 0; i < fCount; i++) {
    const size = (offsets[i + 1] ?? 0) - (offsets[i] ?? 0)
    if (size >= 3) triCount += size - 2
  }
  const tris = new Uint32Array(triCount * 3)
  let t = 0
  for (let i = 0; i < fCount; i++) {
    const start = offsets[i] ?? 0
    const size = (offsets[i + 1] ?? 0) - start
    if (size < 3) continue
    const v0 = cornerVerts[start] ?? 0
    for (let c = 1; c < size - 1; c++) {
      tris[t++] = v0
      tris[t++] = cornerVerts[start + c] ?? 0
      tris[t++] = cornerVerts[start + c + 1] ?? 0
    }
  }
  return tris
}

const computeFaceNormals = (vertices: Float32Array, offsets: Uint32Array, cornerVerts: Uint32Array): Float32Array => {
  const fCount = offsets.length - 1
  const out = new Float32Array(fCount * 3)
  for (let f = 0; f < fCount; f++) {
    const start = offsets[f] ?? 0
    const size = (offsets[f + 1] ?? 0) - start
    if (size < 3) continue
    const a = (cornerVerts[start] ?? 0) * 3
    const b = (cornerVerts[start + 1] ?? 0) * 3
    const c = (cornerVerts[start + 2] ?? 0) * 3
    const ax = vertices[a] ?? 0,
      ay = vertices[a + 1] ?? 0,
      az = vertices[a + 2] ?? 0
    const bx = (vertices[b] ?? 0) - ax
    const by = (vertices[b + 1] ?? 0) - ay
    const bz = (vertices[b + 2] ?? 0) - az
    const cx = (vertices[c] ?? 0) - ax
    const cy = (vertices[c + 1] ?? 0) - ay
    const cz = (vertices[c + 2] ?? 0) - az
    let nx = by * cz - bz * cy
    let ny = bz * cx - bx * cz
    let nz = bx * cy - by * cx
    const len = Math.hypot(nx, ny, nz) || 1
    nx /= len
    ny /= len
    nz /= len
    out[f * 3] = nx
    out[f * 3 + 1] = ny
    out[f * 3 + 2] = nz
  }
  return out
}

const finalize = (
  base: Mesh,
  vertices: Float32Array,
  faceOffsets: Uint32Array,
  cornerVertices: Uint32Array,
  materialIndices: Uint32Array,
): Mesh => {
  const vertexCount = vertices.length / 3
  const faceCount = faceOffsets.length - 1
  const cornerCount = cornerVertices.length
  const faceNormals = computeFaceNormals(vertices, faceOffsets, cornerVertices)
  const cornerEdges = buildCornerEdges(cornerVertices, faceOffsets)
  // Per-vertex normals: area-weighted sum of incident face normals.
  const vertexNormals = new Float32Array(vertexCount * 3)
  for (let f = 0; f < faceCount; f++) {
    const start = faceOffsets[f] ?? 0
    const end = faceOffsets[f + 1] ?? start
    const nx = faceNormals[f * 3] ?? 0
    const ny = faceNormals[f * 3 + 1] ?? 0
    const nz = faceNormals[f * 3 + 2] ?? 0
    for (let k = start; k < end; k++) {
      const v = (cornerVertices[k] ?? 0) * 3
      vertexNormals[v] = (vertexNormals[v] ?? 0) + nx
      vertexNormals[v + 1] = (vertexNormals[v + 1] ?? 0) + ny
      vertexNormals[v + 2] = (vertexNormals[v + 2] ?? 0) + nz
    }
  }
  for (let v = 0; v < vertexCount; v++) {
    const x = vertexNormals[v * 3] ?? 0
    const y = vertexNormals[v * 3 + 1] ?? 0
    const z = vertexNormals[v * 3 + 2] ?? 0
    const l = Math.hypot(x, y, z)
    if (l > 0) {
      vertexNormals[v * 3] = x / l
      vertexNormals[v * 3 + 1] = y / l
      vertexNormals[v * 3 + 2] = z / l
    }
  }

  // Edge count = number of unique edge indices in cornerEdges.
  let edgeCount = 0
  for (let i = 0; i < cornerEdges.length; i++)
    if ((cornerEdges[i] ?? 0) >= edgeCount) edgeCount = (cornerEdges[i] ?? 0) + 1

  return {
    ...base,
    vertexCount,
    edgeCount,
    faceCount,
    cornerCount,
    vertices,
    vertexNormals,
    faceNormals,
    faceOffsets,
    cornerVertices,
    cornerEdges,
    materialIndices,
    triangles: triangulateFaces(faceOffsets, cornerVertices),
  }
}

// ── Mirror ──────────────────────────────────────────────────────────────────
const applyMirrorAxis = (mesh: Mesh, axis: 0 | 1 | 2, merge: boolean, tolerance: number): Mesh => {
  const vCount = mesh.vertexCount
  const fCount = mesh.faceCount
  const cCount = mesh.cornerCount

  // mapping: for each original vertex i, its image after mirroring.
  //   If `merge` and the mirrored position is within `tolerance` of any existing
  //   vertex, we weld the mirror image onto that vertex (handles seam-on-plane
  //   AND stacked redundant mirrors, where the mirror image lands on an
  //   already-present vertex).
  //   Otherwise image index = newVertexSlot++.
  const mergeMap = new Int32Array(vCount)
  let newVertexSlot = vCount

  // Spatial hash of existing vertices for O(1) merge probes.
  const cellSize = Math.max(tolerance, 1e-6)
  const tolSq = tolerance * tolerance
  const cellKey = (x: number, y: number, z: number): string =>
    `${Math.round(x / cellSize)},${Math.round(y / cellSize)},${Math.round(z / cellSize)}`
  const hash = new Map<string, number[]>()
  if (merge) {
    for (let i = 0; i < vCount; i++) {
      const k = cellKey(mesh.vertices[i * 3] ?? 0, mesh.vertices[i * 3 + 1] ?? 0, mesh.vertices[i * 3 + 2] ?? 0)
      const list = hash.get(k)
      if (list) list.push(i)
      else hash.set(k, [i])
    }
  }

  const findWeldTarget = (mx: number, my: number, mz: number): number => {
    const cx = Math.round(mx / cellSize)
    const cy = Math.round(my / cellSize)
    const cz = Math.round(mz / cellSize)
    for (let ddx = -1; ddx <= 1; ddx++) {
      for (let ddy = -1; ddy <= 1; ddy++) {
        for (let ddz = -1; ddz <= 1; ddz++) {
          const candidates = hash.get(`${cx + ddx},${cy + ddy},${cz + ddz}`)
          if (!candidates) continue
          for (const ci of candidates) {
            const dx = (mesh.vertices[ci * 3] ?? 0) - mx
            const dy = (mesh.vertices[ci * 3 + 1] ?? 0) - my
            const dz = (mesh.vertices[ci * 3 + 2] ?? 0) - mz
            if (dx * dx + dy * dy + dz * dz <= tolSq) return ci
          }
        }
      }
    }
    return -1
  }

  for (let i = 0; i < vCount; i++) {
    const ox = mesh.vertices[i * 3] ?? 0
    const oy = mesh.vertices[i * 3 + 1] ?? 0
    const oz = mesh.vertices[i * 3 + 2] ?? 0
    const mx = axis === 0 ? -ox : ox
    const my = axis === 1 ? -oy : oy
    const mz = axis === 2 ? -oz : oz
    let target = -1
    if (merge) target = findWeldTarget(mx, my, mz)
    mergeMap[i] = target >= 0 ? target : newVertexSlot++
  }

  const totalVerts = newVertexSlot
  const vertices = new Float32Array(totalVerts * 3)
  vertices.set(mesh.vertices)
  for (let i = 0; i < vCount; i++) {
    const target = mergeMap[i] ?? i
    if (target < vCount) continue
    const o = i * 3
    const t = target * 3
    vertices[t] = (axis === 0 ? -1 : 1) * (mesh.vertices[o] ?? 0)
    vertices[t + 1] = (axis === 1 ? -1 : 1) * (mesh.vertices[o + 1] ?? 0)
    vertices[t + 2] = (axis === 2 ? -1 : 1) * (mesh.vertices[o + 2] ?? 0)
  }

  // Decide which mirrored faces to keep. The duplicate-detection compares each
  // candidate mirrored face's vertex set against EVERY existing face's vertex
  // set — a reverse-winding duplicate is dropped (otherwise stacked mirrors
  // through the same plane would create face-overlap artefacts, and back-face
  // culling would also disagree because the mirror reverses winding).
  const existingFaceKeys = new Set<string>()
  const keyForFace = (verts: number[]): string => [...verts].sort((a, b) => a - b).join(',')
  for (let f = 0; f < fCount; f++) {
    const start = mesh.faceOffsets[f] ?? 0
    const end = mesh.faceOffsets[f + 1] ?? start
    const verts: number[] = []
    for (let k = start; k < end; k++) verts.push(mesh.cornerVertices[k] ?? 0)
    existingFaceKeys.add(keyForFace(verts))
  }

  const keptMirroredFaces: number[] = []
  let mirroredCornerCount = 0
  for (let f = 0; f < fCount; f++) {
    const start = mesh.faceOffsets[f] ?? 0
    const end = mesh.faceOffsets[f + 1] ?? start
    const size = end - start
    const mirroredVerts: number[] = []
    for (let k = 0; k < size; k++) {
      const v = mesh.cornerVertices[start + k] ?? 0
      mirroredVerts.push(mergeMap[v] ?? v)
    }
    if (existingFaceKeys.has(keyForFace(mirroredVerts))) continue
    keptMirroredFaces.push(f)
    mirroredCornerCount += size
  }

  const totalFaces = fCount + keptMirroredFaces.length
  const totalCorners = cCount + mirroredCornerCount
  const faceOffsets = new Uint32Array(totalFaces + 1)
  faceOffsets.set(mesh.faceOffsets)
  for (let i = 0; i < keptMirroredFaces.length; i++) {
    const f = keptMirroredFaces[i] ?? 0
    const size = (mesh.faceOffsets[f + 1] ?? 0) - (mesh.faceOffsets[f] ?? 0)
    faceOffsets[fCount + i + 1] = (faceOffsets[fCount + i] ?? 0) + size
  }

  const cornerVertices = new Uint32Array(totalCorners)
  cornerVertices.set(mesh.cornerVertices)
  for (let i = 0; i < keptMirroredFaces.length; i++) {
    const f = keptMirroredFaces[i] ?? 0
    const start = mesh.faceOffsets[f] ?? 0
    const end = mesh.faceOffsets[f + 1] ?? start
    const size = end - start
    const dst = faceOffsets[fCount + i] ?? 0
    // Reverse winding so the mirrored normal points outward.
    for (let k = 0; k < size; k++) {
      const srcVert = mesh.cornerVertices[start + (size - 1 - k)] ?? 0
      cornerVertices[dst + k] = mergeMap[srcVert] ?? srcVert
    }
  }

  const materialIndices = new Uint32Array(totalFaces)
  materialIndices.set(mesh.materialIndices)
  for (let i = 0; i < keptMirroredFaces.length; i++) {
    materialIndices[fCount + i] = mesh.materialIndices[keptMirroredFaces[i] ?? 0] ?? 0
  }

  return finalize(mesh, vertices, faceOffsets, cornerVertices, materialIndices)
}

const applyMirror = (mesh: Mesh, mod: MirrorModifier): Mesh => {
  let m = mesh
  if (mod.axisX) m = applyMirrorAxis(m, 0, mod.merge, mod.tolerance)
  if (mod.axisY) m = applyMirrorAxis(m, 1, mod.merge, mod.tolerance)
  if (mod.axisZ) m = applyMirrorAxis(m, 2, mod.merge, mod.tolerance)
  return m
}

// ── Array ───────────────────────────────────────────────────────────────────
const computeBoundingBox = (mesh: Mesh): { size: [number, number, number] } => {
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity
  for (let i = 0; i < mesh.vertexCount; i++) {
    const x = mesh.vertices[i * 3] ?? 0
    const y = mesh.vertices[i * 3 + 1] ?? 0
    const z = mesh.vertices[i * 3 + 2] ?? 0
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
    if (z < minZ) minZ = z
    if (z > maxZ) maxZ = z
  }
  return { size: [maxX - minX, maxY - minY, maxZ - minZ] }
}

const applyArray = (mesh: Mesh, mod: ArrayModifier): Mesh => {
  if (mod.fitType !== 'fixed') return mesh
  const count = Math.max(1, mod.count)
  if (count === 1) return mesh

  const bbox = computeBoundingBox(mesh)
  let dx = 0,
    dy = 0,
    dz = 0
  if (mod.useRelativeOffset) {
    dx += mod.relativeOffset[0] * bbox.size[0]
    dy += mod.relativeOffset[1] * bbox.size[1]
    dz += mod.relativeOffset[2] * bbox.size[2]
  }
  if (mod.useConstantOffset) {
    dx += mod.constantOffset[0]
    dy += mod.constantOffset[1]
    dz += mod.constantOffset[2]
  }
  // Object-offset (`useObjectOffset`) requires the offset object's transform —
  // resolvable via `mod.offsetObjectName` and the SceneObject list, but we skip
  // it here since the renderer is the only consumer and falls back gracefully.

  const vCount = mesh.vertexCount
  const fCount = mesh.faceCount
  const cCount = mesh.cornerCount

  const vertices = new Float32Array(vCount * count * 3)
  for (let c = 0; c < count; c++) {
    const tx = dx * c
    const ty = dy * c
    const tz = dz * c
    const dst = c * vCount * 3
    for (let i = 0; i < vCount; i++) {
      vertices[dst + i * 3] = (mesh.vertices[i * 3] ?? 0) + tx
      vertices[dst + i * 3 + 1] = (mesh.vertices[i * 3 + 1] ?? 0) + ty
      vertices[dst + i * 3 + 2] = (mesh.vertices[i * 3 + 2] ?? 0) + tz
    }
  }

  const faceOffsets = new Uint32Array(fCount * count + 1)
  for (let c = 0; c < count; c++) {
    for (let f = 0; f < fCount; f++) {
      const size = (mesh.faceOffsets[f + 1] ?? 0) - (mesh.faceOffsets[f] ?? 0)
      faceOffsets[c * fCount + f + 1] = (faceOffsets[c * fCount + f] ?? 0) + size
    }
  }

  const cornerVertices = new Uint32Array(cCount * count)
  for (let c = 0; c < count; c++) {
    for (let f = 0; f < fCount; f++) {
      const start = mesh.faceOffsets[f] ?? 0
      const end = mesh.faceOffsets[f + 1] ?? start
      const size = end - start
      const dst = faceOffsets[c * fCount + f] ?? 0
      for (let k = 0; k < size; k++) {
        const srcVert = mesh.cornerVertices[start + k] ?? 0
        cornerVertices[dst + k] = srcVert + c * vCount
      }
    }
  }

  const materialIndices = new Uint32Array(fCount * count)
  for (let c = 0; c < count; c++) materialIndices.set(mesh.materialIndices, c * fCount)

  return finalize(mesh, vertices, faceOffsets, cornerVertices, materialIndices)
}

// ── Public API ──────────────────────────────────────────────────────────────
/**
 * Returns the modifier-evaluated mesh for an object — applying its Mirror and
 * Array modifiers in stack order. Unknown modifiers are skipped (the mesh
 * passes through unchanged). Returns `undefined` when the object isn't a mesh
 * or has no backing mesh datablock.
 */
export const evaluateMesh = (data: BlendFileData, object: SceneObject, baseMeshes?: Mesh[]): Mesh | undefined => {
  if (!object.dataName) return undefined
  const meshes = baseMeshes ?? extractMeshes(data)
  let mesh = meshes.find(m => m.name === object.dataName)
  if (!mesh) return undefined
  const allMods = extractObjectModifiers(data)
  const mods = allMods.get(object.name) ?? []
  for (const mod of mods) {
    if (mod.type === 'mirror') mesh = applyMirror(mesh, mod)
    else if (mod.type === 'array') mesh = applyArray(mesh, mod)
  }
  return mesh
}

/** Convenience: evaluate every mesh object in the file. Returns object-name → evaluated Mesh. */
export const evaluateAllMeshes = (data: BlendFileData): Map<string, Mesh> => {
  const objects = extractObjects(data)
  const meshes = extractMeshes(data)
  const out = new Map<string, Mesh>()
  for (const o of objects) {
    const m = evaluateMesh(data, o, meshes)
    if (m) out.set(o.name, m)
  }
  return out
}
