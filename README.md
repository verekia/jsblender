# jsblender

Modern, typesafe `.blend` file parser for Blender 5 and up. Works in Node, Bun, and the browser.

⚠️ Heavily vibe-coded. The code is not reviewed, will probably crash on edge-case `.blend` files, and the surface area exposed only covers what the author needed. Not recommended for anything important.

## Status

- Decompresses zstd (Blender 3.0+ default) and reads already-uncompressed `.blend` files.
- Parses the modern 17-byte file header and the 32-byte block headers used by Blender 5.
- Reconstructs the SDNA (Structure DNA) schema and exposes typed struct layouts.
- Resolves Blender 5's reused-pointer quirk: the writer hands several ID datablocks the same `oldPtr` for their temporary buffers — `jsblender` disambiguates by file position.

## Install

```sh
npm install jsblender
# or
bun add jsblender
```

ESM-only. Node 18+, Bun, or any modern browser. The only runtime dependency is [`fzstd`](https://github.com/101arrowz/fzstd) (pure JS).

## Quick start

```ts
import { readFileSync } from 'node:fs'
import {
  parseBlend,
  extractScenes,
  extractMeshes,
  extractMaterials,
  extractObjects,
  extractLights,
  extractCameras,
  extractImages,
  extractArmatures,
} from 'jsblender'

const blend = parseBlend(readFileSync('scene.blend'))

console.log(blend.header)
// { version: 5.01, pointerSize: 8, endianness: 'little', largeFormat: true, size: 17, versionString: '0501' }

for (const mesh of extractMeshes(blend)) {
  console.log(mesh.name, mesh.vertexCount, mesh.faceCount, mesh.triangles.length / 3)
  console.log('custom props:', mesh.customProperties)
}
```

In the browser, get the bytes from a drop / file picker / fetch:

```ts
const buf = new Uint8Array(await file.arrayBuffer())
const blend = parseBlend(buf)
```

## API

### `parseBlend(input: Uint8Array | ArrayBuffer): BlendFileData`

Decompresses (if needed), validates, and indexes the file. The returned object is what every extractor reads from:

```ts
interface BlendFileData {
  header: BlendHeader // version, pointer size, endianness, large-format flag
  sdna: SDNA // names, types, sizes, struct layouts
  blocks: BlendBlock[] // every block in file order, last entry is ENDB
  reader: StructReader // low-level cursor with pointer-resolution helpers
}
```

Errors thrown:

- `Not a .blend file: unrecognised magic bytes` — input does not start with `BLENDER`, zstd, or gzip magic.
- `gzip-compressed .blend files are not supported in this runtime` — legacy gzip-compressed file in a runtime without `Bun.gunzipSync`. Re-save the file in Blender 3+ (zstd) or decompress upfront.
- `No DNA1 block found in .blend file` — file is truncated or corrupt.

### `extractMeshes(blend): Mesh[]`

Returns one entry per `ME` datablock. Geometry comes from the new `AttributeStorage` (Blender 5) — positions, corner→vertex/edge indices, material indices, UV maps, vertex colour layers. Face data is presented in offset form (matching Blender's internal layout) and additionally triangulated for direct GPU upload.

```ts
interface Mesh {
  name: string
  vertexCount: number
  edgeCount: number
  faceCount: number
  cornerCount: number
  vertices: Float32Array // length = vertexCount * 3
  vertexNormals: Float32Array // recomputed from face winding
  faceNormals: Float32Array // length = faceCount * 3
  faceOffsets: Uint32Array // length = faceCount + 1; loops for face i live in [offsets[i], offsets[i+1])
  cornerVertices: Uint32Array // per-corner vertex index
  cornerEdges?: Uint32Array // per-corner edge index, when stored
  materialIndices: Uint32Array // length = faceCount; index into materialSlotNames
  materialSlotNames: string[]
  triangles: Uint32Array // triangulated face indices (fan from corner 0)
  uvMaps: Record<string, Float32Array> // CD_PROP_FLOAT2 on CORNER domain
  vertexColors: Record<string, Float32Array> // CD_PROP_COLOR (float4)
  vertexByteColors: Record<string, Uint8Array> // CD_PROP_BYTE_COLOR (uchar4)
  vertexGroupNames: string[]
  dvert?: DeformVertex[] // per-vertex weights, when the mesh has any
  attributes: Record<string, MeshAttributeRaw> // every attribute, including ones not surfaced above
}

interface DeformVertex {
  totalWeight: number
  weights: { groupIndex: number; weight: number }[]
}
```

Every returned datablock also carries a `customProperties: Record<string, IDPropertyValue>` field — see [Custom properties](#custom-properties-idproperty) below.

### `extractMaterials(blend): Material[]`

```ts
interface Material {
  name: string
  diffuse: [r, g, b, a] // float, linear
  specular: [r, g, b]
  metallic: number
  roughness: number
  hasNodeTree: boolean
  shader?: ShaderGraph // present when nodes are used
  customProperties: Record<string, IDPropertyValue>
}

interface ShaderGraph {
  nodes: ShaderNode[]
  principled?: PrincipledBSDF // distilled, when the graph has one
}

interface PrincipledBSDF {
  nodeName: string
  baseColor: [r, g, b, a]
  metallic: number
  roughness: number
  ior: number
  alpha: number
  emissionColor: [r, g, b, a]
  emissionStrength: number
  baseColorImage?: string // name of an image bound via a Tex Image node
  normalImage?: string
  roughnessImage?: string
  metallicImage?: string
}
```

The full node graph is exposed in `shader.nodes` — each node lists its `idname` (`ShaderNodeBsdfPrincipled`, `ShaderNodeTexImage`, …), its inputs with their default-value sockets, and any incoming links. Anything beyond Principled BSDF you can pull yourself from there.

### `extractLights(blend): Light[]`

```ts
interface Light {
  name: string
  type: 'point' | 'sun' | 'spot' | 'area'
  color: [r, g, b]
  energy: number
  radius: number
  spotSize?: number // spot only
  spotBlend?: number
  sunAngle?: number // sun only
  areaShape?: 'square' | 'rectangle' | 'disk' | 'ellipse'
  areaSize?: [x] | [x, y]
  useNodes: boolean
  customProperties: Record<string, IDPropertyValue>
}
```

### `extractCameras(blend): Camera[]`

```ts
interface Camera {
  name: string
  type: 'perspective' | 'orthographic' | 'panoramic'
  lens: number // mm
  sensorWidth: number
  sensorHeight: number
  sensorFit: 'auto' | 'horizontal' | 'vertical'
  orthoScale: number
  clipStart: number
  clipEnd: number
  shiftX: number
  shiftY: number
  customProperties: Record<string, IDPropertyValue>
}
```

### `extractImages(blend): Image[]`

```ts
interface Image {
  name: string
  filepath: string // e.g. "//tex.png" (relative) or an absolute path
  source: 'file' | 'sequence' | 'movie' | 'generated' | 'viewer' | 'tiled'
  generatedWidth: number
  generatedHeight: number
  packed?: Uint8Array // raw bytes of the embedded file, when packed
  customProperties: Record<string, IDPropertyValue>
}
```

### `extractScenes(blend): Scene[]` and `extractCollections(blend): Collection[]`

```ts
interface Scene {
  name: string
  cameraObject?: string // active camera object name
  frameStart: number
  frameEnd: number
  frameCurrent: number
  fps: number // frs_sec / frs_sec_base
  resolutionX: number
  resolutionY: number
  resolutionPercentage: number
  rootCollection?: Collection
  customProperties: Record<string, IDPropertyValue>
}

interface Collection {
  name: string
  objectNames: string[] // objects directly inside this collection
  children: Collection[] // recursive
  customProperties: Record<string, IDPropertyValue>
}
```

`extractScenes` returns scenes with their full collection hierarchy. `extractCollections` returns every standalone `GR` datablock at the top level, also walkable.

### `extractObjects(blend): SceneObject[]`

Every `OB` datablock — cameras, lamps, meshes, armatures, etc.

```ts
interface SceneObject {
  name: string
  type: number // see OB_TYPE
  location: [x, y, z]
  rotation: [x, y, z] // Euler XYZ, radians
  scale: [x, y, z]
  worldMatrix: Float32Array // float[16], row-major
  dataName?: string // name of the linked ID datablock (e.g. the mesh)
  parentName?: string
  customProperties: Record<string, IDPropertyValue>
}

import { OB_TYPE } from 'jsblender'
// OB_TYPE.EMPTY = 0, MESH = 1, CURVE = 2, SURF = 3, FONT = 4, MBALL = 5,
// LAMP = 10, CAMERA = 11, SPEAKER = 12, LIGHTPROBE = 13,
// LATTICE = 22, ARMATURE = 25, GPENCIL = 26
```

### `extractArmatures(blend): Armature[]`

```ts
interface Armature {
  name: string
  bones: Bone[] // top-level (root) bones
  customProperties: Record<string, IDPropertyValue>
}

interface Bone {
  name: string
  head: [x, y, z] // armature-space
  tail: [x, y, z] // armature-space
  roll: number // radians
  length: number
  armatureMatrix: Float32Array // 4x4 rest pose, row-major
  children: Bone[]
}
```

## Modifiers (`evaluateMesh`)

`extractMeshes` returns each `ME` datablock **as stored** — no Subdiv, Mirror, Array, etc. evaluation. For renderers that need the visible geometry, jsblender ships a small modifier evaluator that supports **Mirror** and **Array** (the two cheapest geometry-generating modifiers).

```ts
import { evaluateMesh, evaluateAllMeshes, extractObjectModifiers } from 'jsblender'

const obj = extractObjects(blend).find(o => o.name === 'megaxe')!
const mesh = evaluateMesh(blend, obj) // Mesh with Mirror / Array applied

// Or batch:
const byObject = evaluateAllMeshes(blend) // Map<objectName, Mesh>

// Inspect a stack without evaluating:
const mods = extractObjectModifiers(blend).get('megaxe')
// [{ type: 'mirror', axisX: true, merge: true, tolerance: 0.001, ... },
//  { type: 'array',  count: 4,    useRelativeOffset: true, ... }]
```

**Supported modifiers:**

| Modifier   | What jsblender does                                                                                                                                                                              | Skipped                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| **Mirror** | Per-axis vertex duplication with reversed face winding. Spatial weld merges mirrored positions onto existing vertices within `tolerance` (handles seams-on-plane and stacked redundant mirrors). | `mirror_ob` frame, `MOD_MIR_BISECT_*`, UV swapping, vertex-group swap.               |
| **Array**  | Fixed-count duplication with combined `constantOffset` + `relativeOffset × bbox`.                                                                                                                | `FIT_LENGTH` / `FIT_CURVE`, `useObjectOffset`, merge-between-copies, start/end caps. |

Other modifier types are returned as `{ type: 'unknown', typeCode }` and pass the mesh through unchanged.

## Custom properties (IDProperty)

Every datablock returned by an `extract*` function carries a
`customProperties: Record<string, IDPropertyValue>` field — Blender's user-defined
metadata, decoded into plain JS values.

```ts
type IDPropertyValue =
  | string
  | number
  | boolean
  | number[] // INT / FLOAT / DOUBLE array
  | boolean[] // BOOLEAN array
  | { [key: string]: IDPropertyValue } // GROUP (nested object)
  | { __idRef: string | null } // ID reference (datablock by name)
  | IDPropertyValue[] // IDPARRAY
```

`extract*` functions surface only the user's `ID.properties` group; Blender's
internal `system_properties` are ignored.

```ts
const cube = extractMeshes(blend).find(m => m.name === 'Cube')
cube?.customProperties
// {
//   myFloat: 1,
//   myInteger: 1,
//   myBoolean: true,
//   myString: 'abc',
//   myFloatArray: [1, 1, 1],
//   myDataBlock: { __idRef: null },
// }
```

## Low-level access

If the typed extractors above don't cover what you need, drop down to the SDNA-driven reader. Every struct Blender exports is queryable by name, every field by name:

```ts
const { reader, sdna } = blend

const meshLayout = reader.layoutOf('Mesh') // SDNAStructLayout
const totvert = reader.fieldOf(meshLayout, 'totvert')

for (const block of blend.blocks) {
  if (block.code !== 'ME') continue
  const count = reader.readInt32(block.dataOffset + totvert.offset)
  console.log('mesh has', count, 'vertices')
}
```

Pointer fields point at other blocks. `reader.blockAt(ptr, anchor?)` resolves them, using `anchor` (the dereferencing block's `dataOffset`) as a tie-breaker when Blender reuses `oldPtr` values across writes:

```ts
const fMat = reader.fieldOf(meshLayout, 'mat')
const matsPtr = reader.readPointer(meshBlock.dataOffset + fMat.offset)
const matsBlock = reader.blockAt(matsPtr, meshBlock.dataOffset)
```

The full SDNA is exposed too:

```ts
sdna.types // string[]    every type name in the file
sdna.typeSizes // number[]    byte size of each type
sdna.names // string[]    every field name (raw form, e.g. "*next", "head[3]")
sdna.parsedNames // ParsedFieldName[]  same names decomposed
sdna.structs // SDNAStruct[] type-index + fields
sdna.layouts // SDNAStructLayout[] precomputed offsets and sizes
sdna.structIndexByType // Map<string, number>
```

For the modern attribute-storage layout there are additional helpers:

```ts
import { ATTR_TYPE, ATTR_DOMAIN, readAttributeStorage, readAttributeAsFloats } from 'jsblender'

const mesh = reader.layoutOf('Mesh')
const fStorage = reader.fieldOf(mesh, 'attribute_storage')
const attrs = readAttributeStorage(reader, meshBlock.dataOffset, fStorage)
const pos = attrs.find(a => a.name === 'position' && a.dataType === ATTR_TYPE.FLOAT3)
const positions = pos ? readAttributeAsFloats(reader, pos) : undefined
```

## Runtime support

- **Node 18+** — works directly with the published ESM build. Verified on Node 25.
- **Bun** — primary development target. The test suite runs under `bun test`.
- **Browsers** — see `example/` in this repo for a Next.js drop-zone that parses files entirely client-side.

The library makes no `node:*` imports, so bundlers (Vite, esbuild, Webpack, Next, etc.) target browsers without polyfills.

## Caveats

- Only Blender 5+ files have been validated. Legacy 12-byte headers are recognised, but the per-mesh layout assumes the modern `AttributeStorage` pipeline; pre-3.0 files are out of scope.
- Big-endian and 32-bit pointer code paths exist in the block walker but have no real-world test coverage.
- Vertex normals are recomputed from face winding because Blender no longer writes them by default. For custom split normals, read the `corner_normal` attribute via `mesh.attributes`.
- Shader node trees, modifiers, animations, and the bGPencil format are not parsed.

## Development

This is a Bun monorepo with two workspaces:

```
library/   the jsblender package
example/   Next.js drop-zone demo
```

```sh
bun install
bun run --filter library build   # tsup -> library/dist
bun run --filter library test    # bun test against simple.blend
bun run --filter example dev     # Next.js dev server on portless

bun run all                      # format:check + lint + typecheck + warden + test
```
