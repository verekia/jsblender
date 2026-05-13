import type { BlendFileData } from './parser.ts'

export interface Material {
  name: string
  diffuse: [number, number, number, number]
  specular: [number, number, number]
  metallic: number
  roughness: number
  /** True when this material uses a node tree (modern Blender always does). */
  hasNodeTree: boolean
}

export const extractMaterials = (data: BlendFileData): Material[] => {
  const { reader, blocks } = data
  const matLayout = reader.layoutOf('Material')
  const idLayout = reader.layoutOf('ID')
  const fId = reader.fieldOf(matLayout, 'id')
  const fIdName = reader.fieldOf(idLayout, 'name')
  const fR = reader.fieldOf(matLayout, 'r')
  const fG = reader.fieldOf(matLayout, 'g')
  const fB = reader.fieldOf(matLayout, 'b')
  const fA = reader.fieldOf(matLayout, 'a')
  const fSR = reader.fieldOf(matLayout, 'specr')
  const fSG = reader.fieldOf(matLayout, 'specg')
  const fSB = reader.fieldOf(matLayout, 'specb')
  const fMetallic = matLayout.fieldByName.get('metallic')
  const fRoughness = matLayout.fieldByName.get('roughness')
  const fNodeTree = matLayout.fieldByName.get('nodetree')

  const out: Material[] = []
  for (const block of blocks) {
    if (block.code !== 'MA') continue
    const base = block.dataOffset
    const rawName = reader.readCString(base + fId.offset + fIdName.offset, 64)
    const name = rawName.startsWith('MA') ? rawName.slice(2) : rawName
    const diffuse: [number, number, number, number] = [
      reader.readFloat32(base + fR.offset),
      reader.readFloat32(base + fG.offset),
      reader.readFloat32(base + fB.offset),
      reader.readFloat32(base + fA.offset),
    ]
    const specular: [number, number, number] = [
      reader.readFloat32(base + fSR.offset),
      reader.readFloat32(base + fSG.offset),
      reader.readFloat32(base + fSB.offset),
    ]
    const metallic = fMetallic ? reader.readFloat32(base + fMetallic.offset) : 0
    const roughness = fRoughness ? reader.readFloat32(base + fRoughness.offset) : 0
    const hasNodeTree = fNodeTree ? reader.readPointer(base + fNodeTree.offset) !== 0n : false
    out.push({ name, diffuse, specular, metallic, roughness, hasNodeTree })
  }
  return out
}
