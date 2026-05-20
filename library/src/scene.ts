import { readCustomProperties, readCustomPropertyTypes } from './idproperty.ts'

import type { IDPropertyTypeName, IDPropertyValue } from './idproperty.ts'
import type { BlendFileData } from './parser.ts'

export interface Collection {
  name: string
  /** Names of objects directly placed in this collection. */
  objectNames: string[]
  /** Sub-collections (recursive). */
  children: Collection[]
  customProperties: Record<string, IDPropertyValue>
  /** Original `IDP_TYPE` for each top-level custom property (parallel to `customProperties`). */
  customPropertyTypes: Record<string, IDPropertyTypeName>
}

export interface Scene {
  name: string
  /** Linked active-camera object name, if set. */
  cameraObject?: string
  frameStart: number
  frameEnd: number
  frameCurrent: number
  /** Effective FPS: `fpsNumerator / fpsDenominator`. */
  fps: number
  resolutionX: number
  resolutionY: number
  /** Render-resolution percentage (100 = full). */
  resolutionPercentage: number
  /** Master scene collection — the root of the scene's collection tree. */
  rootCollection?: Collection
  customProperties: Record<string, IDPropertyValue>
  /** Original `IDP_TYPE` for each top-level custom property (parallel to `customProperties`). */
  customPropertyTypes: Record<string, IDPropertyTypeName>
}

const idNameWithoutPrefix = (raw: string): string => (raw.length >= 2 ? raw.slice(2) : raw)

const readCollectionTree = (
  data: BlendFileData,
  collectionPtr: bigint,
  anchor: number,
  seen: Set<bigint>,
): Collection | undefined => {
  if (collectionPtr === 0n) return undefined
  if (seen.has(collectionPtr)) return undefined
  seen.add(collectionPtr)
  const { reader } = data
  const block = reader.blockAt(collectionPtr, anchor)
  if (!block) return undefined

  const layout = reader.layoutOf('Collection')
  const idLayout = reader.layoutOf('ID')
  const fId = reader.fieldOf(layout, 'id')
  const fIdName = reader.fieldOf(idLayout, 'name')
  const fGobject = reader.fieldOf(layout, 'gobject')
  const fChildren = reader.fieldOf(layout, 'children')

  const base = block.dataOffset
  const rawName = reader.readCString(base + fId.offset + fIdName.offset, 64)
  const name = idNameWithoutPrefix(rawName)

  // gobject is a ListBase<CollectionObject>; each CollectionObject has an Object*.
  const coLayout = reader.layoutOf('CollectionObject')
  const fCoNext = reader.fieldOf(coLayout, 'next')
  const fCoOb = reader.fieldOf(coLayout, 'ob')
  const objectNames: string[] = []
  let cursor = reader.readPointer(base + fGobject.offset)
  let walkAnchor = base
  let safety = 0
  while (cursor !== 0n) {
    if (++safety > 100_000) break
    const coBlock = reader.blockAt(cursor, walkAnchor)
    if (!coBlock) break
    const coOffset = Number(cursor - coBlock.oldPtr) + coBlock.dataOffset
    const obPtr = reader.readPointer(coOffset + fCoOb.offset)
    const obBlock = reader.blockAt(obPtr)
    if (obBlock) {
      const obName = reader.readCString(obBlock.dataOffset + fIdName.offset, 64)
      objectNames.push(idNameWithoutPrefix(obName))
    }
    cursor = reader.readPointer(coOffset + fCoNext.offset)
    walkAnchor = coBlock.dataOffset
  }

  // children is a ListBase<CollectionChild>; each CollectionChild points at a Collection.
  const ccLayout = reader.layoutOf('CollectionChild')
  const fCcNext = reader.fieldOf(ccLayout, 'next')
  const fCcCollection = reader.fieldOf(ccLayout, 'collection')
  const children: Collection[] = []
  cursor = reader.readPointer(base + fChildren.offset)
  walkAnchor = base
  safety = 0
  while (cursor !== 0n) {
    if (++safety > 100_000) break
    const ccBlock = reader.blockAt(cursor, walkAnchor)
    if (!ccBlock) break
    const ccOffset = Number(cursor - ccBlock.oldPtr) + ccBlock.dataOffset
    const childPtr = reader.readPointer(ccOffset + fCcCollection.offset)
    const child = readCollectionTree(data, childPtr, ccBlock.dataOffset, seen)
    if (child) children.push(child)
    cursor = reader.readPointer(ccOffset + fCcNext.offset)
    walkAnchor = ccBlock.dataOffset
  }

  return {
    name,
    objectNames,
    children,
    customProperties: readCustomProperties(reader, base),
    customPropertyTypes: readCustomPropertyTypes(reader, base),
  }
}

