import { readCustomProperties } from './idproperty.ts'

import type { IDPropertyValue } from './idproperty.ts'
import type { BlendFileData } from './parser.ts'

export const LIGHT_TYPE = {
  POINT: 0,
  SUN: 1,
  SPOT: 2,
  AREA: 4,
} as const

export const AREA_SHAPE = {
  SQUARE: 0,
  RECTANGLE: 1,
  DISK: 4,
  ELLIPSE: 5,
} as const

export type LightTypeName = 'point' | 'sun' | 'spot' | 'area' | 'unknown'
export type AreaShapeName = 'square' | 'rectangle' | 'disk' | 'ellipse' | 'unknown'

const LIGHT_TYPE_NAMES: Record<number, LightTypeName> = {
  [LIGHT_TYPE.POINT]: 'point',
  [LIGHT_TYPE.SUN]: 'sun',
  [LIGHT_TYPE.SPOT]: 'spot',
  [LIGHT_TYPE.AREA]: 'area',
}

const AREA_SHAPE_NAMES: Record<number, AreaShapeName> = {
  [AREA_SHAPE.SQUARE]: 'square',
  [AREA_SHAPE.RECTANGLE]: 'rectangle',
  [AREA_SHAPE.DISK]: 'disk',
  [AREA_SHAPE.ELLIPSE]: 'ellipse',
}

export interface Light {
  name: string
  type: LightTypeName
  /** Linear RGB triple. */
  color: [number, number, number]
  /** Energy / strength. */
  energy: number
  /** Soft-shadow radius. */
  radius: number
  spotSize?: number
  spotBlend?: number
  sunAngle?: number
  areaShape?: AreaShapeName
  /** Area X size, or X and Y for rectangle/ellipse. */
  areaSize?: [number] | [number, number]
  useNodes: boolean
  customProperties: Record<string, IDPropertyValue>
}

export const extractLights = (data: BlendFileData): Light[] => {
  const { reader, blocks } = data
  const layout = reader.layoutOf('Lamp')
  const idLayout = reader.layoutOf('ID')
  const fId = reader.fieldOf(layout, 'id')
  const fIdName = reader.fieldOf(idLayout, 'name')
  const fType = reader.fieldOf(layout, 'type')
  const fR = reader.fieldOf(layout, 'r')
  const fG = reader.fieldOf(layout, 'g')
  const fB = reader.fieldOf(layout, 'b')
  const fEnergy = layout.fieldByName.get('energy') ?? reader.fieldOf(layout, 'energy_new')
  const fRadius = reader.fieldOf(layout, 'radius')
  const fSpotSize = layout.fieldByName.get('spotsize')
  const fSpotBlend = layout.fieldByName.get('spotblend')
  const fSunAngle = layout.fieldByName.get('sun_angle')
  const fAreaShape = layout.fieldByName.get('area_shape')
  const fAreaSize = layout.fieldByName.get('area_size')
  const fAreaSizeY = layout.fieldByName.get('area_sizey')
  const fUseNodes = layout.fieldByName.get('use_nodes')

  const out: Light[] = []
  for (const block of blocks) {
    if (block.code !== 'LA') continue
    const base = block.dataOffset
    const rawName = reader.readCString(base + fId.offset + fIdName.offset, 64)
    const name = rawName.startsWith('LA') ? rawName.slice(2) : rawName
    const typeInt = reader.readInt16(base + fType.offset)
    const type = LIGHT_TYPE_NAMES[typeInt] ?? 'unknown'
    const color: [number, number, number] = [
      reader.readFloat32(base + fR.offset),
      reader.readFloat32(base + fG.offset),
      reader.readFloat32(base + fB.offset),
    ]
    const energy = reader.readFloat32(base + fEnergy.offset)
    const radius = reader.readFloat32(base + fRadius.offset)
    const useNodes = fUseNodes ? reader.readInt16(base + fUseNodes.offset) !== 0 : false

    const light: Light = {
      name,
      type,
      color,
      energy,
      radius,
      useNodes,
      customProperties: readCustomProperties(reader, base),
    }

    if (type === 'spot') {
      if (fSpotSize) light.spotSize = reader.readFloat32(base + fSpotSize.offset)
      if (fSpotBlend) light.spotBlend = reader.readFloat32(base + fSpotBlend.offset)
    }
    if (type === 'sun' && fSunAngle) light.sunAngle = reader.readFloat32(base + fSunAngle.offset)
    if (type === 'area') {
      if (fAreaShape) {
        const shapeInt = reader.readInt16(base + fAreaShape.offset)
        light.areaShape = AREA_SHAPE_NAMES[shapeInt] ?? 'unknown'
      }
      const sx = fAreaSize ? reader.readFloat32(base + fAreaSize.offset) : 0
      const sy = fAreaSizeY ? reader.readFloat32(base + fAreaSizeY.offset) : 0
      light.areaSize = light.areaShape === 'rectangle' || light.areaShape === 'ellipse' ? [sx, sy] : [sx]
    }

    out.push(light)
  }
  return out
}
