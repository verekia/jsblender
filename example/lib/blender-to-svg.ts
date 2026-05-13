/**
 * Port of `blender-to-svg/blender_to_svg.py` onto the jsblender API.
 *
 * Renders the active scene of a .blend file to a single SVG string by:
 *  - projecting each mesh's world-space vertices through the active camera,
 *  - back-face culling and dropping coincident faces,
 *  - keeping interior edges only when their dihedral angle exceeds a threshold,
 *  - shading each face with Blender-like sun + ambient (or flat colour),
 *  - z-sorting meshes and faces back-to-front.
 *
 * Limitations vs. the Python original:
 *  - Modifiers are NOT evaluated. jsblender exposes the mesh as-stored;
 *    Subsurf / Mirror / Array / etc. won't show.
 *  - Viewport "solid lights" (Blender preferences) aren't accessible from a
 *    .blend file; when no sun light is present we fall back to a single
 *    default key light along +Z+ camera-forward.
 *  - Per-vertex normals are recomputed from face winding by jsblender, so
 *    custom split normals are ignored.
 */

import {
  evaluateMesh,
  extractCameras,
  extractLights,
  extractMaterials,
  extractMeshes,
  extractObjects,
  extractScenes,
  mat3Invert,
  mat3Transpose,
  mat3TransformDirection,
  mat4Invert,
  mat4ToMat3,
  mat4TransformDirection,
  mat4TransformPoint,
  OB_TYPE,
} from 'jsblender'
import type { BlendFileData, Camera, Light, Material, SceneObject, Vec3 } from 'jsblender'

export interface RenderOptions {
  /** Outline stroke width in SVG user units. Default 1. */
  strokeWidth?: number
  /** Minimum dihedral angle in radians for an interior edge to be drawn. */
  creaseAngle?: number
  /** "lambert" = sun + ambient. "flat" = raw base colour per face. */
  shading?: 'lambert' | 'flat'
  /** Drop every outline (still emits a same-colour seam stroke to mask AA gaps). */
  noOutlines?: boolean
}

const DEFAULTS: Required<RenderOptions> = {
  strokeWidth: 1,
  creaseAngle: 0,
  shading: 'lambert',
  noOutlines: false,
}

const DEFAULT_BASE: [number, number, number] = [0.8, 0.8, 0.8]
const AMBIENT = 0.05

// ── Vector helpers ────────────────────────────────────────────────────────────
const v3dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const v3len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2])
const v3norm = (a: Vec3): Vec3 => {
  const l = v3len(a)
  return l === 0 ? [0, 0, 0] : [a[0] / l, a[1] / l, a[2] / l]
}

