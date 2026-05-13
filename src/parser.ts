import { readBlocks } from './blocks.ts'
import { decompressBlend } from './decompress.ts'
import { parseHeader } from './header.ts'
import { StructReader } from './reader.ts'
import { parseSDNA } from './sdna.ts'

import type { BlendBlock, BlendHeader, SDNA } from './types.ts'

export interface BlendFileData {
  header: BlendHeader
  sdna: SDNA
  blocks: BlendBlock[]
  reader: StructReader
}

/**
 * Decompresses (if needed), validates, and indexes a .blend file. The returned
 * object is the foundation every extractor reads from.
 */
export const parseBlend = (raw: Uint8Array | ArrayBuffer): BlendFileData => {
  const u8 = raw instanceof Uint8Array ? raw : new Uint8Array(raw)
  const buf = decompressBlend(u8)
  const header = parseHeader(buf)
  const blocks = readBlocks(buf, header)
  const dna1 = blocks.find(b => b.code === 'DNA1')
  if (!dna1) throw new Error('No DNA1 block found in .blend file')
  const sdna = parseSDNA(buf, dna1, header)
  const reader = new StructReader(buf, header, sdna, blocks)
  return { header, sdna, blocks, reader }
}
