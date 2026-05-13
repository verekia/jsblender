import { readCustomProperties } from './idproperty.ts'
import { composeObjectMatrix, mat4Identity, mat4Multiply } from './transform.ts'

import type { IDPropertyValue } from './idproperty.ts'
import type { BlendFileData } from './parser.ts'
import type { Mat4, ObjectTransformInputs, Vec4 } from './transform.ts'
import type { BlendBlock } from './types.ts'

export interface SceneObject {
  name: string
  /** Object type code (OB_MESH=1, OB_CURVE=2, OB_ARMATURE=25, …). */
  type: number
  location: [number, number, number]
  /** XYZ Euler rotation in radians (only meaningful when rotationMode is 1..6). */
  rotation: [number, number, number]
  scale: [number, number, number]
  /** Local-to-world matrix as a float[16], column-major. Composed from
   *  loc/rot/scale + parent chain — Blender 5 no longer caches `obmat` to disk. */
  worldMatrix: Float32Array
  /**
   * Blender's `rotmode`. 0 = quaternion, 1..6 = Euler (XYZ, XZY, YXZ, YZX,
   * ZXY, ZYX), -1 = axis-angle.
   */
  rotationMode: number
  /** Name of the linked ID datablock, e.g. the mesh that backs this object. */
  dataName?: string
  /** Parent object name, when set. */
  parentName?: string
  customProperties: Record<string, IDPropertyValue>
}

export const OB_TYPE = {
  EMPTY: 0,
  MESH: 1,
  CURVE: 2,
  SURF: 3,
  FONT: 4,
  MBALL: 5,
  LAMP: 10,
  CAMERA: 11,
  SPEAKER: 12,
  LIGHTPROBE: 13,
  LATTICE: 22,
  ARMATURE: 25,
  GPENCIL: 26,
} as const

const readVec3 = (data: BlendFileData, offset: number): [number, number, number] => {
  const r = data.reader
  return [r.readFloat32(offset), r.readFloat32(offset + 4), r.readFloat32(offset + 8)]
}

const readVec4 = (data: BlendFileData, offset: number): Vec4 => {
  const r = data.reader
  return [r.readFloat32(offset), r.readFloat32(offset + 4), r.readFloat32(offset + 8), r.readFloat32(offset + 12)]
}

const readMat4ColumnMajor = (data: BlendFileData, offset: number): Mat4 => {
  // Blender stores `float mat[4][4]` row-major in C source but the bytes
  // happen to match column-major because Blender's matrix convention itself
  // is column-major (mat[col][row]). We can read it straight.
  return data.reader.readFloatArray(offset, 16)
}

/**
 * Composes each object's world matrix by walking the parent chain. Returns a
 * Map keyed by the object's block dataOffset so callers can look it up while
 * iterating block-by-block.
 */
