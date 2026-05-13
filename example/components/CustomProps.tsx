import type { IDPropertyValue } from 'jsblender'

const isObjectMap = (v: IDPropertyValue): v is { [k: string]: IDPropertyValue } =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && !('__idRef' in v)

const formatValue = (v: IDPropertyValue): string => {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'string') return JSON.stringify(v)
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(4).replace(/0+$/, '0')
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]'
    if (typeof v[0] === 'number' || typeof v[0] === 'boolean') return `[${v.join(', ')}]`
    return `[${v.length} entries]`
  }
  if (typeof v === 'object' && '__idRef' in v) return v.__idRef ? `ID(${v.__idRef})` : 'ID(null)'
  if (isObjectMap(v)) return `{ ${Object.keys(v).length} keys }`
  return String(v)
}

interface CustomPropsProps {
  props: Record<string, IDPropertyValue>
  emptyLabel?: string
}

const CustomProps = ({ props, emptyLabel = '—' }: CustomPropsProps) => {
  const entries = Object.entries(props)
  if (entries.length === 0) return <span className="text-neutral-500">{emptyLabel}</span>
  return (
    <dl className="grid grid-cols-[140px_1fr] gap-x-3 gap-y-1 font-mono text-[11px]">
      {entries.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-emerald-300/80">{k}</dt>
          <dd className="text-neutral-300">
            {isObjectMap(v) ? (
              <div className="rounded border border-white/5 bg-black/20 p-2">
                <CustomProps props={v as Record<string, IDPropertyValue>} />
              </div>
            ) : (
              formatValue(v)
            )}
          </dd>
        </div>
      ))}
    </dl>
  )
}

export default CustomProps
