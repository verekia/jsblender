import type { BlendFileData } from './parser.ts'

export interface ShaderSocket {
  name: string
  identifier: string
  /** Decoded socket default value (number, [r,g,b,a], etc.). `undefined` when not stored. */
  defaultValue?: number | number[] | string | boolean
  /** When connected, the upstream node + socket. */
  linkedFrom?: { nodeName: string; socketName: string }
}

export interface ShaderNode {
  name: string
  /** Blender's idname, e.g. `ShaderNodeBsdfPrincipled`, `ShaderNodeTexImage`. */
  idname: string
  type: number
  inputs: ShaderSocket[]
  outputs: ShaderSocket[]
  /** When the node has an `ID *id` linked (e.g. an Image Texture's image), this is its name. */
  linkedDataName?: string
}

export interface ShaderGraph {
  nodes: ShaderNode[]
  /** Convenience: the first Principled BSDF found, with its inputs distilled. */
  principled?: PrincipledBSDF
}

export interface PrincipledBSDF {
  nodeName: string
  baseColor: [number, number, number, number]
  metallic: number
  roughness: number
  ior: number
  alpha: number
  emissionColor: [number, number, number, number]
  emissionStrength: number
  normalStrength?: number
  /** Image name connected to Base Color, if any. */
  baseColorImage?: string
  /** Image name connected to Normal (via a Normal Map node), if any. */
  normalImage?: string
  /** Image name connected to Roughness, if any. */
  roughnessImage?: string
  /** Image name connected to Metallic, if any. */
  metallicImage?: string
}

const SOCK_FLOAT = 0
const SOCK_VECTOR = 1
const SOCK_RGBA = 2
const SOCK_BOOLEAN = 4
const SOCK_INT = 6
const SOCK_STRING = 7

const decodeSocketDefault = (
  data: BlendFileData,
  socketType: number,
  defaultValuePtr: bigint,
  anchor: number,
): ShaderSocket['defaultValue'] => {
  if (defaultValuePtr === 0n) return undefined
  const { reader } = data
  const block = reader.blockAt(defaultValuePtr, anchor)
  if (!block) return undefined
  const off = block.dataOffset

  switch (socketType) {
    case SOCK_FLOAT: {
      const layout = reader.layoutOf('bNodeSocketValueFloat')
      return reader.readFloat32(off + reader.fieldOf(layout, 'value').offset)
    }
    case SOCK_INT: {
      const layout = reader.layoutOf('bNodeSocketValueInt')
      return reader.readInt32(off + reader.fieldOf(layout, 'value').offset)
    }
    case SOCK_BOOLEAN: {
      const layout = reader.layoutOf('bNodeSocketValueBoolean')
      return reader.readUint8(off + reader.fieldOf(layout, 'value').offset) !== 0
    }
    case SOCK_VECTOR: {
      const layout = reader.layoutOf('bNodeSocketValueVector')
      const f = reader.fieldOf(layout, 'value')
      // value[4] in modern Blender; older was value[3]. We return up to 4 floats.
      const count = f.size / 4
      return reader.readFloatArray(off + f.offset, Math.min(count, 4)) as unknown as number[] | undefined
    }
    case SOCK_RGBA: {
      const layout = reader.layoutOf('bNodeSocketValueRGBA')
      return Array.from(reader.readFloatArray(off + reader.fieldOf(layout, 'value').offset, 4))
    }
    case SOCK_STRING: {
      const layout = reader.layoutOf('bNodeSocketValueString')
      return reader.readCString(off + reader.fieldOf(layout, 'value').offset, 1024)
    }
    default:
      return undefined
  }
}

