import type { StructReader } from './reader.ts'

/** Values of `IDProperty.type` for Blender 5+. */
export const IDP_TYPE = {
  STRING: 0,
  INT: 1,
  FLOAT: 2,
  ARRAY: 5,
  GROUP: 6,
  ID: 7,
  DOUBLE: 8,
  IDPARRAY: 9,
  BOOLEAN: 10,
} as const

export type IDPropertyValue =
  | string
  | number
  | boolean
  | number[]
  | boolean[]
  | { [key: string]: IDPropertyValue }
  | { __idRef: string | null }
  | IDPropertyValue[]

const decodeArray = (reader: StructReader, propOffset: number, anchor: number): IDPropertyValue => {
  const layout = reader.layoutOf('IDProperty')
  const fSubtype = reader.fieldOf(layout, 'subtype')
  const fLen = reader.fieldOf(layout, 'len')
  const fData = reader.fieldOf(layout, 'data')
  const dataLayout = reader.layoutOf('IDPropertyData')
  const fPointer = reader.fieldOf(dataLayout, 'pointer')

  const subtype = reader.readUint8(propOffset + fSubtype.offset)
  const len = reader.readInt32(propOffset + fLen.offset)
  const dataPtr = reader.readPointer(propOffset + fData.offset + fPointer.offset)
  const block = reader.blockAt(dataPtr, anchor)
  if (!block || len <= 0) return []

  switch (subtype) {
    case IDP_TYPE.INT: {
      const arr: number[] = []
      for (let i = 0; i < len; i++) arr.push(reader.readInt32(block.dataOffset + i * 4))
      return arr
    }
    case IDP_TYPE.FLOAT: {
      const arr: number[] = []
      for (let i = 0; i < len; i++) arr.push(reader.readFloat32(block.dataOffset + i * 4))
      return arr
    }
    case IDP_TYPE.DOUBLE: {
      const arr: number[] = []
      for (let i = 0; i < len; i++) arr.push(reader.readFloat64(block.dataOffset + i * 8))
      return arr
    }
    case IDP_TYPE.BOOLEAN: {
      const arr: boolean[] = []
      for (let i = 0; i < len; i++) arr.push(reader.readUint8(block.dataOffset + i) !== 0)
      return arr
    }
    default:
      return []
  }
}

const decodeGroup = (reader: StructReader, propOffset: number, anchor: number): Record<string, IDPropertyValue> => {
  const layout = reader.layoutOf('IDProperty')
  const fData = reader.fieldOf(layout, 'data')
  const fName = reader.fieldOf(layout, 'name')
  const fNext = reader.fieldOf(layout, 'next')
  const dataLayout = reader.layoutOf('IDPropertyData')
  const fGroup = reader.fieldOf(dataLayout, 'group')

  const groupHead = propOffset + fData.offset + fGroup.offset
  const firstPtr = reader.readPointer(groupHead)

  const out: Record<string, IDPropertyValue> = {}
  let cursor = firstPtr
  let currentAnchor = anchor
  let safety = 0
  while (cursor !== 0n) {
    if (++safety > 10_000) throw new Error('Runaway IDProperty group walk')
    const block = reader.blockAt(cursor, currentAnchor)
    if (!block) break
    const childOffset = Number(cursor - block.oldPtr) + block.dataOffset
    const name = reader.readCString(childOffset + fName.offset, 64)
    out[name] = decodeIDProperty(reader, childOffset, block.dataOffset)
    cursor = reader.readPointer(childOffset + fNext.offset)
    currentAnchor = block.dataOffset
  }
  return out
}

const decodeIDProperty = (reader: StructReader, propOffset: number, anchor: number): IDPropertyValue => {
  const layout = reader.layoutOf('IDProperty')
  const fType = reader.fieldOf(layout, 'type')
  const fData = reader.fieldOf(layout, 'data')
  const fLen = reader.fieldOf(layout, 'len')
  const dataLayout = reader.layoutOf('IDPropertyData')
  const fVal = reader.fieldOf(dataLayout, 'val')
  const fVal2 = reader.fieldOf(dataLayout, 'val2')
  const fPointer = reader.fieldOf(dataLayout, 'pointer')

  const type = reader.readUint8(propOffset + fType.offset)
  const dataBase = propOffset + fData.offset
  const valOff = dataBase + fVal.offset

  switch (type) {
    case IDP_TYPE.INT:
      return reader.readInt32(valOff)
    case IDP_TYPE.FLOAT:
      return reader.readFloat32(valOff)
    case IDP_TYPE.BOOLEAN:
      return reader.readInt32(valOff) !== 0
    case IDP_TYPE.DOUBLE: {
      // Read 8 bytes starting at val: combine val + val2 into a Float64.
      const buf = new ArrayBuffer(8)
      const view = new DataView(buf)
      view.setUint32(0, reader.readUint32(valOff), reader.little)
      view.setUint32(4, reader.readUint32(dataBase + fVal2.offset), reader.little)
      return view.getFloat64(0, reader.little)
    }
    case IDP_TYPE.STRING: {
      const ptr = reader.readPointer(dataBase + fPointer.offset)
      const len = reader.readInt32(propOffset + fLen.offset)
      const block = reader.blockAt(ptr, anchor)
      if (!block || len <= 0) return ''
      return reader.readCString(block.dataOffset, len)
    }
    case IDP_TYPE.ARRAY:
      return decodeArray(reader, propOffset, anchor)
    case IDP_TYPE.GROUP:
      return decodeGroup(reader, propOffset, anchor)
    case IDP_TYPE.ID: {
      const ptr = reader.readPointer(dataBase + fPointer.offset)
      const block = reader.blockAt(ptr, anchor)
      if (!block) return { __idRef: null }
      const idName = reader.readCString(block.dataOffset + reader.fieldOf(reader.layoutOf('ID'), 'name').offset, 64)
      return { __idRef: idName }
    }
    case IDP_TYPE.IDPARRAY: {
      const ptr = reader.readPointer(dataBase + fPointer.offset)
      const len = reader.readInt32(propOffset + fLen.offset)
      const block = reader.blockAt(ptr, anchor)
      if (!block || len <= 0) return []
      const stride = layout.size
      const out: IDPropertyValue[] = []
      for (let i = 0; i < len; i++) out.push(decodeIDProperty(reader, block.dataOffset + i * stride, block.dataOffset))
      return out
    }
    default:
      return { __unknownType: type } as unknown as IDPropertyValue
  }
}

/**
 * Reads the `ID.properties` group attached to an ID datablock and returns its
 * children as a plain object. Returns `{}` when the ID has no custom properties.
 */
export const readCustomProperties = (reader: StructReader, idOffset: number): Record<string, IDPropertyValue> => {
  const idLayout = reader.layoutOf('ID')
  const fProps = reader.fieldOf(idLayout, 'properties')
  const ptr = reader.readPointer(idOffset + fProps.offset)
  if (ptr === 0n) return {}
  const block = reader.blockAt(ptr, idOffset)
  if (!block) return {}
  return decodeGroup(reader, block.dataOffset, block.dataOffset)
}

/**
 * Internal-use raw decoder, exposed for callers that already have an
 * IDProperty offset (e.g. inspecting bNodeTree.layer_properties).
 */
export const decodeIDPropertyAt = (reader: StructReader, offset: number, anchor: number): IDPropertyValue =>
  decodeIDProperty(reader, offset, anchor)
