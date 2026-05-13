import { useCallback, useEffect, useRef, useState } from 'react'

interface DropZoneProps {
  onFileDrop: (file: File) => void
  onDemoLoad: () => void
  hasFile: boolean
}

const DropZone = ({ onFileDrop, onDemoLoad, hasFile }: DropZoneProps) => {
  const [isDragOver, setIsDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFile = useCallback(
    (file: File) => {
      if (file.name.toLowerCase().endsWith('.blend')) onFileDrop(file)
    },
    [onFileDrop],
  )

  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragOver(true)
    }
    const onDragLeave = (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.relatedTarget) return
      setIsDragOver(false)
    }
    const onDrop = (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragOver(false)
      const file = e.dataTransfer?.files?.[0]
      if (file) handleFile(file)
    }
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [handleFile])

  if (hasFile && !isDragOver) return null

  return (
    <div
      className={`pointer-events-none fixed inset-0 z-50 flex items-center justify-center transition-colors ${
        isDragOver ? 'bg-emerald-500/10 backdrop-blur-[2px]' : ''
      }`}
    >
      {!hasFile && (
        <div className="pointer-events-auto rounded-xl border border-dashed border-white/15 bg-black/70 px-8 py-7 text-center shadow-2xl backdrop-blur-md">
          <div className="mb-1 text-base font-semibold text-white">Drop a .blend file</div>
          <div className="mb-4 text-xs text-neutral-400">or pick one from disk</div>
          <div className="flex flex-col gap-2">
            <button
              className="cursor-pointer rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-xs text-white transition-colors hover:bg-white/10"
              onClick={() => fileInputRef.current?.click()}
            >
              Open .blend...
            </button>
            <button
              className="cursor-pointer rounded-lg border border-emerald-400/20 bg-emerald-400/10 px-4 py-2 text-xs text-emerald-200 transition-colors hover:bg-emerald-400/15"
              onClick={onDemoLoad}
            >
              Load full.blend (demo)
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".blend"
            className="hidden"
            onChange={e => {
              const file = e.target.files?.[0]
              if (file) handleFile(file)
              e.target.value = ''
            }}
          />
        </div>
      )}
      {isDragOver && hasFile && (
        <div className="pointer-events-none rounded-xl border-2 border-dashed border-emerald-300/60 bg-emerald-500/10 px-10 py-8 text-base font-semibold text-emerald-100 shadow-2xl">
          Drop to replace
        </div>
      )}
    </div>
  )
}

export default DropZone