export const extractScenes = (data: BlendFileData): Scene[] => {
  const { reader, blocks } = data
  const layout = reader.layoutOf('Scene')
  const idLayout = reader.layoutOf('ID')
  const fId = reader.fieldOf(layout, 'id')
  const fIdName = reader.fieldOf(idLayout, 'name')
  const fCamera = reader.fieldOf(layout, 'camera')
  const fRoot = reader.fieldOf(layout, 'master_collection')
  const fR = reader.fieldOf(layout, 'r') // RenderData (embedded)

  const renderLayout = reader.layoutOf('RenderData')
  const fCfra = reader.fieldOf(renderLayout, 'cfra')
  const fSfra = reader.fieldOf(renderLayout, 'sfra')
  const fEfra = reader.fieldOf(renderLayout, 'efra')
  const fXsch = reader.fieldOf(renderLayout, 'xsch')
  const fYsch = reader.fieldOf(renderLayout, 'ysch')
  const fSize = reader.fieldOf(renderLayout, 'size')
  const fFrsSec = reader.fieldOf(renderLayout, 'frs_sec')
  const fFrsSecBase = reader.fieldOf(renderLayout, 'frs_sec_base')

  const out: Scene[] = []
  for (const block of blocks) {
    if (block.code !== 'SC') continue
    const base = block.dataOffset
    const rawName = reader.readCString(base + fId.offset + fIdName.offset, 64)
    const name = idNameWithoutPrefix(rawName)

    const renderBase = base + fR.offset
    const frsSecNum = reader.readInt16(renderBase + fFrsSec.offset)
    const frsSecDen = reader.readFloat32(renderBase + fFrsSecBase.offset)

    const cameraPtr = reader.readPointer(base + fCamera.offset)
    const cameraBlock = reader.blockAt(cameraPtr)
    const cameraObject = cameraBlock
      ? idNameWithoutPrefix(reader.readCString(cameraBlock.dataOffset + fIdName.offset, 64))
      : undefined

    const rootPtr = reader.readPointer(base + fRoot.offset)
    const rootCollection = readCollectionTree(data, rootPtr, base, new Set())

    out.push({
      name,
      cameraObject,
      frameStart: reader.readInt32(renderBase + fSfra.offset),
      frameEnd: reader.readInt32(renderBase + fEfra.offset),
      frameCurrent: reader.readInt32(renderBase + fCfra.offset),
      fps: frsSecDen !== 0 ? frsSecNum / frsSecDen : frsSecNum,
      resolutionX: reader.readInt32(renderBase + fXsch.offset),
      resolutionY: reader.readInt32(renderBase + fYsch.offset),
      resolutionPercentage: reader.readInt16(renderBase + fSize.offset),
      rootCollection,
      customProperties: readCustomProperties(reader, base),
      customPropertyTypes: readCustomPropertyTypes(reader, base),
    })
  }
  return out
}

/** Flat list of every top-level Collection (`GR`) datablock. */
export const extractCollections = (data: BlendFileData): Collection[] => {
  const { blocks } = data
  const out: Collection[] = []
  for (const block of blocks) {
    if (block.code !== 'GR') continue
    const c = readCollectionTree(data, block.oldPtr, block.dataOffset, new Set())
    if (c) out.push(c)
  }
  return out
}
