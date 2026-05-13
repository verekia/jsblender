import { useCallback, useState } from 'react'

import { parseBlend } from 'jsblender'
import type { BlendFileData } from 'jsblender'

import ApiView from '../components/ApiView'
import DropZone from '../components/DropZone'

interface LoadedFile {
  name: string
  size: number
  blend: BlendFileData
}

const readFileAsUint8 = (file: File): Promise<Uint8Array> =>
  new Promise((res, rej) => {
    const reader = new FileReader()
    reader.onload = () => res(new Uint8Array(reader.result as ArrayBuffer))
    reader.onerror = () => rej(reader.error ?? new Error('FileReader failed'))
    reader.readAsArrayBuffer(file)
  })

const IndexPage = () => {
  const [loaded, setLoaded] = useState<LoadedFile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const loadBuffer = useCallback((name: string, size: number, bytes: Uint8Array) => {
    try {
      const blend = parseBlend(bytes)
      setLoaded({ name, size, blend })
      setError(null)
    } catch (err) {
      setError((err as Error).message)
      setLoaded(null)
    }
  }, [])

  const onFileDrop = useCallback(
    async (file: File) => {
      setLoading(true)
      try {
        const bytes = await readFileAsUint8(file)
        loadBuffer(file.name, file.size, bytes)
      } catch (err) {
        setError((err as Error).message)
      } finally {
        setLoading(false)
      }
    },
    [loadBuffer],
  )

  const onDemoLoad = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('full.blend')
      if (!res.ok) throw new Error(`Failed to fetch demo: ${res.status}`)
      const buf = new Uint8Array(await res.arrayBuffer())
      loadBuffer('full.blend', buf.byteLength, buf)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [loadBuffer])

  return (
    <main className="min-h-screen px-4 py-6 lg:px-8">
      <header className="mb-6 flex flex-wrap items-baseline justify-between gap-3 border-b border-white/10 pb-4">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-white">
            jsblender
            <a
              href="https://github.com/verekia/jsblender"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center text-neutral-400 transition-colors hover:text-white"
              aria-label="View jsblender on GitHub"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden>
                <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.92.57.1.78-.25.78-.55 0-.27-.01-1-.02-1.95-3.2.7-3.87-1.54-3.87-1.54-.52-1.33-1.27-1.68-1.27-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.68 1.25 3.34.95.1-.74.4-1.25.72-1.54-2.55-.29-5.23-1.28-5.23-5.69 0-1.26.45-2.28 1.18-3.08-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.18 1.18a11.1 11.1 0 0 1 5.79 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.58.24 2.75.12 3.04.74.8 1.18 1.82 1.18 3.08 0 4.42-2.69 5.39-5.25 5.68.41.36.78 1.06.78 2.14 0 1.54-.01 2.78-.01 3.16 0 .31.21.66.79.55C20.21 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5z" />
              </svg>
            </a>
          </h1>
          <p className="text-xs text-neutral-400">
            Drop a <code className="rounded bg-white/5 px-1.5 py-0.5">.blend</code> file (Blender 5+) to inspect the
            data exposed by the jsblender API.
          </p>
        </div>
        <div className="text-right text-xs text-neutral-400">
          {loaded ? (
            <>
              <div className="font-mono text-neutral-200">{loaded.name}</div>
              <div>{(loaded.size / 1024).toFixed(1)} KB on disk</div>
            </>
          ) : (
            <span>no file loaded</span>
          )}
        </div>
      </header>

      {error && (
        <div className="mb-4 rounded border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {loading && !loaded && <div className="text-sm text-neutral-400">Parsing...</div>}

      {loaded && <ApiView blend={loaded.blend} />}

      <DropZone onFileDrop={onFileDrop} onDemoLoad={onDemoLoad} hasFile={!!loaded} />
    </main>
  )
}

export default IndexPage
