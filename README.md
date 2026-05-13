# jsblender

Modern, typesafe `.blend` file parser for Blender 5 and up.

The reference parser ([`acweathersby/js.blend`](https://github.com/acweathersby/js.blend)) was last updated in 2016 and predates Blender's `AttributeStorage` mesh format, zstd compression, and the 32-byte block headers introduced with Blender's large-file support. `jsblender` is a from-scratch reader that targets the **current** file format.

## Status

- Handles zstd-compressed and uncompressed `.blend` files.
- Parses the modern 17-byte file header and the 32-byte block headers used by Blender 5.
- Reconstructs the SDNA (Structure DNA) schema and exposes typed struct layouts.
- Resolves Blender 5's reused-pointer quirk (the writer hands several ID datablocks the same `oldPtr` for their temporary buffers — `jsblender` disambiguates by file position).

## Install

```sh
bun add jsblender
# or: npm install jsblender
```

## Usage

```ts
import { readFileSync } from 'node:fs'
import { parseBlend, extractMeshes, extractMaterials, extractObjects, extractArmatures } from 'jsblender'

const blend = parseBlend(readFileSync('scene.blend'))

console.log(blend.header)
// { version: 5.01, pointerSize: 8, endianness: 'little', largeFormat: true, ... }

for (const mesh of extractMeshes(blend)) {
  mesh.vertices // Float32Array, length = vertexCount * 3
  mesh.vertexNormals // Float32Array, per-vertex, normalised
  mesh.faceNormals // Float32Array, per-face
  mesh.faceOffsets // Uint32Array, length = faceCount + 1
  mesh.cornerVertices // Uint32Array, per-corner vertex index
  mesh.triangles // Uint32Array, triangulated face indices
  mesh.materialIndices // Uint32Array, per-face slot index
  mesh.materialSlotNames // string[]
  mesh.uvMaps // Record<string, Float32Array>
  mesh.vertexColors // Record<string, Float32Array>   (CD_PROP_COLOR)
  mesh.vertexByteColors // Record<string, Uint8Array>    (CD_PROP_BYTE_COLOR)
  mesh.vertexGroupNames // string[]
  mesh.dvert // DeformVertex[] | undefined  (per-vertex weights)
}

for (const mat of extractMaterials(blend)) {
  ;(mat.diffuse, mat.specular, mat.metallic, mat.roughness, mat.hasNodeTree)
}

for (const obj of extractObjects(blend)) {
  ;(obj.type, obj.location, obj.rotation, obj.scale, obj.worldMatrix, obj.dataName)
}

for (const arm of extractArmatures(blend)) {
  // arm.bones is a tree of { name, head, tail, roll, length, armatureMatrix, children }
}
```

The low-level pieces are also exposed so consumers can read any struct out of
the SDNA directly:

```ts
const { reader, sdna, blocks, header } = blend
const mesh = reader.layoutOf('Mesh') // SDNAStructLayout
const totvert = reader.fieldOf(mesh, 'totvert')
// reader.readInt32(meshBlock.dataOffset + totvert.offset) etc.
```

## Scripts

```sh
bun install
bun run build         # tsup -> dist/
bun run test
bun run all           # format:check + lint + typecheck + warden + test
```

## Caveats

- Only Blender 5+ files have been validated. Legacy compressed-file headers
  (12-byte) are recognised but the per-mesh layout assumes the modern
  `AttributeStorage` pipeline; pre-3.0 files are out of scope.
- Big-endian and 32-bit pointer files have code paths in the block walker but
  no real-world test coverage. PRs welcome.
- Vertex normals are recomputed from face winding (Blender no longer writes
  them by default). For custom split normals, read the `corner_normal`
  attribute via `mesh.attributes`.
