export { parseBlend } from './parser.ts'
export type { BlendFileData } from './parser.ts'
export { extractMeshes } from './mesh.ts'
export type { Mesh, DeformVertex, DeformWeight } from './mesh.ts'
export { extractMaterials } from './material.ts'
export type { Material } from './material.ts'
export { extractObjects, OB_TYPE } from './object.ts'
export type { SceneObject } from './object.ts'
export { extractArmatures } from './armature.ts'
export type { Bone, Armature } from './armature.ts'
export {
  ATTR_TYPE,
  ATTR_DOMAIN,
  attributeElementSize,
  readAttributeStorage,
  readAttributeAsFloats,
  readAttributeAsInt32,
  readAttributeAsUint8,
} from './attributes.ts'
export type { MeshAttributeRaw, AttrTypeName, AttrTypeValue, AttrDomainName, AttrDomainValue } from './attributes.ts'
export { parseFieldName, fieldSize } from './field.ts'
export type {
  BlendHeader,
  BlendBlock,
  SDNA,
  SDNAStruct,
  SDNAStructLayout,
  SDNAField,
  FieldLayout,
  ParsedFieldName,
  Endianness,
  PointerSize,
} from './types.ts'
