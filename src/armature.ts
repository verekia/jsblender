import type { BlendFileData } from './parser.ts'
import type { BlendBlock } from './types.ts'

export interface Bone {
  name: string
  /** Head position in armature space. */
  head: [number, number, number]
  /** Tail position in armature space. */
  tail: [number, number, number]
  /** Roll angle (radians). */
  roll: number
  /** 4x4 rest-pose matrix in armature space (row-major float[16]). */
  armatureMatrix: Float32Array
  /** Length value computed by Blender. */
  length: number
  children: Bone[]
}

export interface Armature {
  name: string
  bones: Bone[]
}

const readListBase = (
  data: BlendFileData,
  listOffset: number,
  childStructName: string,
  anchor: number,
): { offset: number; block: BlendBlock }[] => {
  const { reader } = data
  const layout = reader.layoutOf(childStructName)
  const fNext = reader.fieldOf(layout, 'next')

  const headPtr = reader.readPointer(listOffset)
  const out: { offset: number; block: BlendBlock }[] = []
  let cursor = headPtr
  let currentAnchor = anchor
  while (cursor !== 0n) {
    const block = reader.blockAt(cursor, currentAnchor)
    if (!block) break
    const offset = Number(cursor - block.oldPtr) + block.dataOffset
    out.push({ offset, block })
    cursor = reader.readPointer(offset + fNext.offset)
    currentAnchor = block.dataOffset
    if (out.length > 100000) throw new Error('Runaway ListBase walk')
  }
  return out
}

const readBone = (data: BlendFileData, offset: number, anchor: number): Bone => {
  const { reader } = data
  const boneLayout = reader.layoutOf('Bone')
  const fName = reader.fieldOf(boneLayout, 'name')
  const fHead = reader.fieldOf(boneLayout, 'head')
  const fTail = reader.fieldOf(boneLayout, 'tail')
  const fRoll = reader.fieldOf(boneLayout, 'roll')
  const fLength = boneLayout.fieldByName.get('length')
  const fArmMat = boneLayout.fieldByName.get('arm_mat')
  const fChildbase = reader.fieldOf(boneLayout, 'childbase')

  const name = reader.readCString(offset + fName.offset, 64)
  const head: [number, number, number] = [
    reader.readFloat32(offset + fHead.offset),
    reader.readFloat32(offset + fHead.offset + 4),
    reader.readFloat32(offset + fHead.offset + 8),
  ]
  const tail: [number, number, number] = [
    reader.readFloat32(offset + fTail.offset),
    reader.readFloat32(offset + fTail.offset + 4),
    reader.readFloat32(offset + fTail.offset + 8),
  ]
  const roll = reader.readFloat32(offset + fRoll.offset)
  const length = fLength ? reader.readFloat32(offset + fLength.offset) : 0
  const armatureMatrix = fArmMat ? reader.readFloatArray(offset + fArmMat.offset, 16) : new Float32Array(16)

  const childOffsets = readListBase(data, offset + fChildbase.offset, 'Bone', anchor)
  const children = childOffsets.map(c => readBone(data, c.offset, c.block.dataOffset))

  return { name, head, tail, roll, length, armatureMatrix, children }
}

export const extractArmatures = (data: BlendFileData): Armature[] => {
  const { reader, blocks } = data
  const armLayout = reader.layoutOf('bArmature')
  const idLayout = reader.layoutOf('ID')
  const fId = reader.fieldOf(armLayout, 'id')
  const fIdName = reader.fieldOf(idLayout, 'name')
  const fBonebase = reader.fieldOf(armLayout, 'bonebase')

  const out: Armature[] = []
  for (const block of blocks) {
    if (block.code !== 'AR') continue
    const base = block.dataOffset
    const rawName = reader.readCString(base + fId.offset + fIdName.offset, 64)
    const name = rawName.startsWith('AR') ? rawName.slice(2) : rawName
    const top = readListBase(data, base + fBonebase.offset, 'Bone', base)
    const bones = top.map(b => readBone(data, b.offset, b.block.dataOffset))
    out.push({ name, bones })
  }
  return out
}
