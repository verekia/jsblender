import type { BlendBlock, BlendHeader } from './types.ts'

const decodeCode = (buf: Uint8Array, offset: number): string => {
  let end = 4
  for (let i = 0; i < 4; i++) {
    if (buf[offset + i] === 0) {
      end = i
      break
    }
  }
  let s = ''
  for (let i = 0; i < end; i++) s += String.fromCharCode(buf[offset + i] ?? 0)
  return s
}

/**
 * Walks the file block-by-block starting right after the header and stops at
 * the ENDB sentinel. Each block returned exposes its payload by absolute byte
 * offset; nothing is copied.
 */
export const readBlocks = (buf: Uint8Array, header: BlendHeader): BlendBlock[] => {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const little = header.endianness === 'little'
  const blocks: BlendBlock[] = []
  let pos = header.size

  while (pos < buf.length) {
    if (header.largeFormat) {
      // 32-byte header: code[4], sdnaIndex u32, oldPtr u64, size u64, count u64
      if (pos + 32 > buf.length) break
      const code = decodeCode(buf, pos)
      const sdnaIndex = view.getUint32(pos + 4, little)
      const oldPtr = view.getBigUint64(pos + 8, little)
      const size = Number(view.getBigUint64(pos + 16, little))
      const count = Number(view.getBigUint64(pos + 24, little))
      blocks.push({ code, sdnaIndex, oldPtr, size, count, dataOffset: pos + 32 })
      if (code === 'ENDB') break
      pos += 32 + size
      continue
    }

    // Legacy header: code[4], size u32, oldPtr (pointerSize), sdnaIndex u32, count u32
    const headerSize = 16 + header.pointerSize
    if (pos + headerSize > buf.length) break
    const code = decodeCode(buf, pos)
    const size = view.getUint32(pos + 4, little)
    const oldPtr =
      header.pointerSize === 8 ? view.getBigUint64(pos + 8, little) : BigInt(view.getUint32(pos + 8, little))
    const sdnaIndex = view.getUint32(pos + 8 + header.pointerSize, little)
    const count = view.getUint32(pos + 12 + header.pointerSize, little)
    blocks.push({ code, sdnaIndex, oldPtr, size, count, dataOffset: pos + headerSize })
    if (code === 'ENDB') break
    pos += headerSize + size
  }

  return blocks
}
