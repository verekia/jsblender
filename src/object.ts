import type { BlendFileData } from './parser.ts'

export interface SceneObject {
  name: string
  /** Object type code (OB_MESH=1, OB_CURVE=2, OB_ARMATURE=25, …). */
  type: number
  location: [number, number, number]
  /** XYZ Euler rotation in radians. */
  rotation: [number, number, number]
  scale: [number, number, number]
  /** Local-to-world matrix as a float[16] (row-major). */
  worldMatrix: Float32Array
  /** Name of the linked ID datablock, e.g. the mesh that backs this object. */
  dataName?: string
  /** Parent object name, when set. */
  parentName?: string
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
  const fObmat = obLayout.fieldByName.get('obmat') ?? obLayout.fieldByName.get('object_to_world')
  const fData = reader.fieldOf(obLayout, 'data')
  const fParent = reader.fieldOf(obLayout, 'parent')

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
    const worldMatrix = fObmat ? reader.readFloatArray(base + fObmat.offset, 16) : new Float32Array(16)

    // Object.data and Object.parent point at other ID datablocks anywhere in
    // the file, so resolve globally rather than anchoring to this object.
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

    out.push({ name, type, location, rotation, scale, worldMatrix, dataName, parentName })
  }
  return out
}
