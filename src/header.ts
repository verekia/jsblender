import type { BlendHeader } from './types.ts'

const MAGIC = 'BLENDER'

const decodeAscii = (buf: Uint8Array, offset: number, length: number): string => {
  let s = ''
  for (let i = 0; i < length; i++) s += String.fromCharCode(buf[offset + i] ?? 0)
  return s
}

/**
 * Parses the leading bytes of an uncompressed .blend file.
 *
 * Two header shapes exist in the wild:
 *
 *   Legacy (12 bytes): `BLENDER<P><E><V V V>`
 *     P = '_' (32-bit pointers) or '-' (64-bit pointers)
 *     E = 'v' (little-endian) or 'V' (big-endian)
 *     VVV = three-digit version, e.g. "500" for Blender 5.00
 *
 *   Modern large-format (17 bytes), introduced with Blender 5's
 *   AttributeStorage-era format: `BLENDER<F F><P><X X><E><V V V V>`
 *     FF = file format version (two digits, >= 17), signalling the
 *          extended 32-byte block header layout
 *     P  = pointer size ('-' / '_')
 *     XX = reserved
 *     E  = endianness flag
 *     VVVV = four-digit Blender version, e.g. "0501" for 5.01
 */
export const parseHeader = (buf: Uint8Array): BlendHeader => {
  if (buf.length < 12) throw new Error('File too small to be a .blend')
  if (decodeAscii(buf, 0, 7) !== MAGIC) throw new Error('Not a .blend file: missing BLENDER magic')

  const c7 = String.fromCharCode(buf[7] ?? 0)
  const isLegacy = c7 === '_' || c7 === '-'

  if (isLegacy) {
    const pointerSize = c7 === '-' ? 8 : 4
    const endianness = String.fromCharCode(buf[8] ?? 0) === 'v' ? 'little' : 'big'
    const versionString = decodeAscii(buf, 9, 3)
    const version = Number(versionString[0]) + Number(versionString.slice(1)) / 100
    return { versionString, version, pointerSize, endianness, largeFormat: false, size: 12 }
  }

  if (buf.length < 17) throw new Error('File too small for modern .blend header')
  const pointerSize = String.fromCharCode(buf[9] ?? 0) === '-' ? 8 : 4
  const endianness = String.fromCharCode(buf[12] ?? 0) === 'v' ? 'little' : 'big'
  const versionString = decodeAscii(buf, 13, 4)
  const version = Number(versionString.slice(0, 1)) + Number(versionString.slice(1)) / 100
  return { versionString, version, pointerSize, endianness, largeFormat: true, size: 17 }
}
