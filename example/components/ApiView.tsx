import { useMemo } from 'react'

import { extractArmatures, extractMaterials, extractMeshes, extractObjects, OB_TYPE } from 'jsblender'
import type { Bone } from 'jsblender'
import type { BlendFileData } from 'jsblender'

import Section from './Section'

const OB_TYPE_NAMES: Record<number, string> = Object.fromEntries(
  Object.entries(OB_TYPE).map(([k, v]) => [v, k.toLowerCase()]),
)

const fmtFloat = (n: number, places = 3): string => (Number.isFinite(n) ? n.toFixed(places) : 'NaN')

const previewArray = (arr: Float32Array | Uint32Array | undefined, count: number, places = 3): string => {
  if (!arr) return '—'
  const take = Math.min(arr.length, count)
  const parts: string[] = []
  for (let i = 0; i < take; i++) {
    const v = arr[i]
    if (v === undefined) continue
    parts.push(typeof v === 'number' && !Number.isInteger(v) ? fmtFloat(v, places) : String(v))
  }
  return parts.join(', ') + (arr.length > take ? ', …' : '')
}

const renderBoneTree = (bones: Bone[], depth = 0): React.ReactNode =>
  bones.map(b => (
    <div key={`${depth}-${b.name}`} className="font-mono">
      <div style={{ paddingLeft: depth * 12 }}>
        <span className="text-neutral-200">{b.name}</span>
        <span className="ml-2 text-neutral-500">
          head=({fmtFloat(b.head[0])}, {fmtFloat(b.head[1])}, {fmtFloat(b.head[2])}) · tail=({fmtFloat(b.tail[0])},{' '}
          {fmtFloat(b.tail[1])}, {fmtFloat(b.tail[2])}) · roll={fmtFloat(b.roll)}
        </span>
      </div>
      {b.children.length > 0 && renderBoneTree(b.children, depth + 1)}
    </div>
  ))

interface Props {
  blend: BlendFileData
}

