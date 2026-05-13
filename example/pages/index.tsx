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
      const res = await fetch('simple.blend')
      if (!res.ok) throw new Error(`Failed to fetch demo: ${res.status}`)
      const buf = new Uint8Array(await res.arrayBuffer())
      loadBuffer('simple.blend', buf.byteLength, buf)
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
          <h1 className="text-lg font-semibold tracking-tight text-white">jsblender</h1>
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
