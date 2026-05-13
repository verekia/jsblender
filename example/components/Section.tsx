import { useState } from 'react'
import type { ReactNode } from 'react'

interface SectionProps {
  title: ReactNode
  subtitle?: string
  defaultOpen?: boolean
  children: ReactNode
}

const Section = ({ title, subtitle, defaultOpen = true, children }: SectionProps) => {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="rounded-lg border border-white/10 bg-white/[0.02]">
      <button
        className="flex w-full cursor-pointer items-center justify-between px-4 py-2.5 text-left text-sm font-semibold text-neutral-200 transition-colors hover:bg-white/[0.04]"
        onClick={() => setOpen(o => !o)}
      >
        <span className="inline-flex items-center gap-2">
          {title}
          {subtitle && <span className="ml-1 font-normal text-neutral-500">{subtitle}</span>}
        </span>
        <span className="text-neutral-500">{open ? '−' : '+'}</span>
      </button>
      {open && <div className="border-t border-white/5 px-4 py-3 text-xs">{children}</div>}
    </section>
  )
}

export default Section
