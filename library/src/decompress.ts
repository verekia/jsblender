import { decompress as zstdDecompress } from 'fzstd'

const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd]
const GZIP_MAGIC = [0x1f, 0x8b]
const BLENDER_MAGIC_FIRST = 0x42 // 'B'

const hasMagic = (buf: Uint8Array, magic: number[]): boolean => {
  if (buf.length < magic.length) return false
  for (let i = 0; i < magic.length; i++) {
    if (buf[i] !== magic[i]) return false
  }
  return true
}

/**
 * Returns an uncompressed view of a .blend payload. Handles zstd (Blender 3.0+
 * default), gzip (legacy), and already-uncompressed files.
 */
export const decompressBlend = (buf: Uint8Array): Uint8Array => {
  if (hasMagic(buf, ZSTD_MAGIC)) return zstdDecompress(buf)
  if (hasMagic(buf, GZIP_MAGIC)) {
    // Bun (and modern Node) expose a synchronous gunzip. Browsers do not — the
    // platform's DecompressionStream is async and would break this sync API.
    // Blender 3.0+ writes zstd by default, so gzip is mostly legacy.
    const g = globalThis as { Bun?: { gunzipSync: (b: Uint8Array) => Uint8Array } }
    if (g.Bun?.gunzipSync) return g.Bun.gunzipSync(buf)
    throw new Error(
      'gzip-compressed .blend files are not supported in this runtime; re-save the file with Blender 3+ (zstd) or decompress it first',
    )
  }
  if (buf[0] === BLENDER_MAGIC_FIRST) return buf
  throw new Error('Not a .blend file: unrecognised magic bytes')
}
