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
export { evaluateMesh, evaluateAllMeshes, extractObjectModifiers, MOD_TYPE } from './modifier.ts'
export type { Modifier, MirrorModifier, ArrayModifier, UnknownModifier } from './modifier.ts'
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
export {
  composeObjectMatrix,
  mat3Invert,
  mat3Transpose,
  mat3TransformDirection,
  mat4Identity,
  mat4Invert,
  mat4Multiply,
  mat4ToMat3,
  mat4TransformDirection,
  mat4TransformPoint,
} from './transform.ts'
export type { Mat3, Mat4, Vec3, Vec4, ObjectTransformInputs } from './transform.ts'
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
