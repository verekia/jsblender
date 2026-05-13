import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  extractArmatures,
  extractCameras,
  extractCollections,
  extractImages,
  extractLights,
  extractMaterials,
  extractMeshes,
  extractObjects,
  extractScenes,
  parseBlend,
} from './index.ts'

import type { Bone } from './armature.ts'

const blendPath = resolve(import.meta.dir, '..', 'full.blend')
const blend = parseBlend(readFileSync(blendPath))

const countBones = (b: Bone): number => 1 + b.children.reduce((s, c) => s + countBones(c), 0)

describe('header', () => {
  it('reports a Blender 5 file using the new 17-byte large-format header', () => {
    expect(blend.header.version).toBeGreaterThanOrEqual(5)
    expect(blend.header.pointerSize).toBe(8)
    expect(blend.header.endianness).toBe('little')
    expect(blend.header.largeFormat).toBe(true)
    expect(blend.header.size).toBe(17)
  })
})

describe('blocks', () => {
  it('walks every block down to ENDB', () => {
    expect(blend.blocks.length).toBeGreaterThan(10)
    expect(blend.blocks.at(-1)?.code).toBe('ENDB')
    expect(blend.blocks.some(b => b.code === 'DNA1')).toBe(true)
    expect(blend.blocks.some(b => b.code === 'GLOB')).toBe(true)
    expect(blend.blocks.some(b => b.code === 'ME')).toBe(true)
  })
})

describe('sdna', () => {
  it('parses the schema and exposes a sane struct count', () => {
    expect(blend.sdna.structs.length).toBeGreaterThan(500)
    for (const name of ['Mesh', 'Material', 'Object', 'Lamp', 'Camera', 'Scene', 'Collection', 'IDProperty']) {
      expect(blend.sdna.structIndexByType.has(name)).toBe(true)
    }
  })

  it('computes layouts whose size matches the SDNA TLEN for major structs', () => {
    for (const name of ['Mesh', 'Material', 'Object', 'MDeformVert', 'IDProperty']) {
      const idx = blend.sdna.structIndexByType.get(name)
      if (idx === undefined) continue
      const layout = blend.sdna.layouts[idx]
      const struct = blend.sdna.structs[idx]
      if (!layout || !struct) continue
      expect(layout.size).toBe(blend.sdna.typeSizes[struct.typeIndex] ?? -1)
    }
  })
})

describe('meshes', () => {
  const meshes = extractMeshes(blend)
  it('finds every mesh datablock', () => {
    expect(meshes.length).toBe(blend.blocks.filter(b => b.code === 'ME').length)
  })
  it('returns vertices as a flat Float32Array sized to vertexCount * 3', () => {
    for (const m of meshes) {
      expect(m.vertices.length).toBe(m.vertexCount * 3)
    }
  })
  it('triangulates faces with indices in [0, vertexCount)', () => {
    for (const m of meshes) {
      expect(m.triangles.length % 3).toBe(0)
      for (let i = 0; i < m.triangles.length; i++) {
        expect(m.triangles[i] ?? 0).toBeLessThan(m.vertexCount)
      }
    }
  })
})

describe('materials', () => {
  const materials = extractMaterials(blend)
  it('extracts every Material datablock', () => {
    expect(materials.length).toBeGreaterThan(0)
  })
  it('exposes a parsed shader graph with a Principled BSDF when nodes are used', () => {
    const withShader = materials.find(m => m.shader?.principled)
    expect(withShader).toBeDefined()
    if (!withShader?.shader?.principled) return
    expect(withShader.shader.principled.baseColor.length).toBe(4)
    expect(typeof withShader.shader.principled.metallic).toBe('number')
    expect(typeof withShader.shader.principled.roughness).toBe('number')
    expect(withShader.shader.nodes.some(n => n.idname === 'ShaderNodeBsdfPrincipled')).toBe(true)
  })
})

describe('lights', () => {
  const lights = extractLights(blend)
  it('extracts every Lamp datablock and decodes the type enum', () => {
    expect(lights.length).toBe(blend.blocks.filter(b => b.code === 'LA').length)
    for (const l of lights) {
      expect(l.color.length).toBe(3)
      expect(['point', 'sun', 'spot', 'area', 'unknown']).toContain(l.type)
    }
  })

  it('full.blend contains both a Point and a Sun light', () => {
    const types = lights.map(l => l.type).toSorted()
    expect(types).toContain('point')
    expect(types).toContain('sun')
  })
})

