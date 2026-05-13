import { readCustomProperties } from './idproperty.ts'

import type { IDPropertyValue } from './idproperty.ts'
import type { BlendFileData } from './parser.ts'

export const CAMERA_TYPE = {
  PERSPECTIVE: 0,
  ORTHOGRAPHIC: 1,
  PANORAMIC: 2,
} as const

export const SENSOR_FIT = {
  AUTO: 0,
  HORIZONTAL: 1,
  VERTICAL: 2,
} as const

export type CameraTypeName = 'perspective' | 'orthographic' | 'panoramic' | 'unknown'
export type SensorFitName = 'auto' | 'horizontal' | 'vertical' | 'unknown'

const CAMERA_TYPE_NAMES: Record<number, CameraTypeName> = {
  [CAMERA_TYPE.PERSPECTIVE]: 'perspective',
  [CAMERA_TYPE.ORTHOGRAPHIC]: 'orthographic',
  [CAMERA_TYPE.PANORAMIC]: 'panoramic',
}

const SENSOR_FIT_NAMES: Record<number, SensorFitName> = {
  [SENSOR_FIT.AUTO]: 'auto',
  [SENSOR_FIT.HORIZONTAL]: 'horizontal',
  [SENSOR_FIT.VERTICAL]: 'vertical',
}

export interface Camera {
  name: string
  type: CameraTypeName
  /** Focal length in mm (perspective). */
  lens: number
  sensorWidth: number
  sensorHeight: number
  sensorFit: SensorFitName
  /** Half-size of the orthographic view (orthographic only). */
  orthoScale: number
  clipStart: number
  clipEnd: number
  shiftX: number
  shiftY: number
  customProperties: Record<string, IDPropertyValue>
}

export const extractCameras = (data: BlendFileData): Camera[] => {
  const { reader, blocks } = data
  const layout = reader.layoutOf('Camera')
  const idLayout = reader.layoutOf('ID')
  const fId = reader.fieldOf(layout, 'id')
  const fIdName = reader.fieldOf(idLayout, 'name')
  const fType = reader.fieldOf(layout, 'type')
  const fLens = reader.fieldOf(layout, 'lens')
  const fOrthoScale = reader.fieldOf(layout, 'ortho_scale')
  const fSensorX = reader.fieldOf(layout, 'sensor_x')
  const fSensorY = reader.fieldOf(layout, 'sensor_y')
  const fSensorFit = reader.fieldOf(layout, 'sensor_fit')
  const fClipSta = reader.fieldOf(layout, 'clipsta')
  const fClipEnd = reader.fieldOf(layout, 'clipend')
  const fShiftX = reader.fieldOf(layout, 'shiftx')
  const fShiftY = reader.fieldOf(layout, 'shifty')

  const out: Camera[] = []
  for (const block of blocks) {
    if (block.code !== 'CA') continue
    const base = block.dataOffset
    const rawName = reader.readCString(base + fId.offset + fIdName.offset, 64)
    const name = rawName.startsWith('CA') ? rawName.slice(2) : rawName
    const typeInt = reader.readInt8(base + fType.offset)
    const sensorFitInt = reader.readInt8(base + fSensorFit.offset)
    out.push({
      name,
      type: CAMERA_TYPE_NAMES[typeInt] ?? 'unknown',
      lens: reader.readFloat32(base + fLens.offset),
      sensorWidth: reader.readFloat32(base + fSensorX.offset),
      sensorHeight: reader.readFloat32(base + fSensorY.offset),
      sensorFit: SENSOR_FIT_NAMES[sensorFitInt] ?? 'unknown',
      orthoScale: reader.readFloat32(base + fOrthoScale.offset),
      clipStart: reader.readFloat32(base + fClipSta.offset),
      clipEnd: reader.readFloat32(base + fClipEnd.offset),
      shiftX: reader.readFloat32(base + fShiftX.offset),
      shiftY: reader.readFloat32(base + fShiftY.offset),
      customProperties: readCustomProperties(reader, base),
    })
  }
  return out
}
