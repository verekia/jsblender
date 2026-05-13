export type Endianness = 'little' | 'big'

export type PointerSize = 4 | 8

export interface BlendHeader {
  /** ASCII version string straight from the file header (e.g. "0501"). */
  versionString: string
  /** Numeric Blender version with one decimal, derived from versionString. */
  version: number
  pointerSize: PointerSize
  endianness: Endianness
  /** True if the file uses the large 17-byte / 32-byte block header layout. */
  largeFormat: boolean
  /** Total size of the file header. */
  size: number
}

export interface BlendBlock {
  /** 4-char code, trailing nulls stripped (e.g. "ME", "MA", "DATA"). */
  code: string
  /** Index into the SDNA struct table. */
  sdnaIndex: number
  /** Original memory address from the writing Blender process. Used to resolve pointers. */
  oldPtr: bigint
  /** Size of the data payload in bytes. */
  size: number
  /** Number of consecutive structs in the payload. */
  count: number
  /** Absolute byte offset of the payload in the file. */
  dataOffset: number
}

export interface SDNAField {
  typeIndex: number
  nameIndex: number
}

export interface SDNAStruct {
  typeIndex: number
  fields: SDNAField[]
}

export interface ParsedFieldName {
  /** The bare identifier, with any `*` and `[N]` suffixes stripped. */
  baseName: string
  /** Original name as it appears in the SDNA. */
  rawName: string
  /** Number of `*` characters in front of the identifier. */
  pointerDepth: number
  /** Whether the name describes a function pointer like `(*foo)()`. */
  isFunctionPointer: boolean
  /** Array dimensions, outermost first. Empty for scalars. */
  arrayDims: number[]
}

export interface FieldLayout {
  field: SDNAField
  name: ParsedFieldName
  typeName: string
  /** Total size of this field in bytes. */
  size: number
  /** Offset within the parent struct. */
  offset: number
}

export interface SDNAStructLayout {
  index: number
  typeName: string
  size: number
  fields: FieldLayout[]
  /** Quick lookup from base field name to its layout. */
  fieldByName: Map<string, FieldLayout>
}

export interface SDNA {
  names: string[]
  parsedNames: ParsedFieldName[]
  types: string[]
  typeSizes: number[]
  structs: SDNAStruct[]
  /** Per-struct precomputed layout, indexed by SDNA struct index. */
  layouts: SDNAStructLayout[]
  /** Type name -> SDNA struct index. */
  structIndexByType: Map<string, number>
}