describe('cameras', () => {
  const cameras = extractCameras(blend)
  it('decodes lens, sensor, clipping for every Camera datablock', () => {
    expect(cameras.length).toBe(blend.blocks.filter(b => b.code === 'CA').length)
    for (const c of cameras) {
      expect(c.type).toBe('perspective')
      expect(c.lens).toBeGreaterThan(0)
      expect(c.sensorWidth).toBeGreaterThan(0)
      expect(c.clipEnd).toBeGreaterThan(c.clipStart)
    }
  })
})

describe('images', () => {
  it('returns an array (possibly empty) of Image datablocks', () => {
    const images = extractImages(blend)
    expect(Array.isArray(images)).toBe(true)
    for (const img of images) {
      expect(typeof img.filepath).toBe('string')
      expect(['file', 'sequence', 'movie', 'generated', 'viewer', 'tiled', 'unknown']).toContain(img.source)
    }
  })
})

describe('scenes', () => {
  const scenes = extractScenes(blend)
  it('extracts the master scene with frame range, fps, resolution, and a root collection', () => {
    expect(scenes.length).toBe(1)
    const scene = scenes[0]
    if (!scene) return
    expect(scene.frameStart).toBeGreaterThan(0)
    expect(scene.frameEnd).toBeGreaterThanOrEqual(scene.frameStart)
    expect(scene.fps).toBeGreaterThan(0)
    expect(scene.resolutionX).toBeGreaterThan(0)
    expect(scene.resolutionY).toBeGreaterThan(0)
    expect(scene.rootCollection).toBeDefined()
  })

  it("includes the named child collection 'MyCollection' under the master collection", () => {
    const scene = scenes[0]
    const root = scene?.rootCollection
    expect(root?.children.some(c => c.name === 'MyCollection')).toBe(true)
  })
})

describe('collections', () => {
  it('returns every GR datablock with its objects', () => {
    const collections = extractCollections(blend)
    expect(collections.length).toBeGreaterThan(0)
    const seen = new Set<string>()
    const walk = (c: {
      name: string
      objectNames: string[]
      children: { name: string; objectNames: string[]; children: unknown[] }[]
    }) => {
      seen.add(c.name)
      for (const obj of c.objectNames) expect(typeof obj).toBe('string')
      for (const child of c.children) walk(child as Parameters<typeof walk>[0])
    }
    for (const c of collections) walk(c)
  })
})

describe('custom properties (IDProperty)', () => {
  it('decodes every primitive type from the Cube mesh in full.blend', () => {
    const meshes = extractMeshes(blend)
    const cube = meshes.find(m => m.name === 'Cube')
    expect(cube).toBeDefined()
    const props = cube?.customProperties
    expect(props).toBeDefined()
    if (!props) return

    expect(props.myFloat).toBeCloseTo(1, 5)
    expect(props.myInteger).toBe(1)
    expect(props.myBoolean).toBe(true)
    expect(props.myString).toBe('abc')
    expect(props.myFloatArray).toEqual([1, 1, 1])
    expect(props.myIntegerArray).toEqual([1, 1, 1])
    expect(props.myBooleanArray).toEqual([true, true, true])
    // myDataBlock is an unset ID reference.
    expect((props.myDataBlock as { __idRef: string | null }).__idRef).toBe(null)
  })

  it('returns {} for IDs without custom properties', () => {
    const objects = extractObjects(blend)
    const camera = objects.find(o => o.name === 'Camera')
    expect(camera).toBeDefined()
    expect(camera?.customProperties).toEqual({})
  })
})

describe('objects + armatures (smoke)', () => {
  it('still returns every Object', () => {
    expect(extractObjects(blend).length).toBe(blend.blocks.filter(b => b.code === 'OB').length)
  })
  it('still returns armatures (possibly none in full.blend)', () => {
    const arms = extractArmatures(blend)
    for (const a of arms) expect(a.bones.reduce((s, b) => s + countBones(b), 0)).toBeGreaterThan(0)
  })
})
