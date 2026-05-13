import type { StructReader } from './reader.ts'
import type { FieldLayout, SDNAStructLayout } from './types.ts'

/**
 * `bke::AttrType` values used by Blender 5.x AttributeStorage. This enum was
 * renumbered from the older CD_PROP_* values; the new mapping is what is
 * written into `Attribute.data_type` in modern files.
 */
export const ATTR_TYPE = {
  BOOL: 0,
  INT8: 1,
  INT16: 2,
  INT32: 3,
  INT32_2D: 4,
  FLOAT: 5,
  FLOAT2: 6,
  FLOAT3: 7,
  BYTE_COLOR: 8, // uchar4
  COLOR: 9, // float4
  QUATERNION: 10, // float4
  FLOAT4X4: 11,
  STRING: 12,
} as const

export type AttrTypeName = keyof typeof ATTR_TYPE
export type AttrTypeValue = (typeof ATTR_TYPE)[AttrTypeName]

/** AttrDomain enum values. */
export const ATTR_DOMAIN = {
  POINT: 0,
  EDGE: 1,
  FACE: 2,
  CORNER: 3,
  CURVE: 4,
  INSTANCE: 5,
  LAYER: 6,
} as const

export type AttrDomainName = keyof typeof ATTR_DOMAIN
export type AttrDomainValue = (typeof ATTR_DOMAIN)[AttrDomainName]

export interface MeshAttributeRaw {
  name: string
  dataType: number
  domain: number
  storageType: number
  /** Number of elements (length of array). */
  length: number
  /** Element size in bytes, derived from dataType. */
  elementSize: number
  /** Absolute byte offset of the first element in the file buffer. */
  dataOffset: number
}

const ELEMENT_SIZES: Record<number, number> = {
  [ATTR_TYPE.BOOL]: 1,
  [ATTR_TYPE.INT8]: 1,
  [ATTR_TYPE.INT16]: 2,
  [ATTR_TYPE.INT32]: 4,
  [ATTR_TYPE.INT32_2D]: 8,
  [ATTR_TYPE.FLOAT]: 4,
  [ATTR_TYPE.FLOAT2]: 8,
  [ATTR_TYPE.FLOAT3]: 12,
  [ATTR_TYPE.BYTE_COLOR]: 4,
  [ATTR_TYPE.COLOR]: 16,
  [ATTR_TYPE.QUATERNION]: 16,
  [ATTR_TYPE.FLOAT4X4]: 64,
}

/** Returns the byte width of a single element for a given AttrType. 0 if unknown. */
export const attributeElementSize = (dataType: number): number => ELEMENT_SIZES[dataType] ?? 0

const readAttribute = (
  reader: StructReader,
  attributeLayout: SDNAStructLayout,
  arrayLayout: SDNAStructLayout,
  singleLayout: SDNAStructLayout,
  attributeOffset: number,
  anchor: number,
): MeshAttributeRaw | undefined => {
  const fName = reader.fieldOf(attributeLayout, 'name')
  const fDataType = reader.fieldOf(attributeLayout, 'data_type')
  const fDomain = reader.fieldOf(attributeLayout, 'domain')
  const fStorage = reader.fieldOf(attributeLayout, 'storage_type')
  const fData = reader.fieldOf(attributeLayout, 'data')

  const namePtr = reader.readPointer(attributeOffset + fName.offset)
  const nameBlock = reader.blockAt(namePtr, anchor)
  const name = nameBlock ? reader.readCString(nameBlock.dataOffset, nameBlock.size) : ''

  const dataType = reader.readInt16(attributeOffset + fDataType.offset)
  const domain = reader.readInt8(attributeOffset + fDomain.offset)
  const storageType = reader.readInt8(attributeOffset + fStorage.offset)

  const dataPtr = reader.readPointer(attributeOffset + fData.offset)
  const dataBlock = reader.blockAt(dataPtr, anchor)
  if (!dataBlock) return undefined

  const elementSize = attributeElementSize(dataType)
  // storage_type 0 = Array, 1 = Single (one value broadcast across the domain)
  if (storageType === 0) {
    const fAData = reader.fieldOf(arrayLayout, 'data')
    const fASize = reader.fieldOf(arrayLayout, 'size')
    const innerPtr = reader.readPointer(dataBlock.dataOffset + fAData.offset)
    const innerBlock = reader.blockAt(innerPtr, dataBlock.dataOffset)
    if (!innerBlock) return undefined
    const length = Number(reader.readInt64(dataBlock.dataOffset + fASize.offset))
    return { name, dataType, domain, storageType, length, elementSize, dataOffset: innerBlock.dataOffset }
  }

  // Single-value attribute. Point at the single element.
  const fSData = reader.fieldOf(singleLayout, 'data')
  const innerPtr = reader.readPointer(dataBlock.dataOffset + fSData.offset)
  const innerBlock = reader.blockAt(innerPtr, dataBlock.dataOffset)
  if (!innerBlock) return undefined
  return { name, dataType, domain, storageType, length: 1, elementSize, dataOffset: innerBlock.dataOffset }
}

