import type { BlendBlock, BlendHeader, FieldLayout, SDNA, SDNAStructLayout } from './types.ts'

/**
 * Low-level cursor that reads typed values out of a .blend buffer, indexed by
 * SDNA struct layouts. One reader is shared across all extractors.
 */
export class StructReader {
  readonly buf: Uint8Array
  readonly view: DataView
  readonly header: BlendHeader
  readonly sdna: SDNA
  readonly little: boolean
  readonly textDecoder: TextDecoder
  /** First (or only) block for a given oldPtr. */
  readonly blockByPtr: Map<bigint, BlendBlock>
  /** Extra blocks when an oldPtr is reused across multiple writes (Blender 5+
   *  reuses temporary writer buffers, producing duplicates that share an oldPtr).
   *  Sorted by dataOffset. */
  readonly duplicatesByPtr: Map<bigint, BlendBlock[]>

  constructor(buf: Uint8Array, header: BlendHeader, sdna: SDNA, blocks: BlendBlock[]) {
    this.buf = buf
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
    this.header = header
    this.sdna = sdna
    this.little = header.endianness === 'little'
    this.textDecoder = new TextDecoder('utf-8', { fatal: false })
    this.blockByPtr = new Map()
    this.duplicatesByPtr = new Map()
    const groups = new Map<bigint, BlendBlock[]>()
    for (const b of blocks) {
      if (b.oldPtr === 0n) continue
      const existing = groups.get(b.oldPtr)
      if (existing) existing.push(b)
      else groups.set(b.oldPtr, [b])
    }
    for (const [ptr, list] of groups) {
      list.sort((a, b) => a.dataOffset - b.dataOffset)
      this.blockByPtr.set(ptr, list[0]!)
      if (list.length > 1) this.duplicatesByPtr.set(ptr, list)
    }
  }

  layoutOf(typeName: string): SDNAStructLayout {
    const idx = this.sdna.structIndexByType.get(typeName)
    if (idx === undefined) throw new Error(`SDNA has no struct named "${typeName}"`)
    return this.sdna.layouts[idx]!
  }

  fieldOf(layout: SDNAStructLayout, name: string): FieldLayout {
    const f = layout.fieldByName.get(name)
    if (!f) throw new Error(`Struct ${layout.typeName} has no field "${name}"`)
    return f
  }

  readPointer(offset: number): bigint {
    return this.header.pointerSize === 8
      ? this.view.getBigUint64(offset, this.little)
      : BigInt(this.view.getUint32(offset, this.little))
  }

  /**
   * Resolves a pointer to a block. When several blocks were written with the
   * same `oldPtr` (Blender's writer reuses temporary buffer addresses across
   * ID datablocks), pass `anchor` — the dataOffset of the block doing the
   * dereference — and the resolver returns the matching block whose payload
   * is nearest to (and at or after) the anchor in file order.
   */
  blockAt(ptr: bigint, anchor?: number): BlendBlock | undefined {
    if (ptr === 0n) return undefined
    const dup = this.duplicatesByPtr.get(ptr)
    if (!dup) return this.blockByPtr.get(ptr)
    if (anchor === undefined) return dup[0]
    let lo = 0
    let hi = dup.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (dup[mid]!.dataOffset < anchor) lo = mid + 1
      else hi = mid
    }
    return dup[lo] ?? dup[dup.length - 1]
  }

  readInt8(offset: number): number {
    return this.view.getInt8(offset)
  }
  readUint8(offset: number): number {
    return this.view.getUint8(offset)
  }
  readInt16(offset: number): number {
    return this.view.getInt16(offset, this.little)
  }
  readUint16(offset: number): number {
    return this.view.getUint16(offset, this.little)
  }
  readInt32(offset: number): number {
    return this.view.getInt32(offset, this.little)
  }
  readUint32(offset: number): number {
    return this.view.getUint32(offset, this.little)
  }
  readFloat32(offset: number): number {
    return this.view.getFloat32(offset, this.little)
  }
  readFloat64(offset: number): number {
    return this.view.getFloat64(offset, this.little)
  }
  readInt64(offset: number): bigint {
    return this.view.getBigInt64(offset, this.little)
  }
  readUint64(offset: number): bigint {
    return this.view.getBigUint64(offset, this.little)
  }

  /** Reads a null-terminated ASCII string out of a fixed-size char array. */
  readCString(offset: number, maxLen: number): string {
    let end = offset
    const stop = offset + maxLen
    while (end < stop && this.buf[end] !== 0) end++
    return this.textDecoder.decode(this.buf.subarray(offset, end))
  }

  /** Reads an arbitrary scalar primitive by its SDNA type name. Returns 0 for unknown types. */
  readPrimitive(typeName: string, offset: number): number | bigint {
    switch (typeName) {
      case 'char':
      case 'int8_t':
        return this.readInt8(offset)
      case 'uchar':
      case 'uint8_t':
        return this.readUint8(offset)
      case 'short':
        return this.readInt16(offset)
      case 'ushort':
      case 'uint16_t':
        return this.readUint16(offset)
      case 'int':
      case 'int32_t':
        return this.readInt32(offset)
      case 'uint':
      case 'uint32_t':
      case 'long':
      case 'ulong':
        return this.readUint32(offset)
      case 'float':
        return this.readFloat32(offset)
      case 'double':
        return this.readFloat64(offset)
      case 'int64_t':
        return this.readInt64(offset)
      case 'uint64_t':
        return this.readUint64(offset)
      default:
        return 0
    }
  }

  /**
   * Reads a field that holds a pointer, returning the destination block (if any).
   * The `anchor` is used as a tie-breaker when several blocks share an oldPtr.
   */
  followPointer(offset: number, anchor: number): BlendBlock | undefined {
    return this.blockAt(this.readPointer(offset), anchor)
  }

  /**
   * Reads an N-element float array starting at `offset` into a fresh Float32Array.
   */
  readFloatArray(offset: number, count: number): Float32Array {
    const out = new Float32Array(count)
    for (let i = 0; i < count; i++) out[i] = this.readFloat32(offset + i * 4)
    return out
  }

  /**
   * Reads an N-element int32 array starting at `offset` into a fresh Int32Array.
   */
  readInt32Array(offset: number, count: number): Int32Array {
    const out = new Int32Array(count)
    for (let i = 0; i < count; i++) out[i] = this.readInt32(offset + i * 4)
    return out
  }
}