const readSocketList = (data: BlendFileData, listHeadOffset: number, anchor: number): ShaderSocket[] => {
  const { reader } = data
  const layout = reader.layoutOf('bNodeSocket')
  const fNext = reader.fieldOf(layout, 'next')
  const fName = reader.fieldOf(layout, 'name')
  const fIdent = reader.fieldOf(layout, 'identifier')
  const fType = reader.fieldOf(layout, 'type')
  const fDefault = reader.fieldOf(layout, 'default_value')
  const fLink = reader.fieldOf(layout, 'link')

  const out: ShaderSocket[] = []
  let cursor = reader.readPointer(listHeadOffset)
  let walkAnchor = anchor
  let safety = 0
  while (cursor !== 0n) {
    if (++safety > 10_000) break
    const block = reader.blockAt(cursor, walkAnchor)
    if (!block) break
    const offset = Number(cursor - block.oldPtr) + block.dataOffset
    const name = reader.readCString(offset + fName.offset, 64)
    const identifier = reader.readCString(offset + fIdent.offset, 64)
    const type = reader.readInt16(offset + fType.offset)
    const defaultValuePtr = reader.readPointer(offset + fDefault.offset)
    const linkPtr = reader.readPointer(offset + fLink.offset)
    const socket: ShaderSocket = {
      name,
      identifier,
      defaultValue: decodeSocketDefault(data, type, defaultValuePtr, block.dataOffset),
    }
    if (linkPtr !== 0n) {
      const linkBlock = reader.blockAt(linkPtr, block.dataOffset)
      if (linkBlock) {
        // bNodeLink: fromnode, fromsock, tonode, tosock
        const linkLayout = reader.layoutOf('bNodeLink')
        const fFromNode = reader.fieldOf(linkLayout, 'fromnode')
        const fFromSock = reader.fieldOf(linkLayout, 'fromsock')
        const fromNodePtr = reader.readPointer(linkBlock.dataOffset + fFromNode.offset)
        const fromSockPtr = reader.readPointer(linkBlock.dataOffset + fFromSock.offset)
        const fromNodeBlock = reader.blockAt(fromNodePtr, linkBlock.dataOffset)
        const fromSockBlock = reader.blockAt(fromSockPtr, linkBlock.dataOffset)
        if (fromNodeBlock || fromSockBlock) {
          const nodeName = fromNodeBlock
            ? reader.readCString(fromNodeBlock.dataOffset + reader.fieldOf(reader.layoutOf('bNode'), 'name').offset, 64)
            : ''
          const sockName = fromSockBlock
            ? reader.readCString(fromSockBlock.dataOffset + reader.fieldOf(layout, 'name').offset, 64)
            : ''
          socket.linkedFrom = { nodeName, socketName: sockName }
        }
      }
    }
    out.push(socket)
    cursor = reader.readPointer(offset + fNext.offset)
    walkAnchor = block.dataOffset
  }
  return out
}

const readNodeTree = (data: BlendFileData, nodeTreeBlockPtr: bigint, anchor: number): ShaderNode[] => {
  const { reader } = data
  const treeBlock = reader.blockAt(nodeTreeBlockPtr, anchor)
  if (!treeBlock) return []
  const treeLayout = reader.layoutOf('bNodeTree')
  const fNodes = reader.fieldOf(treeLayout, 'nodes')
  const nodeLayout = reader.layoutOf('bNode')
  const fNext = reader.fieldOf(nodeLayout, 'next')
  const fName = reader.fieldOf(nodeLayout, 'name')
  const fIdname = reader.fieldOf(nodeLayout, 'idname')
  const fType = reader.fieldOf(nodeLayout, 'type')
  const fInputs = reader.fieldOf(nodeLayout, 'inputs')
  const fOutputs = reader.fieldOf(nodeLayout, 'outputs')
  const fId = reader.fieldOf(nodeLayout, 'id')
  const idLayout = reader.layoutOf('ID')
  const fIdName = reader.fieldOf(idLayout, 'name')

  const out: ShaderNode[] = []
  let cursor = reader.readPointer(treeBlock.dataOffset + fNodes.offset)
  let walkAnchor = treeBlock.dataOffset
  let safety = 0
  while (cursor !== 0n) {
    if (++safety > 100_000) break
    const block = reader.blockAt(cursor, walkAnchor)
    if (!block) break
    const offset = Number(cursor - block.oldPtr) + block.dataOffset
    const inputs = readSocketList(data, offset + fInputs.offset, block.dataOffset)
    const outputs = readSocketList(data, offset + fOutputs.offset, block.dataOffset)
    const linkedIdPtr = reader.readPointer(offset + fId.offset)
    const linkedIdBlock = reader.blockAt(linkedIdPtr)
    const linkedDataName = linkedIdBlock
      ? reader.readCString(linkedIdBlock.dataOffset + fIdName.offset, 64).slice(2)
      : undefined
    out.push({
      name: reader.readCString(offset + fName.offset, 64),
      idname: reader.readCString(offset + fIdname.offset, 64),
      type: reader.readInt16(offset + fType.offset),
      inputs,
      outputs,
      linkedDataName,
    })
    cursor = reader.readPointer(offset + fNext.offset)
    walkAnchor = block.dataOffset
  }
  return out
}

