import { useMemo } from 'react'

import type { BlendFileData } from 'jsblender'

import Section from './Section'

const formatBytes = (n: number): string => {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

const formatHex = (buf: Uint8Array, max = 256): string => {
  const len = Math.min(buf.length, max)
  const lines: string[] = []
  for (let i = 0; i < len; i += 16) {
    const slice = buf.subarray(i, Math.min(i + 16, len))
    const hex = Array.from(slice, b => b.toString(16).padStart(2, '0')).join(' ')
    const ascii = Array.from(slice, b => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.')).join('')
    lines.push(`${i.toString(16).padStart(8, '0')}  ${hex.padEnd(48, ' ')}  ${ascii}`)
  }
  return lines.join('\n')
}

interface Props {
  raw: Uint8Array
  blend: BlendFileData
}

const RawView = ({ raw, blend }: Props) => {
  const blockCounts = useMemo(() => {
    const m = new Map<string, { count: number; bytes: number }>()
    for (const b of blend.blocks) {
      const entry = m.get(b.code) ?? { count: 0, bytes: 0 }
      entry.count++
      entry.bytes += b.size
      m.set(b.code, entry)
    }
    return [...m.entries()].toSorted((a, b) => b[1].bytes - a[1].bytes)
  }, [blend])

  const totalBlockBytes = useMemo(() => blend.blocks.reduce((s, b) => s + b.size, 0), [blend])

  return (
    <div className="flex flex-col gap-3">
      <Section title="Header" subtitle="parsed BLENDER preamble">
        <dl className="grid grid-cols-[140px_1fr] gap-x-3 gap-y-1 font-mono text-neutral-300">
          <dt className="text-neutral-500">version</dt>
          <dd>
            {blend.header.version} <span className="text-neutral-500">({blend.header.versionString})</span>
          </dd>
          <dt className="text-neutral-500">pointerSize</dt>
          <dd>{blend.header.pointerSize} bytes</dd>
          <dt className="text-neutral-500">endianness</dt>
          <dd>{blend.header.endianness}</dd>
          <dt className="text-neutral-500">largeFormat</dt>
          <dd>{String(blend.header.largeFormat)}</dd>
          <dt className="text-neutral-500">header size</dt>
          <dd>{blend.header.size} bytes</dd>
          <dt className="text-neutral-500">file size</dt>
          <dd>
            {formatBytes(raw.length)} <span className="text-neutral-500">(uncompressed)</span>
          </dd>
        </dl>
      </Section>

      <Section title="Blocks" subtitle={`${blend.blocks.length} total · ${formatBytes(totalBlockBytes)}`}>
        <div className="overflow-hidden rounded border border-white/5">
          <table className="w-full font-mono text-[11px]">
            <thead className="bg-white/[0.04] text-neutral-400">
              <tr>
                <th className="px-2 py-1 text-left font-semibold">code</th>
                <th className="px-2 py-1 text-right font-semibold">count</th>
                <th className="px-2 py-1 text-right font-semibold">bytes</th>
              </tr>
            </thead>
            <tbody>
              {blockCounts.map(([code, info]) => (
                <tr key={code} className="border-t border-white/[0.03]">
                  <td className="px-2 py-1 text-neutral-200">{code || '(empty)'}</td>
                  <td className="px-2 py-1 text-right text-neutral-400">{info.count}</td>
                  <td className="px-2 py-1 text-right text-neutral-400">{formatBytes(info.bytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section
        title="SDNA"
        subtitle={`${blend.sdna.structs.length} structs · ${blend.sdna.types.length} types · ${blend.sdna.names.length} names`}
        defaultOpen={false}
      >
        <p className="mb-2 text-neutral-400">A few well-known struct sizes from the parsed SDNA:</p>
        <dl className="grid grid-cols-[160px_1fr] gap-x-3 gap-y-1 font-mono">
          {['Mesh', 'Material', 'Object', 'Bone', 'bArmature', 'Attribute', 'AttributeStorage', 'MDeformVert'].map(
            name => {
              const idx = blend.sdna.structIndexByType.get(name)
              const layout = idx !== undefined ? blend.sdna.layouts[idx] : undefined
              return (
                <div key={name} className="contents">
                  <dt className="text-neutral-500">{name}</dt>
                  <dd className="text-neutral-300">
                    {layout ? `${layout.size} bytes · ${layout.fields.length} fields` : 'not present'}
                  </dd>
                </div>
              )
            },
          )}
        </dl>
      </Section>

      <Section title="Raw bytes" subtitle="first 256 bytes of the uncompressed payload" defaultOpen={false}>
        <pre className="overflow-x-auto rounded bg-black/40 p-2 font-mono text-[11px] leading-snug whitespace-pre text-neutral-300">
          {formatHex(raw, 256)}
        </pre>
      </Section>
    </div>
  )
}

export default RawView
