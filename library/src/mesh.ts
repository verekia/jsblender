import {
  ATTR_DOMAIN,
  ATTR_TYPE,
  readAttributeAsFloats,
  readAttributeAsInt32,
  readAttributeAsUint8,
  readAttributeStorage,
} from './attributes.ts'
import { readCustomProperties } from './idproperty.ts'

import type { MeshAttributeRaw } from './attributes.ts'
import type { IDPropertyValue } from './idproperty.ts'
import type { BlendFileData } from './parser.ts'
import type { BlendBlock } from './types.ts'

export interface DeformWeight {
  groupIndex: number
  weight: number
}

export interface DeformVertex {
  totalWeight: number
  weights: DeformWeight[]
}

export interface Mesh {
  /** Blender datablock name with the leading "ME" prefix stripped. */
  name: string
  vertexCount: number
  edgeCount: number
  faceCount: number
  cornerCount: number
  /** Flat XYZ vertex positions (length = vertexCount * 3). */
  vertices: Float32Array
  /** Per-vertex normals derived from connected face normals (length = vertexCount * 3). */
  vertexNormals: Float32Array
  /** Per-face flat normals (length = faceCount * 3). */
  faceNormals: Float32Array
  /** Offset table for faces; offsets[i] is the first corner of face i, offsets[faceCount] is total corners. */
  faceOffsets: Uint32Array
  /** Per-corner vertex index. */
  cornerVertices: Uint32Array
  /** Per-corner edge index, when present. */
  cornerEdges?: Uint32Array
  /** Per-face material index (length = faceCount). All zero if absent. */
  materialIndices: Uint32Array
  /** Names of the materials slots, in order. */
  materialSlotNames: string[]
  /** UV maps, keyed by attribute name (CD_PROP_FLOAT2 on CORNER domain). */
  uvMaps: Record<string, Float32Array>
  /** Float vertex colour layers (CD_PROP_COLOR on POINT or CORNER domain). */
  vertexColors: Record<string, Float32Array>
  /** Byte (sRGB-encoded) vertex colour layers (CD_PROP_BYTE_COLOR). */
  vertexByteColors: Record<string, Uint8Array>
  /** Triangulated face indices (length = trianglesCount * 3). */
  triangles: Uint32Array
  /** All extra attributes by name; same MeshAttributeRaw entries as in extra. */
  attributes: Record<string, MeshAttributeRaw>
  /** Vertex group names from `vertex_group_names`. */
  vertexGroupNames: string[]
  /** Per-vertex weights, when the mesh has any. */
  dvert?: DeformVertex[]
  /** User-defined custom properties on this datablock. */
  customProperties: Record<string, IDPropertyValue>
}

const readListBaseStrings = (
  data: BlendFileData,
  listHeadOffset: number,
  structType: string,
  nameMax: number,
  anchor: number,
): string[] => {
  const { reader } = data
  const layout = reader.layoutOf(structType)
  const fName = reader.fieldOf(layout, 'name')
  const fNext = reader.fieldOf(layout, 'next')

  const headPtr = reader.readPointer(listHeadOffset)
  const out: string[] = []
  let block = reader.blockAt(headPtr, anchor)
  let cursorPtr = headPtr
  while (block) {
    const offset = Number(cursorPtr - block.oldPtr) + block.dataOffset
    out.push(reader.readCString(offset + fName.offset, nameMax))
    cursorPtr = reader.readPointer(offset + fNext.offset)
    if (cursorPtr === 0n) break
    block = reader.blockAt(cursorPtr, block.dataOffset)
    if (out.length > 100000) throw new Error('Runaway ListBase iteration')
  }
  return out
}

const readDeformVerts = (data: BlendFileData, dvertBlock: BlendBlock, vertexCount: number): DeformVertex[] => {
  const { reader } = data
  const layout = reader.layoutOf('MDeformVert')
  const weightLayout = reader.layoutOf('MDeformWeight')
  const fDw = reader.fieldOf(layout, 'dw')
  const fTot = reader.fieldOf(layout, 'totweight')
  const fDefNr = reader.fieldOf(weightLayout, 'def_nr')
  const fWeight = reader.fieldOf(weightLayout, 'weight')

  const out: DeformVertex[] = Array.from({ length: vertexCount })
  for (let i = 0; i < vertexCount; i++) {
    const base = dvertBlock.dataOffset + i * layout.size
    const dwPtr = reader.readPointer(base + fDw.offset)
    const totalWeight = reader.readInt32(base + fTot.offset)
    const weights: DeformWeight[] = []
    const dwBlock = reader.blockAt(dwPtr, dvertBlock.dataOffset)
    if (dwBlock && totalWeight > 0) {
      for (let w = 0; w < totalWeight; w++) {
        const off = dwBlock.dataOffset + w * weightLayout.size
        weights.push({
          groupIndex: reader.readInt32(off + fDefNr.offset),
          weight: reader.readFloat32(off + fWeight.offset),
        })
      }
    }
    out[i] = { totalWeight, weights }
  }
  return out
}

