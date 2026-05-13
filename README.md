# jsblender

Modern, typesafe `.blend` file parser for Blender 5 and up. Works in Node, Bun, and the browser.

⚠️ Heavily vibe-coded against a single test file. The code is barely reviewed, will probably crash on edge-case `.blend` files, and the surface area exposed only covers what the author needed. Not recommended for anything important.

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
import { parseBlend, extractMeshes, extractMaterials, extractObjects, extractArmatures } from 'jsblender'

const blend = parseBlend(readFileSync('scene.blend'))

console.log(blend.header)
// { version: 5.01, pointerSize: 8, endianness: 'little', largeFormat: true, size: 17, versionString: '0501' }

for (const mesh of extractMeshes(blend)) {
  console.log(mesh.name, mesh.vertexCount, mesh.faceCount, mesh.triangles.length / 3)
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

### `extractMaterials(blend): Material[]`

```ts
interface Material {
  name: string
  diffuse: [r, g, b, a] // float, linear
  specular: [r, g, b]
  metallic: number
  roughness: number
  hasNodeTree: boolean // true when a shader graph is attached
}
```

The actual shader graph is not parsed (Blender's node tree is huge and unstable across versions).

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
