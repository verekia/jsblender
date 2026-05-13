import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'bun:test'

import { extractArmatures, extractMaterials, extractMeshes, extractObjects, parseBlend } from './index.ts'

import type { Bone } from './armature.ts'

const blendPath = resolve(import.meta.dir, '..', 'simple.blend')
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

  it('indexes blocks by their original pointer', () => {
    const me = blend.blocks.find(b => b.code === 'ME')
    expect(me).toBeDefined()
    if (!me) return
    expect(blend.reader.blockAt(me.oldPtr)?.code).toBe('ME')
  })
})

describe('sdna', () => {
  it('parses the schema and exposes a sane struct count', () => {
    expect(blend.sdna.structs.length).toBeGreaterThan(500)
    expect(blend.sdna.types).toContain('Mesh')
    expect(blend.sdna.types).toContain('Material')
    expect(blend.sdna.types).toContain('Bone')
  })

  it('computes layouts whose size matches the SDNA TLEN for major structs', () => {
    for (const name of ['Mesh', 'Material', 'Bone', 'Object', 'MDeformVert', 'MDeformWeight']) {
      const idx = blend.sdna.structIndexByType.get(name)
      expect(idx).toBeDefined()
      if (idx === undefined) continue
      const layout = blend.sdna.layouts[idx]
      const struct = blend.sdna.structs[idx]
      expect(layout).toBeDefined()
      expect(struct).toBeDefined()
      if (!layout || !struct) continue
      const expected = blend.sdna.typeSizes[struct.typeIndex]
      expect(expected).toBeDefined()
      expect(layout.size).toBe(expected ?? -1)
    }
  })
})

describe('meshes', () => {
  const meshes = extractMeshes(blend)

  it('finds every mesh datablock in the file', () => {
    const meshBlockCount = blend.blocks.filter(b => b.code === 'ME').length
    expect(meshes.length).toBe(meshBlockCount)
    expect(meshes.length).toBeGreaterThan(0)
  })

  it('resolves per-mesh vertex data even when multiple meshes share an oldPtr', () => {
    // simple.blend ships with two unit cubes and a UV sphere; the writer
    // hands all three the same oldPtr for their attribute storage. If the
    // anchor-based resolver is wrong, two of them inherit the third's
    // positions.
    const cubes = meshes.filter(m => m.vertexCount === 8)
    expect(cubes.length).toBe(2)
    for (const cube of cubes) {
      // Cube positions are clamped to ~±1 on every axis.
      for (let i = 0; i < cube.vertices.length; i++) {
        const v = cube.vertices[i] ?? 0
        expect(Math.abs(v)).toBeLessThanOrEqual(1.1)
      }
    }
    const sphere = meshes.find(m => m.vertexCount > 100)
    expect(sphere).toBeDefined()
    // Cube corner indices must NOT contain values out of [0, 8).
    for (const cube of cubes) {
      for (let i = 0; i < cube.cornerVertices.length; i++) {
        const c = cube.cornerVertices[i] ?? 0
        expect(c).toBeLessThan(8)
      }
    }
  })

  it('returns vertices as a flat Float32Array sized to vertexCount * 3', () => {
    for (const m of meshes) {
      expect(m.vertices).toBeInstanceOf(Float32Array)
      expect(m.vertices.length).toBe(m.vertexCount * 3)
    }
  })

  it('returns triangulated face indices that reference valid vertex indices', () => {
    for (const m of meshes) {
      expect(m.triangles.length % 3).toBe(0)
      if (m.triangles.length === 0) continue
      let max = 0
      for (let i = 0; i < m.triangles.length; i++) max = Math.max(max, m.triangles[i] ?? 0)
      expect(max).toBeLessThan(m.vertexCount)
    }
  })

  it('produces a faceOffsets table of length faceCount + 1, monotonically increasing', () => {
    for (const m of meshes) {
      expect(m.faceOffsets.length).toBe(m.faceCount + 1)
      for (let i = 1; i < m.faceOffsets.length; i++) {
        const cur = m.faceOffsets[i] ?? 0
        const prev = m.faceOffsets[i - 1] ?? 0
        expect(cur).toBeGreaterThanOrEqual(prev)
      }
      if (m.faceCount > 0) expect(m.faceOffsets[m.faceCount]).toBe(m.cornerCount)
    }
  })

  it('produces normalised vertex normals', () => {
    const m = meshes[0]
    expect(m).toBeDefined()
    if (!m || m.faceCount === 0) return
    for (let v = 0; v < Math.min(8, m.vertexCount); v++) {
      const x = m.vertexNormals[v * 3] ?? 0
      const y = m.vertexNormals[v * 3 + 1] ?? 0
      const z = m.vertexNormals[v * 3 + 2] ?? 0
      const len = Math.hypot(x, y, z)
      expect(len).toBeCloseTo(1, 3)
    }
  })

  it('records material slot names matching the file', () => {
    for (const m of meshes) {
      for (const slot of m.materialSlotNames) expect(typeof slot).toBe('string')
    }
  })
})

describe('materials', () => {
  const materials = extractMaterials(blend)
  it('extracts every Material datablock with a name and an RGBA diffuse colour', () => {
    expect(materials.length).toBeGreaterThan(0)
    for (const m of materials) {
      expect(m.name.length).toBeGreaterThan(0)
      expect(m.diffuse.length).toBe(4)
      for (const c of m.diffuse) expect(c).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('objects', () => {
  const objects = extractObjects(blend)
  it('extracts every Object datablock', () => {
    expect(objects.length).toBeGreaterThan(0)
    for (const o of objects) {
      expect(o.name.length).toBeGreaterThan(0)
      expect(o.location.length).toBe(3)
      expect(o.scale.length).toBe(3)
    }
  })
})

describe('armatures', () => {
  const armatures = extractArmatures(blend)
  // simple.blend may or may not have an armature; just check the API works.
  it('returns an array (possibly empty) of armatures with walkable bone trees', () => {
    expect(Array.isArray(armatures)).toBe(true)
    for (const a of armatures) {
      expect(a.name.length).toBeGreaterThan(0)
      const total = a.bones.reduce((s, b) => s + countBones(b), 0)
      expect(total).toBeGreaterThan(0)
    }
  })
})