const findInput = (node: ShaderNode | undefined, name: string): ShaderSocket | undefined =>
  node?.inputs.find(s => s.name === name)

const imageFromLink = (nodes: ShaderNode[], socket: ShaderSocket | undefined): string | undefined => {
  if (!socket?.linkedFrom) return undefined
  const node = nodes.find(n => n.name === socket.linkedFrom!.nodeName)
  if (!node) return undefined
  if (node.idname === 'ShaderNodeTexImage') return node.linkedDataName
  // Normal Map node wraps an image upstream of its Color socket.
  if (node.idname === 'ShaderNodeNormalMap') return imageFromLink(nodes, findInput(node, 'Color'))
  return undefined
}

const findPrincipled = (nodes: ShaderNode[]): PrincipledBSDF | undefined => {
  const node = nodes.find(n => n.idname === 'ShaderNodeBsdfPrincipled')
  if (!node) return undefined

  const colorValue = (s: ShaderSocket | undefined, fallback: [number, number, number, number]) =>
    Array.isArray(s?.defaultValue) ? ([...s!.defaultValue] as [number, number, number, number]) : fallback
  const floatValue = (s: ShaderSocket | undefined, fallback: number) =>
    typeof s?.defaultValue === 'number' ? s.defaultValue : fallback

  const baseColor = findInput(node, 'Base Color')
  const metallic = findInput(node, 'Metallic')
  const roughness = findInput(node, 'Roughness')
  const ior = findInput(node, 'IOR')
  const alpha = findInput(node, 'Alpha')
  const emissionColor = findInput(node, 'Emission Color') ?? findInput(node, 'Emission')
  const emissionStrength = findInput(node, 'Emission Strength')
  const normal = findInput(node, 'Normal')

  return {
    nodeName: node.name,
    baseColor: colorValue(baseColor, [0.8, 0.8, 0.8, 1]),
    metallic: floatValue(metallic, 0),
    roughness: floatValue(roughness, 0.5),
    ior: floatValue(ior, 1.45),
    alpha: floatValue(alpha, 1),
    emissionColor: colorValue(emissionColor, [0, 0, 0, 1]),
    emissionStrength: floatValue(emissionStrength, 0),
    baseColorImage: imageFromLink(nodes, baseColor),
    normalImage: imageFromLink(nodes, normal),
    roughnessImage: imageFromLink(nodes, roughness),
    metallicImage: imageFromLink(nodes, metallic),
  }
}

/**
 * Reads a Material's node tree (if any) and returns the flat node list plus a
 * distilled Principled BSDF view.
 */
export const readMaterialShaderGraph = (data: BlendFileData, materialBlockOffset: number): ShaderGraph | undefined => {
  const { reader } = data
  const matLayout = reader.layoutOf('Material')
  const fNodetree = matLayout.fieldByName.get('nodetree')
  if (!fNodetree) return undefined
  const ptr = reader.readPointer(materialBlockOffset + fNodetree.offset)
  if (ptr === 0n) return undefined
  const nodes = readNodeTree(data, ptr, materialBlockOffset)
  if (nodes.length === 0) return undefined
  return { nodes, principled: findPrincipled(nodes) }
}
