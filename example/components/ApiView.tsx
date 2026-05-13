import { useMemo } from 'react'

import {
  extractArmatures,
  extractCameras,
  extractImages,
  extractLights,
  extractMaterials,
  extractMeshes,
  extractObjects,
  extractScenes,
  OB_TYPE,
} from 'jsblender'
import type { Bone, BlendFileData, Collection, IDPropertyValue } from 'jsblender'

import BlenderIcon from './BlenderIcon'
import ColorSwatch from './ColorSwatch'
import CustomProps from './CustomProps'
import Section from './Section'

import type { BlenderIconType } from './BlenderIcon'

const OB_TYPE_NAMES: Record<number, string> = Object.fromEntries(
  Object.entries(OB_TYPE).map(([k, v]) => [v, k.toLowerCase()]),
)

const OB_TYPE_ICONS: Record<number, BlenderIconType> = {
  [OB_TYPE.MESH]: 'mesh',
  [OB_TYPE.LAMP]: 'light',
  [OB_TYPE.CAMERA]: 'camera',
  [OB_TYPE.ARMATURE]: 'armature',
}
const iconForObject = (type: number): BlenderIconType => OB_TYPE_ICONS[type] ?? 'object'

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

const hasProps = (props: Record<string, IDPropertyValue>): boolean => Object.keys(props).length > 0

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

const renderCollectionTree = (c: Collection, depth = 0): React.ReactNode => (
  <div key={`${depth}-${c.name}`} className="font-mono">
    <div style={{ paddingLeft: depth * 14 }} className="flex items-center gap-2 text-neutral-200">
      <BlenderIcon type="collection" size={14} />
      <span>{c.name}</span>
      {c.objectNames.length > 0 && <span className="text-neutral-500">[{c.objectNames.join(', ')}]</span>}
    </div>
    {c.children.map(child => renderCollectionTree(child, depth + 1))}
  </div>
)

interface Props {
  blend: BlendFileData
}