const buildWorldMatrices = (data: BlendFileData): Map<number, Mat4> => {
  const { reader, blocks } = data
  const obLayout = reader.layoutOf('Object')
  const fParent = reader.fieldOf(obLayout, 'parent')
  const fLoc = reader.fieldOf(obLayout, 'loc')
  const fRot = reader.fieldOf(obLayout, 'rot')
  const fQuat = reader.fieldOf(obLayout, 'quat')
  const fSize = obLayout.fieldByName.get('size') ?? obLayout.fieldByName.get('scale')
  const fRotmode = reader.fieldOf(obLayout, 'rotmode')
  const fParentinv = reader.fieldOf(obLayout, 'parentinv')
  const fRotAxis = obLayout.fieldByName.get('rotAxis')
  const fRotAngle = obLayout.fieldByName.get('rotAngle')

  if (!fSize) throw new Error('Object struct has no size/scale field')

  const localAt = new Map<number, Mat4>()
  const parentBlockAt = new Map<number, BlendBlock | undefined>()
  const parentinvAt = new Map<number, Mat4>()

  for (const block of blocks) {
    if (block.code !== 'OB') continue
    const base = block.dataOffset
    const transform: ObjectTransformInputs = {
      loc: readVec3(data, base + fLoc.offset),
      rot: readVec3(data, base + fRot.offset),
      quat: readVec4(data, base + fQuat.offset),
      rotAxis: fRotAxis ? readVec3(data, base + fRotAxis.offset) : [0, 0, 1],
      rotAngle: fRotAngle ? reader.readFloat32(base + fRotAngle.offset) : 0,
      size: readVec3(data, base + fSize.offset),
      rotmode: reader.readInt16(base + fRotmode.offset),
    }
    localAt.set(base, composeObjectMatrix(transform))

    const parentPtr = reader.readPointer(base + fParent.offset)
    parentBlockAt.set(base, reader.blockAt(parentPtr))
    parentinvAt.set(base, readMat4ColumnMajor(data, base + fParentinv.offset))
  }

  const worldAt = new Map<number, Mat4>()
  const inProgress = new Set<number>()
  const compute = (base: number): Mat4 => {
    const cached = worldAt.get(base)
    if (cached) return cached
    if (inProgress.has(base)) return mat4Identity()
    inProgress.add(base)
    const local = localAt.get(base) ?? mat4Identity()
    const parent = parentBlockAt.get(base)
    if (!parent) {
      worldAt.set(base, local)
      inProgress.delete(base)
      return local
    }
    const parentWorld = compute(parent.dataOffset)
    const parentinv = parentinvAt.get(base) ?? mat4Identity()
    // world = parent_world * parentinv * local
    const world = mat4Multiply(mat4Multiply(parentWorld, parentinv), local)
    worldAt.set(base, world)
    inProgress.delete(base)
    return world
  }

  for (const block of blocks) {
    if (block.code !== 'OB') continue
    compute(block.dataOffset)
  }
  return worldAt
}

export const extractObjects = (data: BlendFileData): SceneObject[] => {
  const { reader, blocks } = data
  const obLayout = reader.layoutOf('Object')
  const idLayout = reader.layoutOf('ID')
  const fId = reader.fieldOf(obLayout, 'id')
  const fIdName = reader.fieldOf(idLayout, 'name')
  const fType = reader.fieldOf(obLayout, 'type')
  const fLoc = reader.fieldOf(obLayout, 'loc')
  const fRot = reader.fieldOf(obLayout, 'rot')
  const fSize = obLayout.fieldByName.get('size') ?? obLayout.fieldByName.get('scale')
  if (!fSize) throw new Error('Object struct has no "size"/"scale" field')
  const fRotmode = reader.fieldOf(obLayout, 'rotmode')
  const fData = reader.fieldOf(obLayout, 'data')
  const fParent = reader.fieldOf(obLayout, 'parent')

  const worldMatrices = buildWorldMatrices(data)

  const out: SceneObject[] = []
  for (const block of blocks) {
    if (block.code !== 'OB') continue
    const base = block.dataOffset
    const rawName = reader.readCString(base + fId.offset + fIdName.offset, 64)
    const name = rawName.startsWith('OB') ? rawName.slice(2) : rawName
    const type = reader.readInt16(base + fType.offset)
    const location = readVec3(data, base + fLoc.offset)
    const rotation = readVec3(data, base + fRot.offset)
    const scale = readVec3(data, base + fSize.offset)
    const rotationMode = reader.readInt16(base + fRotmode.offset)
    const worldMatrix = worldMatrices.get(base) ?? mat4Identity()

    const dataPtr = reader.readPointer(base + fData.offset)
    const dataBlock = reader.blockAt(dataPtr)
    let dataName: string | undefined
    if (dataBlock) {
      const raw = reader.readCString(dataBlock.dataOffset + fIdName.offset, 64)
      dataName = raw.length >= 2 ? raw.slice(2) : raw
    }
    const parentPtr = reader.readPointer(base + fParent.offset)
    const parentBlock = reader.blockAt(parentPtr)
    let parentName: string | undefined
    if (parentBlock) {
      const raw = reader.readCString(parentBlock.dataOffset + fIdName.offset, 64)
      parentName = raw.length >= 2 ? raw.slice(2) : raw
    }

    out.push({
      name,
      type,
      location,
      rotation,
      scale,
      rotationMode,
      worldMatrix,
      dataName,
      parentName,
      customProperties: readCustomProperties(reader, base),
    })
  }
  return out
}
