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
export { extractLights, LIGHT_TYPE, AREA_SHAPE } from './light.ts'
export type { Light, LightTypeName, AreaShapeName } from './light.ts'
export { extractCameras, CAMERA_TYPE, SENSOR_FIT } from './camera.ts'
export type { Camera, CameraTypeName, SensorFitName } from './camera.ts'
export { extractImages, IMAGE_SOURCE } from './image.ts'
export type { Image, ImageSourceName } from './image.ts'
export { extractScenes, extractCollections } from './scene.ts'
export type { Scene, Collection } from './scene.ts'
export { readMaterialShaderGraph } from './shader.ts'
export type { ShaderGraph, ShaderNode, ShaderSocket, PrincipledBSDF } from './shader.ts'
export { readCustomProperties, decodeIDPropertyAt, IDP_TYPE } from './idproperty.ts'
export type { IDPropertyValue } from './idproperty.ts'
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