const ApiView = ({ blend }: Props) => {
  const meshes = useMemo(() => extractMeshes(blend), [blend])
  const materials = useMemo(() => extractMaterials(blend), [blend])
  const objects = useMemo(() => extractObjects(blend), [blend])
  const armatures = useMemo(() => extractArmatures(blend), [blend])
  const lights = useMemo(() => extractLights(blend), [blend])
  const cameras = useMemo(() => extractCameras(blend), [blend])
  const images = useMemo(() => extractImages(blend), [blend])
  const scenes = useMemo(() => extractScenes(blend), [blend])

  return (
    <div className="flex flex-col gap-3">
      <Section
        title={
          <>
            <BlenderIcon type="scene" /> Scenes
          </>
        }
        subtitle={`${scenes.length} found`}
      >
        {scenes.length === 0 ? (
          <div className="text-neutral-500">No scenes.</div>
        ) : (
          <div className="flex flex-col gap-3">
            {scenes.map(s => (
              <div key={s.name} className="rounded border border-white/5 bg-black/20 p-3">
                <div className="mb-2 flex items-center gap-2 font-semibold text-neutral-100">
                  <BlenderIcon type="scene" />
                  {s.name}
                </div>
                <dl className="grid grid-cols-[140px_1fr] gap-x-3 gap-y-1 font-mono text-[11px]">
                  <dt className="text-neutral-500">frames</dt>
                  <dd className="text-neutral-300">
                    {s.frameStart}–{s.frameEnd} (current {s.frameCurrent})
                  </dd>
                  <dt className="text-neutral-500">fps</dt>
                  <dd className="text-neutral-300">{fmtFloat(s.fps, 2)}</dd>
                  <dt className="text-neutral-500">resolution</dt>
                  <dd className="text-neutral-300">
                    {s.resolutionX} × {s.resolutionY} ({s.resolutionPercentage}%)
                  </dd>
                  <dt className="text-neutral-500">active camera</dt>
                  <dd className="text-neutral-300">{s.cameraObject ?? '—'}</dd>
                </dl>
                {s.rootCollection && (
                  <div className="mt-3">
                    <div className="mb-1 text-[11px] text-neutral-500">collections</div>
                    <div className="text-[11px]">{renderCollectionTree(s.rootCollection)}</div>
                  </div>
                )}
                {hasProps(s.customProperties) && (
                  <div className="mt-3">
                    <div className="mb-1 text-[11px] text-neutral-500">custom properties</div>
                    <CustomProps props={s.customProperties} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section
        title={
          <>
            <BlenderIcon type="mesh" /> Meshes
          </>
        }
        subtitle={`${meshes.length} found`}
      >
        {meshes.length === 0 ? (
          <div className="text-neutral-500">No meshes.</div>
        ) : (
          <div className="flex flex-col gap-3">
            {meshes.map(m => (
              <div key={m.name} className="rounded border border-white/5 bg-black/20 p-3">
                <div className="mb-2 flex items-center gap-2 font-semibold text-neutral-100">
                  <BlenderIcon type="mesh" />
                  {m.name}
                </div>
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
                  <dt className="text-neutral-500">first triangles</dt>
                  <dd className="text-neutral-300">{previewArray(m.triangles, 12)}</dd>
                </dl>
                {hasProps(m.customProperties) && (
                  <div className="mt-3">
                    <div className="mb-1 text-[11px] text-neutral-500">custom properties</div>
                    <CustomProps props={m.customProperties} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section
        title={
          <>
            <BlenderIcon type="material" /> Materials
          </>
        }
        subtitle={`${materials.length} found`}
      >
        {materials.length === 0 ? (
          <div className="text-neutral-500">No materials.</div>
        ) : (
          <div className="flex flex-col gap-3">
            {materials.map(m => (
              <div key={m.name} className="rounded border border-white/5 bg-black/20 p-3">
                <div className="mb-2 flex items-center gap-2 font-semibold text-neutral-100">
                  <BlenderIcon type="material" />
                  <ColorSwatch color={m.diffuse} swatchOnly />
                  {m.name}
                </div>
                <dl className="grid grid-cols-[140px_1fr] gap-x-3 gap-y-1 font-mono text-[11px]">
                  <dt className="text-neutral-500">diffuse rgba</dt>
                  <dd className="text-neutral-300">
                    <ColorSwatch color={m.diffuse} />
                  </dd>
                  <dt className="text-neutral-500">specular rgb</dt>
                  <dd className="text-neutral-300">
                    <ColorSwatch color={m.specular} />
                  </dd>
                  <dt className="text-neutral-500">metallic</dt>
                  <dd className="text-neutral-300">{fmtFloat(m.metallic, 2)}</dd>
                  <dt className="text-neutral-500">roughness</dt>
                  <dd className="text-neutral-300">{fmtFloat(m.roughness, 2)}</dd>
                  <dt className="text-neutral-500">node tree</dt>
                  <dd className="text-neutral-300">{m.hasNodeTree ? `${m.shader?.nodes.length ?? 0} nodes` : '—'}</dd>
                </dl>
                {m.shader?.principled && (
                  <div className="mt-3 rounded border border-white/5 bg-black/30 p-2">
                    <div className="mb-1 text-[11px] text-neutral-500">Principled BSDF</div>
                    <dl className="grid grid-cols-[140px_1fr] gap-x-3 gap-y-1 font-mono text-[11px]">
                      <dt className="text-neutral-500">base color</dt>
                      <dd className="text-neutral-300">
                        <ColorSwatch color={m.shader.principled.baseColor} />
                        {m.shader.principled.baseColorImage && (
                          <span className="ml-2 text-emerald-300/80">→ {m.shader.principled.baseColorImage}</span>
                        )}
                      </dd>
                      <dt className="text-neutral-500">metallic</dt>
                      <dd className="text-neutral-300">{fmtFloat(m.shader.principled.metallic, 2)}</dd>
                      <dt className="text-neutral-500">roughness</dt>
                      <dd className="text-neutral-300">{fmtFloat(m.shader.principled.roughness, 2)}</dd>
                      <dt className="text-neutral-500">IOR</dt>
                      <dd className="text-neutral-300">{fmtFloat(m.shader.principled.ior, 3)}</dd>
                      <dt className="text-neutral-500">alpha</dt>
                      <dd className="text-neutral-300">{fmtFloat(m.shader.principled.alpha, 2)}</dd>
                      <dt className="text-neutral-500">emission</dt>
                      <dd className="flex items-center gap-2 text-neutral-300">
                        <ColorSwatch color={m.shader.principled.emissionColor} />
                        <span>× {fmtFloat(m.shader.principled.emissionStrength, 2)}</span>
                      </dd>
                    </dl>
                  </div>
                )}
                {hasProps(m.customProperties) && (
                  <div className="mt-3">
                    <div className="mb-1 text-[11px] text-neutral-500">custom properties</div>
                    <CustomProps props={m.customProperties} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section
        title={
          <>
            <BlenderIcon type="light" /> Lights
          </>
        }
        subtitle={`${lights.length} found`}
      >
        {lights.length === 0 ? (
          <div className="text-neutral-500">No lights.</div>
        ) : (
          <div className="flex flex-col gap-3">
            {lights.map(l => (
              <div key={l.name} className="rounded border border-white/5 bg-black/20 p-3">
                <div className="mb-2 flex items-center gap-2 font-semibold text-neutral-100">
                  <BlenderIcon type="light" />
                  <ColorSwatch color={l.color} swatchOnly />
                  {l.name} <span className="text-[11px] font-normal text-neutral-500">({l.type})</span>
                </div>
                <dl className="grid grid-cols-[140px_1fr] gap-x-3 gap-y-1 font-mono text-[11px]">
                  <dt className="text-neutral-500">color</dt>
                  <dd className="text-neutral-300">
                    <ColorSwatch color={l.color} />
                  </dd>
                  <dt className="text-neutral-500">energy</dt>
                  <dd className="text-neutral-300">{fmtFloat(l.energy, 2)}</dd>
                  <dt className="text-neutral-500">radius</dt>
                  <dd className="text-neutral-300">{fmtFloat(l.radius, 3)}</dd>
                  {l.spotSize !== undefined && (
                    <>
                      <dt className="text-neutral-500">spot size</dt>
                      <dd className="text-neutral-300">{fmtFloat(l.spotSize, 3)} rad</dd>
                    </>
                  )}
                  {l.spotBlend !== undefined && (
                    <>
                      <dt className="text-neutral-500">spot blend</dt>
                      <dd className="text-neutral-300">{fmtFloat(l.spotBlend, 2)}</dd>
                    </>
                  )}
                  {l.sunAngle !== undefined && (
                    <>
                      <dt className="text-neutral-500">sun angle</dt>
                      <dd className="text-neutral-300">{fmtFloat(l.sunAngle, 4)} rad</dd>
                    </>
                  )}
                  {l.areaShape && (
                    <>
                      <dt className="text-neutral-500">area</dt>
                      <dd className="text-neutral-300">
                        {l.areaShape}
                        {l.areaSize && ` (${l.areaSize.map(s => fmtFloat(s, 2)).join(' × ')})`}
                      </dd>
                    </>
                  )}
                  <dt className="text-neutral-500">uses nodes</dt>
                  <dd className="text-neutral-300">{l.useNodes ? 'yes' : 'no'}</dd>
                </dl>
                {hasProps(l.customProperties) && (
                  <div className="mt-3">
                    <div className="mb-1 text-[11px] text-neutral-500">custom properties</div>
                    <CustomProps props={l.customProperties} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section
        title={
          <>
            <BlenderIcon type="camera" /> Cameras
          </>
        }
        subtitle={`${cameras.length} found`}
      >
        {cameras.length === 0 ? (
          <div className="text-neutral-500">No cameras.</div>
        ) : (
          <div className="flex flex-col gap-3">
            {cameras.map(c => (
              <div key={c.name} className="rounded border border-white/5 bg-black/20 p-3">
                <div className="mb-2 flex items-center gap-2 font-semibold text-neutral-100">
                  <BlenderIcon type="camera" />
                  {c.name} <span className="text-[11px] font-normal text-neutral-500">({c.type})</span>
                </div>
                <dl className="grid grid-cols-[140px_1fr] gap-x-3 gap-y-1 font-mono text-[11px]">
                  <dt className="text-neutral-500">lens</dt>
                  <dd className="text-neutral-300">{fmtFloat(c.lens, 1)} mm</dd>
                  <dt className="text-neutral-500">sensor</dt>
                  <dd className="text-neutral-300">
                    {fmtFloat(c.sensorWidth, 1)} × {fmtFloat(c.sensorHeight, 1)} mm ({c.sensorFit})
                  </dd>
                  <dt className="text-neutral-500">ortho scale</dt>
                  <dd className="text-neutral-300">{fmtFloat(c.orthoScale, 2)}</dd>
                  <dt className="text-neutral-500">clip</dt>
                  <dd className="text-neutral-300">
                    {fmtFloat(c.clipStart, 3)} – {fmtFloat(c.clipEnd, 1)}
                  </dd>
                  <dt className="text-neutral-500">shift</dt>
                  <dd className="text-neutral-300">
                    {fmtFloat(c.shiftX, 3)}, {fmtFloat(c.shiftY, 3)}
                  </dd>
                </dl>
                {hasProps(c.customProperties) && (
                  <div className="mt-3">
                    <div className="mb-1 text-[11px] text-neutral-500">custom properties</div>
                    <CustomProps props={c.customProperties} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section
        title={
          <>
            <BlenderIcon type="image" /> Images
          </>
        }
        subtitle={`${images.length} found`}
      >
        {images.length === 0 ? (
          <div className="text-neutral-500">No images.</div>
        ) : (
          <div className="overflow-hidden rounded border border-white/5">
            <table className="w-full font-mono text-[11px]">
              <thead className="bg-white/[0.04] text-neutral-400">
                <tr>
                  <th className="px-2 py-1 text-left font-semibold">name</th>
                  <th className="px-2 py-1 text-left font-semibold">source</th>
                  <th className="px-2 py-1 text-left font-semibold">filepath</th>
                  <th className="px-2 py-1 text-right font-semibold">packed</th>
                </tr>
              </thead>
              <tbody>
                {images.map(img => (
                  <tr key={img.name} className="border-t border-white/[0.03]">
                    <td className="px-2 py-1 text-neutral-200">
                      <span className="inline-flex items-center gap-2">
                        <BlenderIcon type="image" size={14} />
                        {img.name}
                      </span>
                    </td>
                    <td className="px-2 py-1 text-neutral-400">{img.source}</td>
                    <td className="px-2 py-1 break-all text-neutral-300">{img.filepath || '—'}</td>
                    <td className="px-2 py-1 text-right text-neutral-300">
                      {img.packed ? `${img.packed.byteLength} B` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section
        title={
          <>
            <BlenderIcon type="object" /> Objects
          </>
        }
        subtitle={`${objects.length} found`}
      >
        {objects.length === 0 ? (
          <div className="text-neutral-500">No objects.</div>
        ) : (
          <div className="flex flex-col gap-3">
            {objects.map(o => (
              <div key={o.name} className="rounded border border-white/5 bg-black/20 p-3">
                <div className="mb-2 flex items-center gap-2 font-semibold text-neutral-100">
                  <BlenderIcon type="object" />
                  <BlenderIcon type={iconForObject(o.type)} size={14} />
                  {o.name}{' '}
                  <span className="text-[11px] font-normal text-neutral-500">({OB_TYPE_NAMES[o.type] ?? o.type})</span>
                </div>
                <dl className="grid grid-cols-[140px_1fr] gap-x-3 gap-y-1 font-mono text-[11px]">
                  <dt className="text-neutral-500">location</dt>
                  <dd className="text-neutral-300">{o.location.map(c => fmtFloat(c, 2)).join(', ')}</dd>
                  <dt className="text-neutral-500">rotation</dt>
                  <dd className="text-neutral-300">{o.rotation.map(c => fmtFloat(c, 2)).join(', ')}</dd>
                  <dt className="text-neutral-500">scale</dt>
                  <dd className="text-neutral-300">{o.scale.map(c => fmtFloat(c, 2)).join(', ')}</dd>
                  <dt className="text-neutral-500">data</dt>
                  <dd className="text-neutral-300">{o.dataName ?? '—'}</dd>
                  <dt className="text-neutral-500">parent</dt>
                  <dd className="text-neutral-300">{o.parentName ?? '—'}</dd>
                </dl>
                {hasProps(o.customProperties) && (
                  <div className="mt-3">
                    <div className="mb-1 text-[11px] text-neutral-500">custom properties</div>
                    <CustomProps props={o.customProperties} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section
        title={
          <>
            <BlenderIcon type="armature" /> Armatures
          </>
        }
        subtitle={`${armatures.length} found`}
      >
        {armatures.length === 0 ? (
          <div className="text-neutral-500">No armatures.</div>
        ) : (
          <div className="flex flex-col gap-3">
            {armatures.map(a => (
              <div key={a.name} className="rounded border border-white/5 bg-black/20 p-3">
                <div className="mb-2 flex items-center gap-2 font-semibold text-neutral-100">
                  <BlenderIcon type="armature" />
                  {a.name}
                </div>
                <div className="text-[11px]">{renderBoneTree(a.bones)}</div>
                {hasProps(a.customProperties) && (
                  <div className="mt-3">
                    <div className="mb-1 text-[11px] text-neutral-500">custom properties</div>
                    <CustomProps props={a.customProperties} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  )
}

export default ApiView
