const clamp = (v: number): number => Math.round(Math.max(0, Math.min(1, v)) * 255)

const fmt = (n: number): string => (Number.isFinite(n) ? n.toFixed(2) : 'NaN')

interface ColorSwatchProps {
  /** Linear `[r, g, b]` or `[r, g, b, a]` in 0..1. */
  color: number[] | readonly number[]
  /** When true, the numeric values are NOT printed next to the swatch. */
  swatchOnly?: boolean
}

/**
 * A small rounded square showing the colour, followed by its float channel
 * values. Use anywhere a linear-RGB(A) entry would otherwise be plain text.
 */
const ColorSwatch = ({ color, swatchOnly = false }: ColorSwatchProps) => {
  const r = color[0] ?? 0
  const g = color[1] ?? 0
  const b = color[2] ?? 0
  const a = color[3] ?? 1
  const css = `rgba(${clamp(r)}, ${clamp(g)}, ${clamp(b)}, ${a})`
  return (
    <span className="inline-flex items-center gap-2 align-middle">
      <span className="inline-block size-3.5 shrink-0 rounded border border-white/15" style={{ background: css }} />
      {!swatchOnly && <span>{color.map(c => fmt(c)).join(', ')}</span>}
    </span>
  )
}

export default ColorSwatch
