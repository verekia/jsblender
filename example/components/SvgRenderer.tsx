import { useMemo, useState } from 'react'

import type { BlendFileData } from 'jsblender'

import { renderBlendToSvg } from '../lib/blender-to-svg'

interface SvgRendererProps {
  blend: BlendFileData
}

const SvgRenderer = ({ blend }: SvgRendererProps) => {
  const [shading, setShading] = useState<'lambert' | 'flat'>('flat')
  const [creaseDeg, setCreaseDeg] = useState(180)
  const [strokeWidth, setStrokeWidth] = useState(1)
  const [noOutlines, setNoOutlines] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const svg = useMemo(() => {
    try {
      setError(null)
      return renderBlendToSvg(blend, {
        shading,
        creaseAngle: (creaseDeg * Math.PI) / 180,
        strokeWidth,
        noOutlines,
      })
    } catch (e) {
      setError((e as Error).message)
      return null
    }
  }, [blend, shading, creaseDeg, strokeWidth, noOutlines])

  const download = () => {
    if (!svg) return
    const blob = new Blob([svg], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'render.svg'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3 rounded border border-white/5 bg-black/20 p-3 text-[11px]">
        <label className="flex items-center gap-2 text-neutral-300">
          shading
          <select
            value={shading}
            onChange={e => setShading(e.target.value as 'lambert' | 'flat')}
            className="rounded border border-white/10 bg-white/5 px-2 py-1 text-neutral-100"
          >
            <option value="lambert">lambert</option>
            <option value="flat">flat</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-neutral-300">
          crease °
          <input
            type="number"
            min="0"
            max="180"
            step="1"
            value={creaseDeg}
            onChange={e => setCreaseDeg(Number(e.target.value))}
            className="w-16 rounded border border-white/10 bg-white/5 px-2 py-1 text-neutral-100"
          />
        </label>
        <label className="flex items-center gap-2 text-neutral-300">
          stroke
          <input
            type="number"
            min="0"
            step="0.5"
            value={strokeWidth}
            onChange={e => setStrokeWidth(Number(e.target.value))}
            className="w-16 rounded border border-white/10 bg-white/5 px-2 py-1 text-neutral-100"
          />
        </label>
        <label className="flex items-center gap-2 text-neutral-300">
          <input type="checkbox" checked={noOutlines} onChange={e => setNoOutlines(e.target.checked)} /> no outlines
        </label>
        <button
          onClick={download}
          disabled={!svg}
          className="ml-auto cursor-pointer rounded border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-emerald-200 transition-colors hover:bg-emerald-400/15 disabled:opacity-40"
        >
          Download .svg
        </button>
      </div>
      {error && (
        <div className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">{error}</div>
      )}
      {svg && (
        <div
          className="overflow-hidden rounded border border-white/5 bg-neutral-700 p-2 [&>svg]:block [&>svg]:size-full"
          style={{ height: '400px', minHeight: '200px', resize: 'vertical' }}
          // Strip fixed width/height so the SVG inherits its container size; the
          // viewBox + default preserveAspectRatio give CSS `contain` behaviour.
          dangerouslySetInnerHTML={{ __html: svg.replace(/<svg ([^>]*?)\s*width="[^"]*"\s*height="[^"]*"/, '<svg $1') }}
        />
      )}
      <p className="text-[11px] text-neutral-500">
        Only Mirror and Array modifiers are applied. Subdiv, Solidify, Bevel and others are skipped — the base mesh
        passes through.
      </p>
    </div>
  )
}

export default SvgRenderer