const triangulateFaces = (offsets: Uint32Array, cornerVerts: Uint32Array): Uint32Array => {
  const faceCount = offsets.length - 1
  let triCount = 0
  for (let i = 0; i < faceCount; i++) {
    const size = (offsets[i + 1] ?? 0) - (offsets[i] ?? 0)
    if (size >= 3) triCount += size - 2
  }
  const tris = new Uint32Array(triCount * 3)
  let t = 0
  for (let i = 0; i < faceCount; i++) {
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

const computeNormals = (
  vertices: Float32Array,
  triangles: Uint32Array,
  offsets: Uint32Array,
  cornerVerts: Uint32Array,
): { faceNormals: Float32Array; vertexNormals: Float32Array } => {
  const vertexCount = vertices.length / 3
  const faceCount = offsets.length - 1
  const faceNormals = new Float32Array(faceCount * 3)
  const vertexNormals = new Float32Array(vertexCount * 3)

  // Newell's method: accumulates signed cross-products across every edge of the
  // polygon. A single first-three-vertex cross product collapses to ~0 whenever
  // those three vertices are nearly collinear (common in n-gons), and then
  // normalizing amplifies float noise into a wrong direction.
  for (let f = 0; f < faceCount; f++) {
    const start = offsets[f] ?? 0
    const size = (offsets[f + 1] ?? 0) - start
    if (size < 3) continue
    let nx = 0,
      ny = 0,
      nz = 0
    for (let k = 0; k < size; k++) {
      const i = (cornerVerts[start + k] ?? 0) * 3
      const j = (cornerVerts[start + ((k + 1) % size)] ?? 0) * 3
      const ix = vertices[i] ?? 0,
        iy = vertices[i + 1] ?? 0,
        iz = vertices[i + 2] ?? 0
      const jx = vertices[j] ?? 0,
        jy = vertices[j + 1] ?? 0,
        jz = vertices[j + 2] ?? 0
      nx += (iy - jy) * (iz + jz)
      ny += (iz - jz) * (ix + jx)
      nz += (ix - jx) * (iy + jy)
    }
    const len = Math.hypot(nx, ny, nz) || 1
    nx /= len
    ny /= len
    nz /= len
    faceNormals[f * 3] = nx
    faceNormals[f * 3 + 1] = ny
    faceNormals[f * 3 + 2] = nz
    for (let i = 0; i < size; i++) {
      const v = (cornerVerts[start + i] ?? 0) * 3
      vertexNormals[v] = (vertexNormals[v] ?? 0) + nx
      vertexNormals[v + 1] = (vertexNormals[v + 1] ?? 0) + ny
      vertexNormals[v + 2] = (vertexNormals[v + 2] ?? 0) + nz
    }
  }

  for (let v = 0; v < vertexCount; v++) {
    const nx = vertexNormals[v * 3] ?? 0
    const ny = vertexNormals[v * 3 + 1] ?? 0
    const nz = vertexNormals[v * 3 + 2] ?? 0
    const len = Math.hypot(nx, ny, nz)
    if (len > 0) {
      vertexNormals[v * 3] = nx / len
      vertexNormals[v * 3 + 1] = ny / len
      vertexNormals[v * 3 + 2] = nz / len
    }
  }

  return { faceNormals, vertexNormals }
}

const extractMaterialSlotNames = (data: BlendFileData, meshBlock: BlendBlock, totcol: number): string[] => {
  const { reader } = data
  const layout = reader.layoutOf('Mesh')
  const fMat = reader.fieldOf(layout, 'mat')
  const matsPtr = reader.readPointer(meshBlock.dataOffset + fMat.offset)
  const matsBlock = reader.blockAt(matsPtr, meshBlock.dataOffset)
  if (!matsBlock || totcol <= 0) return []
  const idLayout = reader.layoutOf('ID')
  const fIdName = reader.fieldOf(idLayout, 'name')
  const names: string[] = []
  for (let i = 0; i < totcol; i++) {
    const ptr = reader.readPointer(matsBlock.dataOffset + i * reader.header.pointerSize)
    // Material datablocks (MA) live anywhere in the file, so we resolve them globally.
    const block = reader.blockAt(ptr)
    if (!block) {
      names.push('')
      continue
    }
    const raw = reader.readCString(block.dataOffset + fIdName.offset, 64)
    names.push(raw.startsWith('MA') ? raw.slice(2) : raw)
  }
  return names
}

/**
 * Pulls every `Mesh` datablock out of the parsed file and returns a clean,
 * triangulated, typed-array view of each.
 */
export const extractMeshes = (data: BlendFileData): Mesh[] => {
  const { reader, blocks } = data
  const meshLayout = reader.layoutOf('Mesh')
  const idLayout = reader.layoutOf('ID')
  const fIdName = reader.fieldOf(idLayout, 'name')
  const fId = reader.fieldOf(meshLayout, 'id')
  const fStorage = reader.fieldOf(meshLayout, 'attribute_storage')
  const fTotVert = reader.fieldOf(meshLayout, 'totvert')
  const fTotEdge = reader.fieldOf(meshLayout, 'totedge')
  const fTotPoly = reader.fieldOf(meshLayout, 'totpoly')
  const fTotLoop = reader.fieldOf(meshLayout, 'totloop')
  const fTotCol = reader.fieldOf(meshLayout, 'totcol')
  const fOffsets = reader.fieldOf(meshLayout, 'poly_offset_indices')
  const fDvert = reader.fieldOf(meshLayout, 'dvert')
  const fVertexGroupNames = reader.fieldOf(meshLayout, 'vertex_group_names')

  const meshes: Mesh[] = []
  for (const block of blocks) {
    if (block.code !== 'ME') continue
    const base = block.dataOffset
    const rawName = reader.readCString(base + fId.offset + fIdName.offset, 64)
    const name = rawName.startsWith('ME') ? rawName.slice(2) : rawName
    const vertexCount = reader.readInt32(base + fTotVert.offset)
    const edgeCount = reader.readInt32(base + fTotEdge.offset)
    const faceCount = reader.readInt32(base + fTotPoly.offset)
    const cornerCount = reader.readInt32(base + fTotLoop.offset)
    const totcol = reader.readInt16(base + fTotCol.offset)

    const attrsRaw = readAttributeStorage(reader, base, fStorage)
    const attributes: Record<string, MeshAttributeRaw> = {}
    for (const a of attrsRaw) attributes[a.name] = a

    const positionAttr = attrsRaw.find(a => a.name === 'position' && a.dataType === ATTR_TYPE.FLOAT3)
    const vertices = positionAttr
      ? (readAttributeAsFloats(reader, positionAttr) ?? new Float32Array(vertexCount * 3))
      : new Float32Array(vertexCount * 3)

    const cornerVertAttr = attrsRaw.find(a => a.name === '.corner_vert' && a.dataType === ATTR_TYPE.INT32)
    const cornerVertices = cornerVertAttr
      ? new Uint32Array((readAttributeAsInt32(reader, cornerVertAttr) ?? new Int32Array(cornerCount)).buffer.slice(0))
      : new Uint32Array(cornerCount)
    const cornerEdgeAttr = attrsRaw.find(a => a.name === '.corner_edge' && a.dataType === ATTR_TYPE.INT32)
    const cornerEdges = cornerEdgeAttr
      ? new Uint32Array((readAttributeAsInt32(reader, cornerEdgeAttr) ?? new Int32Array(cornerCount)).buffer.slice(0))
      : undefined

    const offsetsPtr = reader.readPointer(base + fOffsets.offset)
    const offsetsBlock = reader.blockAt(offsetsPtr, base)
    const faceOffsets = offsetsBlock
      ? new Uint32Array(reader.readInt32Array(offsetsBlock.dataOffset, faceCount + 1).buffer.slice(0))
      : new Uint32Array(faceCount + 1)

    const matIdxAttr = attrsRaw.find(a => a.name === 'material_index' && a.dataType === ATTR_TYPE.INT32)
    const materialIndices = matIdxAttr
      ? new Uint32Array((readAttributeAsInt32(reader, matIdxAttr) ?? new Int32Array(faceCount)).buffer.slice(0))
      : new Uint32Array(faceCount)

    const uvMaps: Record<string, Float32Array> = {}
    const vertexColors: Record<string, Float32Array> = {}
    const vertexByteColors: Record<string, Uint8Array> = {}
    for (const a of attrsRaw) {
      if (a.dataType === ATTR_TYPE.FLOAT2 && a.domain === ATTR_DOMAIN.CORNER) {
        const v = readAttributeAsFloats(reader, a)
        if (v) uvMaps[a.name] = v
      } else if (a.dataType === ATTR_TYPE.COLOR) {
        const v = readAttributeAsFloats(reader, a)
        if (v) vertexColors[a.name] = v
      } else if (a.dataType === ATTR_TYPE.BYTE_COLOR) {
        const v = readAttributeAsUint8(reader, a)
        if (v) vertexByteColors[a.name] = v
      }
    }

    const triangles = triangulateFaces(faceOffsets, cornerVertices)
    const { faceNormals, vertexNormals } = computeNormals(vertices, triangles, faceOffsets, cornerVertices)

    const materialSlotNames = extractMaterialSlotNames(data, block, totcol)

    const dvertPtr = reader.readPointer(base + fDvert.offset)
    const dvertBlock = reader.blockAt(dvertPtr, base)
    const dvert = dvertBlock && vertexCount > 0 ? readDeformVerts(data, dvertBlock, vertexCount) : undefined

    const vertexGroupNames = readListBaseStrings(data, base + fVertexGroupNames.offset, 'bDeformGroup', 64, base)

    meshes.push({
      name,
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
      materialSlotNames,
      uvMaps,
      vertexColors,
      vertexByteColors,
      triangles,
      attributes,
      vertexGroupNames,
      dvert,
      customProperties: readCustomProperties(reader, base),
    })
  }
  return meshes
}