const ApiView = ({ blend }: Props) => {
  const meshes = useMemo(() => extractMeshes(blend), [blend])
  const materials = useMemo(() => extractMaterials(blend), [blend])
  const objects = useMemo(() => extractObjects(blend), [blend])
  const armatures = useMemo(() => extractArmatures(blend), [blend])

  return (
    <div className="flex flex-col gap-3">
      <Section title="Meshes" subtitle={`${meshes.length} found`}>
        {meshes.length === 0 ? (
          <div className="text-neutral-500">No meshes in this file.</div>
        ) : (
          <div className="flex flex-col gap-3">
            {meshes.map(m => (
              <div key={m.name} className="rounded border border-white/5 bg-black/20 p-3">
                <div className="mb-2 font-semibold text-neutral-100">{m.name}</div>
                <dl className="grid grid-cols-[140px_1fr] gap-x-3 gap-y-1 font-mono text-[11px]">
                  <dt className="text-neutral-500">vertices</dt>
                  <dd className="text-neutral-300">{m.vertexCount}</dd>
                  <dt className="text-neutral-500">edges</dt>
                  <dd className="text-neutral-300">{m.edgeCount}</dd>
                  <dt className="text-neutral-500">faces</dt>
                  <dd className="text-neutral-300">{m.faceCount}</dd>
                  <dt className="text-neutral-500">corners</dt>
                  <dd className="text-neutral-300">{m.cornerCount}</dd>
                  <dt className="text-neutral-500">triangles</dt>
                  <dd className="text-neutral-300">{m.triangles.length / 3}</dd>
                  <dt className="text-neutral-500">material slots</dt>
                  <dd className="text-neutral-300">{m.materialSlotNames.join(', ') || '—'}</dd>
                  <dt className="text-neutral-500">uv maps</dt>
                  <dd className="text-neutral-300">{Object.keys(m.uvMaps).join(', ') || '—'}</dd>
                  <dt className="text-neutral-500">vertex colors</dt>
                  <dd className="text-neutral-300">
                    {Object.keys(m.vertexColors).join(', ') || Object.keys(m.vertexByteColors).join(', ') || '—'}
                  </dd>
                  <dt className="text-neutral-500">vertex groups</dt>
                  <dd className="text-neutral-300">{m.vertexGroupNames.join(', ') || '—'}</dd>
                  <dt className="text-neutral-500">first vertices</dt>
                  <dd className="text-neutral-300">{previewArray(m.vertices, 9)}</dd>
                  <dt className="text-neutral-500">first normals</dt>
                  <dd className="text-neutral-300">{previewArray(m.vertexNormals, 9)}</dd>
                  <dt className="text-neutral-500">first triangles</dt>
                  <dd className="text-neutral-300">{previewArray(m.triangles, 12)}</dd>
                </dl>
                {m.dvert && m.dvert.some(d => d.totalWeight > 0) && (
                  <div className="mt-2 text-[11px] text-neutral-400">
                    weights: {m.dvert.filter(d => d.totalWeight > 0).length} of {m.vertexCount} vertices weighted
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Materials" subtitle={`${materials.length} found`}>
        {materials.length === 0 ? (
          <div className="text-neutral-500">No materials.</div>
        ) : (
          <div className="overflow-hidden rounded border border-white/5">
            <table className="w-full font-mono text-[11px]">
              <thead className="bg-white/[0.04] text-neutral-400">
                <tr>
                  <th className="px-2 py-1 text-left font-semibold">name</th>
                  <th className="px-2 py-1 text-left font-semibold">diffuse rgba</th>
                  <th className="px-2 py-1 text-right font-semibold">metallic</th>
                  <th className="px-2 py-1 text-right font-semibold">roughness</th>
                  <th className="px-2 py-1 text-center font-semibold">nodes</th>
                </tr>
              </thead>
              <tbody>
                {materials.map(m => (
                  <tr key={m.name} className="border-t border-white/[0.03]">
                    <td className="px-2 py-1 text-neutral-200">{m.name}</td>
                    <td className="px-2 py-1 text-neutral-300">
                      <span
                        className="mr-2 inline-block size-3 rounded border border-white/10 align-middle"
                        style={{
                          background: `rgba(${m.diffuse.map((c, i) => (i < 3 ? Math.round(c * 255) : c)).join(',')})`,
                        }}
                      />
                      {m.diffuse.map(c => fmtFloat(c, 2)).join(', ')}
                    </td>
                    <td className="px-2 py-1 text-right text-neutral-300">{fmtFloat(m.metallic, 2)}</td>
                    <td className="px-2 py-1 text-right text-neutral-300">{fmtFloat(m.roughness, 2)}</td>
                    <td className="px-2 py-1 text-center text-neutral-300">{m.hasNodeTree ? '●' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Objects" subtitle={`${objects.length} found`}>
        {objects.length === 0 ? (
          <div className="text-neutral-500">No objects.</div>
        ) : (
          <div className="overflow-hidden rounded border border-white/5">
            <table className="w-full font-mono text-[11px]">
              <thead className="bg-white/[0.04] text-neutral-400">
                <tr>
                  <th className="px-2 py-1 text-left font-semibold">name</th>
                  <th className="px-2 py-1 text-left font-semibold">type</th>
                  <th className="px-2 py-1 text-left font-semibold">location</th>
                  <th className="px-2 py-1 text-left font-semibold">scale</th>
                  <th className="px-2 py-1 text-left font-semibold">data</th>
                </tr>
              </thead>
              <tbody>
                {objects.map(o => (
                  <tr key={o.name} className="border-t border-white/[0.03]">
                    <td className="px-2 py-1 text-neutral-200">{o.name}</td>
                    <td className="px-2 py-1 text-neutral-400">{OB_TYPE_NAMES[o.type] ?? o.type}</td>
                    <td className="px-2 py-1 text-neutral-300">{o.location.map(c => fmtFloat(c, 2)).join(', ')}</td>
                    <td className="px-2 py-1 text-neutral-300">{o.scale.map(c => fmtFloat(c, 2)).join(', ')}</td>
                    <td className="px-2 py-1 text-neutral-400">{o.dataName ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Armatures" subtitle={`${armatures.length} found`}>
        {armatures.length === 0 ? (
          <div className="text-neutral-500">No armatures.</div>
        ) : (
          <div className="flex flex-col gap-3">
            {armatures.map(a => (
              <div key={a.name} className="rounded border border-white/5 bg-black/20 p-3">
                <div className="mb-2 font-semibold text-neutral-100">{a.name}</div>
                <div className="text-[11px]">{renderBoneTree(a.bones)}</div>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  )
}

export default ApiView
