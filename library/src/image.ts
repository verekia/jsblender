import { readCustomProperties } from './idproperty.ts'

import type { IDPropertyValue } from './idproperty.ts'
import type { BlendFileData } from './parser.ts'

export const IMAGE_SOURCE = {
  FILE: 0,
  SEQUENCE: 1,
  MOVIE: 2,
  GENERATED: 3,
  VIEWER: 4,
  TILED: 5,
} as const

export type ImageSourceName = 'file' | 'sequence' | 'movie' | 'generated' | 'viewer' | 'tiled' | 'unknown'

const IMAGE_SOURCE_NAMES: Record<number, ImageSourceName> = {
  [IMAGE_SOURCE.FILE]: 'file',
  [IMAGE_SOURCE.SEQUENCE]: 'sequence',
  [IMAGE_SOURCE.MOVIE]: 'movie',
  [IMAGE_SOURCE.GENERATED]: 'generated',
  [IMAGE_SOURCE.VIEWER]: 'viewer',
  [IMAGE_SOURCE.TILED]: 'tiled',
}

export interface Image {
  name: string
  /** Filepath as written in the blend; may be relative (e.g. `//tex.png`). */
  filepath: string
  source: ImageSourceName
  /** Generated image type / size (only meaningful when source === 'generated'). */
  generatedWidth: number
  generatedHeight: number
  /** Raw bytes of the embedded file (when image data is packed into the blend). */
  packed?: Uint8Array
  customProperties: Record<string, IDPropertyValue>
}

const readPackedFile = (data: BlendFileData, packedFilePtr: bigint, anchor: number): Uint8Array | undefined => {
  if (packedFilePtr === 0n) return undefined
  const { reader } = data
  const block = reader.blockAt(packedFilePtr, anchor)
  if (!block) return undefined
  const layout = reader.layoutOf('PackedFile')
  const fSize = reader.fieldOf(layout, 'size')
  const fData = reader.fieldOf(layout, 'data')
  const size = reader.readInt32(block.dataOffset + fSize.offset)
  const ptr = reader.readPointer(block.dataOffset + fData.offset)
  const dataBlock = reader.blockAt(ptr, block.dataOffset)
  if (!dataBlock || size <= 0) return undefined
  return reader.buf.slice(dataBlock.dataOffset, dataBlock.dataOffset + size)
}

export const extractImages = (data: BlendFileData): Image[] => {
  const { reader, blocks } = data
  const layout = reader.layoutOf('Image')
  const idLayout = reader.layoutOf('ID')
  const fId = reader.fieldOf(layout, 'id')
  const fIdName = reader.fieldOf(idLayout, 'name')
  const fName = reader.fieldOf(layout, 'name') // file path
  const fSource = reader.fieldOf(layout, 'source')
  const fGenX = reader.fieldOf(layout, 'gen_x')
  const fGenY = reader.fieldOf(layout, 'gen_y')
  const fPacked = reader.fieldOf(layout, 'packedfile')

  const out: Image[] = []
  for (const block of blocks) {
    if (block.code !== 'IM') continue
    const base = block.dataOffset
    const rawName = reader.readCString(base + fId.offset + fIdName.offset, 64)
    const name = rawName.startsWith('IM') ? rawName.slice(2) : rawName
    const filepath = reader.readCString(base + fName.offset, 1024)
    const sourceInt = reader.readInt16(base + fSource.offset)
    const packed = readPackedFile(data, reader.readPointer(base + fPacked.offset), base)
    out.push({
      name,
      filepath,
      source: IMAGE_SOURCE_NAMES[sourceInt] ?? 'unknown',
      generatedWidth: reader.readInt32(base + fGenX.offset),
      generatedHeight: reader.readInt32(base + fGenY.offset),
      packed,
      customProperties: readCustomProperties(reader, base),
    })
  }
  return out
}