/**
 * Reads the `AttributeStorage` embedded inside a Mesh struct and returns every
 * resolved attribute. The mesh layout and the storage-field layout are passed
 * in so the caller does not have to compute them twice.
 */
export const readAttributeStorage = (
  reader: StructReader,
  parentOffset: number,
  storageField: FieldLayout,
): MeshAttributeRaw[] => {
  const storageLayout = reader.layoutOf('AttributeStorage')
  const attributeLayout = reader.layoutOf('Attribute')
  const arrayLayout = reader.layoutOf('AttributeArray')
  const singleLayout = reader.layoutOf('AttributeSingle')

  const fDnaAttrs = reader.fieldOf(storageLayout, 'dna_attributes')
  const fDnaAttrsNum = reader.fieldOf(storageLayout, 'dna_attributes_num')

  const storageOffset = parentOffset + storageField.offset
  const ptr = reader.readPointer(storageOffset + fDnaAttrs.offset)
  const num = reader.readInt32(storageOffset + fDnaAttrsNum.offset)
  if (num <= 0) return []
  const block = reader.blockAt(ptr, parentOffset)
  if (!block) return []

  const stride = attributeLayout.size
  const out: MeshAttributeRaw[] = []
  for (let i = 0; i < num; i++) {
    const offset = block.dataOffset + i * stride
    const attr = readAttribute(reader, attributeLayout, arrayLayout, singleLayout, offset, block.dataOffset)
    if (attr) out.push(attr)
  }
  return out
}

/**
 * Returns the attribute's payload as a typed array sized for `length * channels`.
 * Returns `undefined` for unsupported types.
 */
export const readAttributeAsFloats = (reader: StructReader, attr: MeshAttributeRaw): Float32Array | undefined => {
  if (attr.length === 0) return new Float32Array(0)
  if (attr.dataType === ATTR_TYPE.FLOAT) return reader.readFloatArray(attr.dataOffset, attr.length)
  if (attr.dataType === ATTR_TYPE.FLOAT2) return reader.readFloatArray(attr.dataOffset, attr.length * 2)
  if (attr.dataType === ATTR_TYPE.FLOAT3) return reader.readFloatArray(attr.dataOffset, attr.length * 3)
  if (attr.dataType === ATTR_TYPE.COLOR || attr.dataType === ATTR_TYPE.QUATERNION)
    return reader.readFloatArray(attr.dataOffset, attr.length * 4)
  if (attr.dataType === ATTR_TYPE.FLOAT4X4) return reader.readFloatArray(attr.dataOffset, attr.length * 16)
  return undefined
}

export const readAttributeAsInt32 = (reader: StructReader, attr: MeshAttributeRaw): Int32Array | undefined => {
  if (attr.dataType === ATTR_TYPE.INT32) return reader.readInt32Array(attr.dataOffset, attr.length)
  if (attr.dataType === ATTR_TYPE.INT32_2D) return reader.readInt32Array(attr.dataOffset, attr.length * 2)
  return undefined
}

export const readAttributeAsUint8 = (reader: StructReader, attr: MeshAttributeRaw): Uint8Array | undefined => {
  if (attr.dataType === ATTR_TYPE.BYTE_COLOR) {
    return new Uint8Array(reader.buf.buffer, reader.buf.byteOffset + attr.dataOffset, attr.length * 4).slice()
  }
  if (attr.dataType === ATTR_TYPE.BOOL || attr.dataType === ATTR_TYPE.INT8) {
    return new Uint8Array(reader.buf.buffer, reader.buf.byteOffset + attr.dataOffset, attr.length).slice()
  }
  return undefined
}