// ── sRGB encode ───────────────────────────────────────────────────────────────
const linearToSrgbByte = (x: number): number => {
  const v = Math.max(0, Math.min(1, x))
  const s = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055
  return Math.round(s * 255)
}
const rgbToHex = (rgb: [number, number, number]): string => {
  const [r, g, b] = rgb.map(linearToSrgbByte) as [number, number, number]
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

// ── Material colour lookup (Principled BSDF, then Emission, then diffuse) ─────
const materialBaseColor = (material: Material | undefined): [number, number, number] => {
  if (!material) return DEFAULT_BASE
  const p = material.shader?.principled
  if (p) return [p.baseColor[0], p.baseColor[1], p.baseColor[2]]
  // Walk the node graph looking for an Emission node.
  const emission = material.shader?.nodes.find(n => n.idname === 'ShaderNodeEmission')
  if (emission) {
    const color = emission.inputs.find(i => i.name === 'Color')
    if (Array.isArray(color?.defaultValue))
      return [color.defaultValue[0] ?? 0, color.defaultValue[1] ?? 0, color.defaultValue[2] ?? 0]
  }
  return [material.diffuse[0], material.diffuse[1], material.diffuse[2]]
}

// ── Lights ────────────────────────────────────────────────────────────────────
interface DirectionalLight {
  direction: Vec3 // unit vector from surface toward the light
  color: Vec3
}

const collectSunLights = (lights: Light[], objects: SceneObject[]): DirectionalLight[] => {
  const byName = new Map(objects.map(o => [o.dataName, o] as const))
  const out: DirectionalLight[] = []
  for (const l of lights) {
    if (l.type !== 'sun') continue
    const obj = byName.get(l.name)
    if (!obj) continue
    // Sun shines along local -Z, so the direction *toward* the sun is its world +Z axis.
    const dir = v3norm(mat4TransformDirection(obj.worldMatrix, [0, 0, 1]))
    out.push({ direction: dir, color: [l.color[0] * l.energy, l.color[1] * l.energy, l.color[2] * l.energy] })
  }
  return out
}

const defaultViewportLights = (camera: SceneObject): DirectionalLight[] => {
  const dir = v3norm(mat4TransformDirection(camera.worldMatrix, [0.3, 0.3, 1.0]))
  return [{ direction: dir, color: [1, 1, 1] }]
}

const shadeLambert = (
  normal: Vec3,
  base: [number, number, number],
  lights: DirectionalLight[],
): [number, number, number] => {
  let r = AMBIENT * base[0]
  let g = AMBIENT * base[1]
  let b = AMBIENT * base[2]
  for (const l of lights) {
    const nd = v3dot(normal, l.direction)
    if (nd <= 0) continue
    r += base[0] * l.color[0] * nd
    g += base[1] * l.color[1] * nd
    b += base[2] * l.color[2] * nd
  }
  return [Math.min(r, 1), Math.min(g, 1), Math.min(b, 1)]
}

// ── Camera projection (replacement for bpy_extras.world_to_camera_view) ───────
interface Projector {
  projectWorld(p: Vec3): { x: number; y: number; z: number }
}

const buildProjector = (cameraObj: SceneObject, cameraData: Camera, width: number, height: number): Projector => {
  const invWorld = mat4Invert(cameraObj.worldMatrix)
  const imageAspect = width / height
  const sensorAspect = cameraData.sensorWidth / cameraData.sensorHeight
  const fitHorizontal =
    cameraData.sensorFit === 'horizontal' || (cameraData.sensorFit === 'auto' && imageAspect >= sensorAspect)

  if (cameraData.type === 'orthographic') {
    const orthoW = fitHorizontal ? cameraData.orthoScale : cameraData.orthoScale * imageAspect
    const orthoH = fitHorizontal ? cameraData.orthoScale / imageAspect : cameraData.orthoScale
    return {
      projectWorld(p) {
        const v = mat4TransformPoint(invWorld, p)
        // Camera looks down -Z. NDC: (x/W + 0.5, y/H + 0.5)
        return { x: v[0] / orthoW + 0.5, y: v[1] / orthoH + 0.5, z: -v[2] }
      },
    }
  }

  // Perspective. Half-extents of the view frustum at z=-1 (camera looks down -Z).
  const halfX = fitHorizontal
    ? cameraData.sensorWidth / 2 / cameraData.lens
    : (cameraData.sensorHeight / 2 / cameraData.lens) * imageAspect
  const halfY = fitHorizontal
    ? cameraData.sensorWidth / 2 / cameraData.lens / imageAspect
    : cameraData.sensorHeight / 2 / cameraData.lens

  return {
    projectWorld(p) {
      const v = mat4TransformPoint(invWorld, p)
      const z = -v[2]
      if (z <= 0) return { x: 0, y: 0, z }
      return {
        x: v[0] / z / (2 * halfX) + 0.5,
        y: v[1] / z / (2 * halfY) + 0.5,
        z,
      }
    },
  }
}

// ── Polygon merging (flat-mode shape consolidation) ───────────────────────────
type Pt = [number, number]

const ptEq = (a: Pt, b: Pt, tol: number): boolean => Math.abs(a[0] - b[0]) < tol && Math.abs(a[1] - b[1]) < tol

const tryMergePolys = (p1: Pt[], p2: Pt[], tol: number): Pt[] | null => {
  const n1 = p1.length
  const n2 = p2.length
  for (let a = 0; a < n1; a++) {
    const a2 = (a + 1) % n1
    for (let c = 0; c < n2; c++) {
      const c2 = (c + 1) % n2
      if (!(ptEq(p1[a]!, p2[c2]!, tol) && ptEq(p1[a2]!, p2[c]!, tol))) continue
      let s1Start = a
      let s1End = a2
      let s2Start = c
      let s2End = c2
      // Extend forward in p1, backward in p2.
      for (;;) {
        const nextA = (s1End + 1) % n1
        const prevC = (s2Start - 1 + n2) % n2
        if (nextA === s1Start || prevC === s2End) break
        if (!ptEq(p1[nextA]!, p2[prevC]!, tol)) break
        s1End = nextA
        s2Start = prevC
      }
      // Extend backward in p1, forward in p2.
      for (;;) {
        const prevA = (s1Start - 1 + n1) % n1
        const nextC = (s2End + 1) % n2
        if (prevA === s1End || nextC === s2Start) break
        if (!ptEq(p1[prevA]!, p2[nextC]!, tol)) break
        s1Start = prevA
        s2End = nextC
      }
      const merged: Pt[] = []
      let idx = (s1End + 1) % n1
      for (;;) {
        merged.push(p1[idx]!)
        if (idx === s1Start) break
        idx = (idx + 1) % n1
      }
      idx = (s2End + 1) % n2
      for (;;) {
        merged.push(p2[idx]!)
        if (idx === s2Start) break
        idx = (idx + 1) % n2
      }
      return merged
    }
  }
  return null
}

const polygonUnion2d = (polys: Pt[][], tol: number): Pt[][] => {
  const result: (Pt[] | null)[] = polys.map(p => [...p])
  let changed = true
  while (changed) {
    changed = false
    outer: for (let i = 0; i < result.length; i++) {
      if (result[i] === null) continue
      for (let j = i + 1; j < result.length; j++) {
        if (result[j] === null) continue
        const merged = tryMergePolys(result[i]!, result[j]!, tol)
        if (merged) {
          result[i] = merged
          result[j] = null
          changed = true
          break outer
        }
      }
    }
  }
  return result.filter((p): p is Pt[] => p !== null)
}

/**
 * Removes "spike" sub-paths from a polygon perimeter: any time the path visits
 * A → B → A (or A → B → C → B → A, etc.) the back-tracking segment encloses no
 * area and we collapse it. This shows up in flat-mode unions whenever a face
 * shares two non-adjacent edge runs with its neighbours — the greedy union can
 * only merge one run at a time and leaves the other as a back-tracking spike.
 */
const removeSpikes = (points: Pt[], tol = 0.01): Pt[] => {
  if (points.length < 3) return [...points]
  const result = [...points]
  let changed = true
  while (changed && result.length >= 3) {
    changed = false
    // Pass 1: collapse consecutive duplicates. Polygon-union output frequently
    // includes A → A → … runs at the boundary between merged-and-not-merged
    // edges; without this pass the A→B→A spike detector misses spikes that
    // have a duplicate point at the apex.
    for (let i = 0; i < result.length && result.length >= 2; ) {
      const a = result[i]!
      const b = result[(i + 1) % result.length]!
      if (ptEq(a, b, tol)) {
        result.splice((i + 1) % result.length, 1)
        if (i >= result.length) i = 0
        changed = true
      } else {
        i++
      }
    }
    // Pass 2: A → B → A spikes — the middle vertex encloses no area; drop it
    // and the duplicate of A.
    for (let i = 0; i < result.length && result.length >= 3; ) {
      const a = result[i]!
      const c = result[(i + 2) % result.length]!
      if (ptEq(a, c, tol)) {
        const bIdx = (i + 1) % result.length
        const cIdx = (i + 2) % result.length
        const toRemove = [bIdx, cIdx].sort((x, y) => y - x)
        for (const r of toRemove) result.splice(r, 1)
        if (i >= result.length) i = 0
        changed = true
      } else {
        i++
      }
    }
  }
  return result
}

const removeCollinearPoints = (points: Pt[], tol = 0.05): Pt[] => {
  if (points.length < 3) return [...points]
  const result: Pt[] = [...points]
  let changed = true
  while (changed && result.length >= 3) {
    changed = false
    let i = 0
    while (i < result.length && result.length >= 3) {
      const a = result[(i - 1 + result.length) % result.length]!
      const p = result[i]!
      const b = result[(i + 1) % result.length]!
      const abx = b[0] - a[0]
      const aby = b[1] - a[1]
      const abLen = Math.hypot(abx, aby)
      if (abLen < tol) {
        if (Math.hypot(p[0] - a[0], p[1] - a[1]) < tol) {
          result.splice(i, 1)
          changed = true
          continue
        }
      } else {
        const cross = abx * (p[1] - a[1]) - aby * (p[0] - a[0])
        if (Math.abs(cross) / abLen < tol) {
          result.splice(i, 1)
          changed = true
          continue
        }
      }
      i++
    }
  }
  return result
}

// ── Flat-mode edge classification ────────────────────────────────────────────
type EdgeEntry = { polyIndex: number; meshEdgeIndex: number; matIndex: number; pa: Pt; pb: Pt }

const classifyFlatEdges = (entries: EdgeEntry[], decimals = 1): { interior: Set<string>; cancelled: Set<string> } => {
  const map = new Map<string, EdgeEntry[]>()
  const f = (n: number): number => Math.round(n * 10 ** decimals) / 10 ** decimals
  for (const e of entries) {
    const ka = `${f(e.pa[0])},${f(e.pa[1])}`
    const kb = `${f(e.pb[0])},${f(e.pb[1])}`
    if (ka === kb) continue
    // Order-independent point-pair key (frozenset equivalent).
    const pair = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`
    const k1 = `${e.matIndex}|${pair}`
    const bucket = map.get(k1)
    if (bucket) bucket.push(e)
    else map.set(k1, [e])
  }
  const interior = new Set<string>()
  const cancelled = new Set<string>()
  for (const bucket of map.values()) {
    if (bucket.length < 2) continue
    const sameEdge = new Set(bucket.map(b => b.meshEdgeIndex))
    const target = sameEdge.size === 1 ? interior : cancelled
    for (const b of bucket) target.add(`${b.polyIndex}|${b.meshEdgeIndex}`)
  }
  return { interior, cancelled }
}

// ── Main renderer ────────────────────────────────────────────────────────────
interface ShapeOut {
  depth: number
  points: Pt[]
  fill: string
  allEdgesKept: boolean
}

export const renderBlendToSvg = (blend: BlendFileData, opts: RenderOptions = {}): string => {
  const options = { ...DEFAULTS, ...opts }
  const scenes = extractScenes(blend)
  const scene = scenes[0]
  if (!scene) throw new Error('No scene found in .blend')

  const objects = extractObjects(blend)
  const cameras = extractCameras(blend)
  const lights = extractLights(blend)
  const meshes = extractMeshes(blend)
  const materials = extractMaterials(blend)
  const materialByName = new Map(materials.map(m => [m.name, m] as const))

  const cameraObj = objects.find(o => o.name === scene.cameraObject) ?? objects.find(o => o.type === OB_TYPE.CAMERA)
  if (!cameraObj) throw new Error('No camera in scene')
  const cameraData = cameras.find(c => c.name === cameraObj.dataName)
  if (!cameraData) throw new Error(`No Camera datablock matching ${cameraObj.dataName}`)

  const width = Math.round((scene.resolutionX * scene.resolutionPercentage) / 100)
  const height = Math.round((scene.resolutionY * scene.resolutionPercentage) / 100)

  const projector = buildProjector(cameraObj, cameraData, width, height)
  const camLoc: Vec3 = [cameraObj.worldMatrix[12] ?? 0, cameraObj.worldMatrix[13] ?? 0, cameraObj.worldMatrix[14] ?? 0]
  const directionalLights: DirectionalLight[] =
    options.shading === 'lambert'
      ? (() => {
          const suns = collectSunLights(lights, objects)
          return suns.length > 0 ? suns : defaultViewportLights(cameraObj)
        })()
      : []

  type MeshGroup = { meshDepth: number; polys: ShapeOut[]; edges: [Pt, Pt][] }
  const meshGroups: MeshGroup[] = []

  for (const obj of objects) {
    if (obj.type !== OB_TYPE.MESH) continue
    if (!obj.dataName) continue
    // Evaluated mesh applies Mirror / Array modifiers in stack order; falls
    // back to the base mesh when no supported modifiers are present.
    const mesh = evaluateMesh(blend, obj, meshes)
    if (!mesh) continue

    const worldMatrix = obj.worldMatrix
    const normalMatrix = mat3Transpose(mat3Invert(mat4ToMat3(worldMatrix)))

    // ── Per-vertex projection ─────────────────────────────────────────────
    const vCount = mesh.vertexCount
    const screen = new Float64Array(vCount * 3)
    const worldVerts = new Float64Array(vCount * 3)
    for (let i = 0; i < vCount; i++) {
      const wx = mat4TransformPoint(worldMatrix, [
        mesh.vertices[i * 3] ?? 0,
        mesh.vertices[i * 3 + 1] ?? 0,
        mesh.vertices[i * 3 + 2] ?? 0,
      ])
      worldVerts[i * 3] = wx[0]
      worldVerts[i * 3 + 1] = wx[1]
      worldVerts[i * 3 + 2] = wx[2]
      const ndc = projector.projectWorld(wx)
      screen[i * 3] = ndc.x * width
      screen[i * 3 + 1] = (1 - ndc.y) * height
      screen[i * 3 + 2] = ndc.z
    }

    // ── Per-face normals (world) + front-face test ─────────────────────────
    const fCount = mesh.faceCount
    const polyNormalWorld: Vec3[] = Array.from({ length: fCount }, () => [0, 0, 1] as Vec3)
    const polyIsFront = new Uint8Array(fCount)
    for (let f = 0; f < fCount; f++) {
      const start = mesh.faceOffsets[f] ?? 0
      const end = mesh.faceOffsets[f + 1] ?? start
      if (end - start < 3) {
        polyNormalWorld[f] = [0, 0, 1]
        continue
      }
      const localNormal: Vec3 = [
        mesh.faceNormals[f * 3] ?? 0,
        mesh.faceNormals[f * 3 + 1] ?? 0,
        mesh.faceNormals[f * 3 + 2] ?? 0,
      ]
      const nw = v3norm(mat3TransformDirection(normalMatrix, localNormal))
      polyNormalWorld[f] = nw
      // Face center (world) for back-face test.
      let cx = 0,
        cy = 0,
        cz = 0
      let n = 0
      for (let k = start; k < end; k++) {
        const v = mesh.cornerVertices[k] ?? 0
        cx += worldVerts[v * 3] ?? 0
        cy += worldVerts[v * 3 + 1] ?? 0
        cz += worldVerts[v * 3 + 2] ?? 0
        n++
      }
      cx /= n
      cy /= n
      cz /= n
      const viewDir = v3norm([cx - camLoc[0], cy - camLoc[1], cz - camLoc[2]])
      polyIsFront[f] = v3dot(nw, viewDir) <= 0 ? 1 : 0
    }

    // ── Visibility + coincident-face dedup ─────────────────────────────────
    const polyVisible = new Uint8Array(fCount)
    const polyDepth = new Float64Array(fCount)
    const seen = new Map<string, { depth: number; idx: number }>()
    for (let f = 0; f < fCount; f++) {
      if (!polyIsFront[f]) continue
      const start = mesh.faceOffsets[f] ?? 0
      const end = mesh.faceOffsets[f + 1] ?? start
      let anyBehind = false
      let depthSum = 0
      for (let k = start; k < end; k++) {
        const v = mesh.cornerVertices[k] ?? 0
        if ((screen[v * 3 + 2] ?? 0) <= 0) {
          anyBehind = true
          break
        }
        depthSum += screen[v * 3 + 2] ?? 0
      }
      if (anyBehind || end === start) continue
      const pd = depthSum / (end - start)
      const keyParts: string[] = []
      for (let k = start; k < end; k++) {
        const v = mesh.cornerVertices[k] ?? 0
        keyParts.push(`${Math.round((screen[v * 3] ?? 0) * 10)},${Math.round((screen[v * 3 + 1] ?? 0) * 10)}`)
      }
      keyParts.sort()
      const key = keyParts.join('|')
      const existing = seen.get(key)
      if (existing) {
        if (pd < existing.depth) {
          polyVisible[existing.idx] = 0
          polyDepth[existing.idx] = 0
        } else continue
      }
      seen.set(key, { depth: pd, idx: f })
      polyVisible[f] = 1
      polyDepth[f] = pd
    }

    // ── Edge → faces, kept-edge decision ───────────────────────────────────
    const edgeToPolys = new Map<number, number[]>()
    for (let f = 0; f < fCount; f++) {
      const start = mesh.faceOffsets[f] ?? 0
      const end = mesh.faceOffsets[f + 1] ?? start
      for (let k = start; k < end; k++) {
        const ei = mesh.cornerEdges?.[k] ?? -1
        if (ei < 0) continue
        const list = edgeToPolys.get(ei)
        if (list) list.push(f)
        else edgeToPolys.set(ei, [f])
      }
    }

    const edgeKept = new Map<string, boolean>()
    for (let f = 0; f < fCount; f++) {
      if (!polyVisible[f]) continue
      const start = mesh.faceOffsets[f] ?? 0
      const end = mesh.faceOffsets[f + 1] ?? start
      const n1 = polyNormalWorld[f]!
      for (let k = start; k < end; k++) {
        const ei = mesh.cornerEdges?.[k] ?? -1
        const key = `${f}|${ei}`
        if (edgeKept.has(key) || ei < 0) {
          if (ei < 0) edgeKept.set(key, true)
          continue
        }
        const neighbours = (edgeToPolys.get(ei) ?? []).filter(n => n !== f)
        let draw = false
        if (neighbours.length === 0) draw = true
        else if (neighbours.some(n => !polyIsFront[n])) draw = true
        else
          for (const nb of neighbours) {
            const d = Math.max(-1, Math.min(1, v3dot(n1, polyNormalWorld[nb]!)))
            if (Math.acos(d) >= options.creaseAngle) {
              draw = true
              break
            }
          }
        edgeKept.set(key, draw)
      }
    }

    // ── Emit shapes ───────────────────────────────────────────────────────
    const polys: ShapeOut[] = []
    const edges: [Pt, Pt][] = []

    if (options.shading === 'flat') {
      // Build kept-edge entries for classification.
      const keptEntries: EdgeEntry[] = []
      for (let f = 0; f < fCount; f++) {
        if (!polyVisible[f]) continue
        const start = mesh.faceOffsets[f] ?? 0
        const end = mesh.faceOffsets[f + 1] ?? start
        for (let k = 0; k < end - start; k++) {
          const li = start + k
          const ei = mesh.cornerEdges?.[li] ?? -1
          if (!edgeKept.get(`${f}|${ei}`)) continue
          const va = mesh.cornerVertices[start + k] ?? 0
          const vb = mesh.cornerVertices[start + ((k + 1) % (end - start))] ?? 0
          keptEntries.push({
            polyIndex: f,
            meshEdgeIndex: ei,
            matIndex: mesh.materialIndices[f] ?? 0,
            pa: [screen[va * 3] ?? 0, screen[va * 3 + 1] ?? 0],
            pb: [screen[vb * 3] ?? 0, screen[vb * 3 + 1] ?? 0],
          })
        }
      }
      const { interior } = classifyFlatEdges(keptEntries)

      // Union-find groupings by material.
      const parent = new Int32Array(fCount).map((_, i) => i)
      const find = (x: number): number => {
        let r = x
        while (parent[r] !== r) r = parent[r] ?? r
        while (parent[x] !== r) {
          const next = parent[x] ?? x
          parent[x] = r
          x = next
        }
        return r
      }
      const unite = (a: number, b: number): void => {
        const ra = find(a)
        const rb = find(b)
        if (ra !== rb) parent[ra] = rb
      }

      for (let f = 0; f < fCount; f++) {
        if (!polyVisible[f]) continue
        const start = mesh.faceOffsets[f] ?? 0
        const end = mesh.faceOffsets[f + 1] ?? start
        const mi = mesh.materialIndices[f] ?? 0
        for (let k = start; k < end; k++) {
          const ei = mesh.cornerEdges?.[k] ?? -1
          if (ei < 0) continue
          for (const other of edgeToPolys.get(ei) ?? []) {
            if (other === f || !polyVisible[other]) continue
            if ((mesh.materialIndices[other] ?? 0) !== mi) continue
            unite(f, other)
          }
        }
      }
      const matFirst = new Map<number, number>()
      for (let f = 0; f < fCount; f++) {
        if (!polyVisible[f]) continue
        const mi = mesh.materialIndices[f] ?? 0
        const first = matFirst.get(mi)
        if (first === undefined) matFirst.set(mi, f)
        else unite(first, f)
      }
      const components = new Map<number, number[]>()
      for (let f = 0; f < fCount; f++) {
        if (!polyVisible[f]) continue
        const r = find(f)
        const list = components.get(r)
        if (list) list.push(f)
        else components.set(r, [f])
      }
      for (const polyIndices of components.values()) {
        const first = polyIndices[0]!
        const mi = mesh.materialIndices[first] ?? 0
        const mat = materialByName.get(mesh.materialSlotNames[mi] ?? '')
        const base = materialBaseColor(mat)
        const fill = rgbToHex(base)
        // Painter's sort uses the front-most face's depth so that a same-colour
        // component that pokes out toward the camera is drawn on top of an
        // unrelated component that sits behind it. Averaging over the entire
        // component instead would muddle the ordering between thin parts (a
        // stick) and fat ones (a head wrapping around it).
        let depth = Infinity
        for (const p of polyIndices) depth = Math.min(depth, polyDepth[p] ?? Infinity)
        const perimeters: Pt[][] = polyIndices.map(p => {
          const s = mesh.faceOffsets[p] ?? 0
          const e = mesh.faceOffsets[p + 1] ?? s
          const pts: Pt[] = []
          for (let k = s; k < e; k++) {
            const v = mesh.cornerVertices[k] ?? 0
            pts.push([screen[v * 3] ?? 0, screen[v * 3 + 1] ?? 0])
          }
          return pts
        })
        const tol = Math.max(width, height) / 4000
        const merged = polygonUnion2d(perimeters, tol)
        for (const region of merged) {
          if (region.length < 3) continue
          polys.push({ depth, points: region, fill, allEdgesKept: true })
        }
      }
      // Interior crease edges.
      const seenEi = new Set<number>()
      for (const e of keptEntries) {
        if (!interior.has(`${e.polyIndex}|${e.meshEdgeIndex}`)) continue
        if (seenEi.has(e.meshEdgeIndex)) continue
        seenEi.add(e.meshEdgeIndex)
        edges.push([e.pa, e.pb])
      }
    } else {
      for (let f = 0; f < fCount; f++) {
        if (!polyVisible[f]) continue
        const start = mesh.faceOffsets[f] ?? 0
        const end = mesh.faceOffsets[f + 1] ?? start
        const nLoops = end - start
        const points: Pt[] = []
        for (let k = start; k < end; k++) {
          const v = mesh.cornerVertices[k] ?? 0
          points.push([screen[v * 3] ?? 0, screen[v * 3 + 1] ?? 0])
        }
        const kept: [Pt, Pt][] = []
        for (let k = 0; k < nLoops; k++) {
          const ei = mesh.cornerEdges?.[start + k] ?? -1
          if (!edgeKept.get(`${f}|${ei}`)) continue
          kept.push([points[k]!, points[(k + 1) % nLoops]!])
        }
        const mi = mesh.materialIndices[f] ?? 0
        const mat = materialByName.get(mesh.materialSlotNames[mi] ?? '')
        const base = materialBaseColor(mat)
        const color = shadeLambert(polyNormalWorld[f]!, base, directionalLights)
        const fill = rgbToHex(color)
        const allKept = kept.length === nLoops
        polys.push({ depth: polyDepth[f] ?? 0, points, fill, allEdgesKept: allKept })
        if (!allKept) edges.push(...kept)
      }
    }

    if (polys.length > 0) {
      const meshDepth = polys.reduce((s, p) => s + p.depth, 0) / polys.length
      meshGroups.push({ meshDepth, polys, edges })
    }
  }

  meshGroups.sort((a, b) => b.meshDepth - a.meshDepth)

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`,
  ]
  const sw = String(options.strokeWidth)
  for (const group of meshGroups) {
    const sorted = [...group.polys].sort((a, b) => b.depth - a.depth)
    for (const poly of sorted) {
      const despiked = removeSpikes(poly.points)
      const cleaned = removeCollinearPoints(despiked)
      if (cleaned.length < 3) continue
      const pts = cleaned.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ')
      if (poly.allEdgesKept && !options.noOutlines) {
        parts.push(
          `<polygon points="${pts}" fill="${poly.fill}" stroke="#000000" stroke-width="${sw}" stroke-linejoin="round"/>`,
        )
      } else {
        parts.push(
          `<polygon points="${pts}" fill="${poly.fill}" stroke="${poly.fill}" stroke-width="0.6" stroke-linejoin="round"/>`,
        )
      }
    }
    if (!options.noOutlines) {
      for (const [a, b] of group.edges) {
        parts.push(
          `<line x1="${a[0].toFixed(2)}" y1="${a[1].toFixed(2)}" x2="${b[0].toFixed(2)}" y2="${b[1].toFixed(2)}" stroke="#000000" stroke-width="${sw}" stroke-linecap="round"/>`,
        )
      }
    }
  }
  parts.push('</svg>')
  return parts.join('\n')
}
