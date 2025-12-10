'use client'

import { useEffect, useRef, useState } from 'react'

interface ImportStatus {
  running: {
    status: string
    startedAt: string
    updatedAt: string | null
    total?: number
    imported?: number
    skipped?: number
    errors?: number
    lastError?: string | null
  } | null
  lastCompleted: {
    status: string
    finishedAt: string
    total?: number
    imported?: number
    errors?: number
  } | null
  productCount: number
  unassociatedMedia?: {
    count: number
    lastUpdated: string | null
  }
  recentErrors?: Array<{
    id: string
    createdAt: string
    status: string
    lastError: string | null
  }>
  recentErrorsMeta?: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

interface ImportResult {
  success: boolean
  message: string
  progress: {
    total: number
    imported: number
    skipped: number
    errors: Array<{ productId: string; error: string }>
  }
}

interface DriveFile {
  id: string
  name: string
  mimeType: string
  size?: number
  modifiedTime?: string
}

interface StorjObject {
  key: string
  size?: number
  lastModified?: string
}

export default function ImportPage() {
  const [status, setStatus] = useState<ImportStatus | null>(null)
  const [isImporting, setIsImporting] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [logText, setLogText] = useState('')
  const [logError, setLogError] = useState<string | null>(null)
  const logRef = useRef<HTMLDivElement | null>(null)
  const [recentErrors, setRecentErrors] = useState<
    Array<{ id: string; createdAt: string; status: string; lastError: string | null }>
  >([])
  const [errorsPage, setErrorsPage] = useState(1)
  const [errorsMeta, setErrorsMeta] = useState<{
    page: number
    pageSize: number
    total: number
    totalPages: number
  }>({ page: 1, pageSize: 10, total: 0, totalPages: 1 })
  const [driveFiles, setDriveFiles] = useState<DriveFile[]>([])
  const [driveFolderId, setDriveFolderId] = useState('')
  const [driveLoading, setDriveLoading] = useState(false)
  const [driveError, setDriveError] = useState<string | null>(null)
  const [storjObjects, setStorjObjects] = useState<StorjObject[]>([])
  const [storjBucket, setStorjBucket] = useState('')
  const [storjPrefix, setStorjPrefix] = useState('products/')
  const [storjLoading, setStorjLoading] = useState(false)
  const [storjError, setStorjError] = useState<string | null>(null)

  useEffect(() => {
    fetchStatus()
    const interval = setInterval(fetchStatus, 4000)
    return () => clearInterval(interval)
  }, [errorsPage])

  useEffect(() => {
    fetchLogs()
    const interval = setInterval(fetchLogs, 3000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    const el = logRef.current
    if (!el) return
    const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 40
    if (nearBottom) {
      el.scrollTop = el.scrollHeight
    }
  }, [logText])

  async function fetchStatus() {
    try {
      const params = new URLSearchParams({
        errorsPage: errorsPage.toString(),
        errorsPageSize: errorsMeta.pageSize.toString(),
      })
      const res = await fetch(`/api/shopify/import?${params.toString()}`)
      if (res.ok) {
        const data = await res.json()
        setStatus(data)
        setRecentErrors(data.recentErrors || [])
        if (data.recentErrorsMeta) {
          setErrorsMeta(data.recentErrorsMeta)
        }
      }
    } catch (err) {
      console.error('Failed to fetch status:', err)
    }
  }

  async function handleImport() {
    setIsImporting(true)
    setError(null)
    setResult(null)

    try {
      const res = await fetch('/api/shopify/import', {
        method: 'POST',
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.message || data.error || 'Import failed')
        return
      }

      setResult(data)
      fetchStatus() // Refresh status
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setIsImporting(false)
    }
  }

  async function fetchLogs() {
    try {
      setLogError(null)
      const res = await fetch('/api/logs/dev?lines=400', { cache: 'no-store' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setLogError(body.error || 'Failed to load logs')
        return
      }
      const text = await res.text()
      setLogText(text)
    } catch (err) {
      setLogError(err instanceof Error ? err.message : 'Failed to load logs')
    }
  }

  async function fetchDriveFiles(folderOverride?: string) {
    setDriveLoading(true)
    setDriveError(null)
    try {
      const params = new URLSearchParams()
      const folderIdToUse = (folderOverride ?? driveFolderId).trim()
      if (folderIdToUse) {
        params.set('folderId', folderIdToUse)
      }
      const res = await fetch(`/api/gdrive/list${params.size ? `?${params.toString()}` : ''}`, {
        cache: 'no-store',
      })
      const data = await res.json()
      if (!res.ok) {
        setDriveError(data.error || 'Failed to load Drive files')
        setDriveFiles([])
        return
      }
      setDriveFiles(data.files || [])
      if (!driveFolderId && data.folderId) {
        setDriveFolderId(data.folderId)
      }
    } catch (err) {
      setDriveError(err instanceof Error ? err.message : 'Failed to load Drive files')
      setDriveFiles([])
    } finally {
      setDriveLoading(false)
    }
  }

  async function fetchStorjObjects(prefixOverride?: string, bucketOverride?: string) {
    setStorjLoading(true)
    setStorjError(null)
    try {
      const params = new URLSearchParams()
      const bucketToUse = (bucketOverride ?? storjBucket).trim()
      const prefixToUse = (prefixOverride ?? storjPrefix).trim()
      if (bucketToUse) params.set('bucket', bucketToUse)
      if (prefixToUse) params.set('prefix', prefixToUse)

      const res = await fetch(`/api/storj/list${params.size ? `?${params.toString()}` : ''}`, {
        cache: 'no-store',
      })
      const data = await res.json()
      if (!res.ok) {
        setStorjError(data.error || 'Failed to load Storj contents')
        setStorjObjects([])
        return
      }
      setStorjObjects(
        (data.objects || []).map((o: any) => ({
          key: o.key,
          size: o.size,
          lastModified: o.lastModified,
        })),
      )
      if (!storjBucket && data.bucket) setStorjBucket(data.bucket)
      if (prefixOverride === undefined && storjPrefix === 'products/' && data.prefix) {
        setStorjPrefix(data.prefix)
      }
    } catch (err) {
      setStorjError(err instanceof Error ? err.message : 'Failed to load Storj contents')
      setStorjObjects([])
    } finally {
      setStorjLoading(false)
    }
  }

  useEffect(() => {
    // Initial fetch using backend default folder if available
    fetchDriveFiles()
    fetchStorjObjects()
  }, [])

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-white">Import</h1>
        <p className="text-slate-400 mt-2">
          Import products and media from external sources
        </p>
      </div>

      {/* Shopify Import Card */}
      <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 overflow-hidden">
        <div className="p-6 border-b border-slate-700/50">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-green-500/20 flex items-center justify-center text-2xl">
              🛍️
            </div>
            <div>
              <h2 className="text-xl font-semibold text-white">Shopify Import</h2>
              <p className="text-slate-400 text-sm">
                Import products and variants from your Shopify store
              </p>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* Current Status */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-slate-700/30 rounded-lg p-4">
              <p className="text-slate-400 text-sm">Products in PIM</p>
              <p className="text-2xl font-bold text-white mt-1">
                {status?.productCount ?? '—'}
              </p>
            </div>
            <div className="bg-slate-700/30 rounded-lg p-4">
              <p className="text-slate-400 text-sm">Last Sync</p>
              <p className="text-lg font-medium text-white mt-1">
                {status?.lastCompleted
                  ? new Date(status.lastCompleted.finishedAt).toLocaleString()
                  : 'Never'}
              </p>
            </div>
            <div className="bg-slate-700/30 rounded-lg p-4">
              <p className="text-slate-400 text-sm">Status</p>
              <p
                className={`text-lg font-medium mt-1 ${
                  status?.running
                    ? 'text-amber-400'
                    : status?.lastCompleted?.status === 'success'
                      ? 'text-green-400'
                      : status?.lastCompleted?.status === 'partial'
                        ? 'text-yellow-400'
                        : status?.lastCompleted?.status === 'failed'
                          ? 'text-red-400'
                          : 'text-slate-400'
                }`}
              >
                {status?.running
                  ? 'Running'
                  : status?.lastCompleted?.status ?? '—'}
              </p>
            </div>
          </div>

          {/* Running Progress */}
          {status?.running && (
            <div className="border border-amber-500/30 bg-amber-500/5 rounded-lg p-4 space-y-2">
              <div className="flex items-center justify-between text-sm text-amber-200">
                <span>Import in progress</span>
                <span>
                  Started {new Date(status.running.startedAt).toLocaleTimeString()}
                </span>
              </div>
              <div className="w-full h-2 rounded-full bg-slate-700 overflow-hidden">
                <div
                  className="h-2 bg-amber-400"
                  style={{
                    width:
                      status.running.total && status.running.imported !== undefined
                        ? `${Math.min(
                            100,
                            Math.round(
                              (status.running.imported / Math.max(status.running.total, 1)) * 100
                            )
                          )}%`
                        : '25%',
                  }}
                />
              </div>
              <div className="flex items-center justify-between text-xs text-amber-100">
                <span>
                  Imported {status.running.imported ?? 0} / {status.running.total ?? '…'}
                </span>
                <span>Errors: {status.running.errors ?? 0}</span>
              </div>
              {status.running.lastError ? (
                <div className="text-xs text-amber-200">
                  Last error: {status.running.lastError}
                </div>
              ) : null}
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
              <p className="text-red-400">{error}</p>
            </div>
          )}

          {/* Success Result */}
          {result && (
            <div className={`border rounded-lg p-4 ${
              result.success 
                ? 'bg-green-500/10 border-green-500/20' 
                : 'bg-yellow-500/10 border-yellow-500/20'
            }`}>
              <p className={result.success ? 'text-green-400' : 'text-yellow-400'}>
                {result.message}
              </p>
              <div className="mt-2 text-sm text-slate-400">
                <p>Total: {result.progress.total}</p>
                <p>Imported: {result.progress.imported}</p>
                {result.progress.errors.length > 0 && (
                  <p>Errors: {result.progress.errors.length}</p>
                )}
              </div>
            </div>
          )}

          {/* Import Button */}
          <button
            onClick={handleImport}
            disabled={isImporting}
            className="w-full py-3 px-4 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white font-medium rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isImporting ? (
              <>
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Importing...
              </>
            ) : (
              <>
                <span>⬇️</span>
                Import from Shopify
              </>
            )}
          </button>

          <p className="text-slate-500 text-sm text-center">
            This will import all products from Shopify. Existing products will be updated.
          </p>

          {/* Dev Log Viewer */}
          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-400">Dev log (tail of logs/next-dev.log)</p>
              <button
                onClick={fetchLogs}
                className="text-xs px-3 py-1 rounded-md bg-slate-700 text-slate-200 hover:bg-slate-600 transition"
              >
                Refresh
              </button>
            </div>
            <div
              ref={logRef}
              className="bg-slate-900/60 border border-slate-700/70 rounded-lg p-3 text-xs text-slate-200 font-mono h-56 overflow-y-auto whitespace-pre-wrap"
            >
              {logError
                ? `⚠️ ${logError}`
                : logText
                  ? logText
                  : 'No log output yet.'}
            </div>
          </div>

          {/* Recent Errors */}
          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-400">Recent import errors</p>
              <button
                onClick={fetchStatus}
                className="text-xs px-3 py-1 rounded-md bg-slate-700 text-slate-200 hover:bg-slate-600 transition"
              >
                Refresh
              </button>
            </div>
            <div className="bg-slate-900/60 border border-slate-700/70 rounded-lg p-3 text-xs text-slate-200 space-y-2">
              {recentErrors.length === 0 && <div className="text-slate-500">No recent errors.</div>}
              {recentErrors.map((err) => (
                <div key={err.id} className="border-b border-slate-800 pb-2 last:border-b-0 last:pb-0">
                  <div className="flex items-center justify-between text-slate-400">
                    <span>{new Date(err.createdAt).toLocaleString()}</span>
                    <span className="uppercase text-[11px] text-amber-300">{err.status}</span>
                  </div>
                  {err.lastError && <div className="text-slate-200 mt-1">{err.lastError}</div>}
                </div>
              ))}
            </div>
            {errorsMeta.totalPages > 1 && (
              <div className="flex items-center justify-between text-xs text-slate-400 mt-2">
                <button
                  onClick={() => setErrorsPage(Math.max(1, errorsPage - 1))}
                  disabled={errorsPage === 1}
                  className="px-3 py-1 rounded bg-slate-700 disabled:opacity-50"
                >
                  Prev
                </button>
                <span>
                  Page {errorsPage} / {errorsMeta.totalPages} ({errorsMeta.total} errors)
                </span>
                <button
                  onClick={() => setErrorsPage(Math.min(errorsMeta.totalPages, errorsPage + 1))}
                  disabled={errorsPage === errorsMeta.totalPages}
                  className="px-3 py-1 rounded bg-slate-700 disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Google Drive Import */}
      <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 overflow-hidden">
        <div className="p-6 border-b border-slate-700/50">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-blue-500/20 flex items-center justify-center text-2xl">
              📁
            </div>
            <div>
              <h2 className="text-xl font-semibold text-white">Google Drive Import</h2>
              <p className="text-slate-400 text-sm">
                Browse the SKU folder from Drive (read-only) and verify access
              </p>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <label className="text-sm text-slate-300">Folder ID (optional)</label>
              <input
                value={driveFolderId}
                onChange={(e) => setDriveFolderId(e.target.value)}
                placeholder="Leave blank to use backend default"
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div className="flex items-end">
              <button
                onClick={() => fetchDriveFiles()}
                disabled={driveLoading}
                className="w-full py-3 px-4 bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white font-medium rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {driveLoading ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Loading...
                  </>
                ) : (
                  <>
                    <span>🔍</span>
                    List files
                  </>
                )}
              </button>
            </div>
          </div>

          {driveError && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-sm text-red-300">
              {driveError}
            </div>
          )}

          <div className="bg-slate-900/60 border border-slate-700/70 rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
              <div className="text-slate-200 text-sm">
                {driveLoading
                  ? 'Loading...'
                  : driveFiles.length
                    ? `${driveFiles.length} items`
                    : 'No files loaded yet'}
              </div>
              {driveFolderId && (
                <div className="text-[11px] text-slate-500 truncate max-w-md">
                  Folder: {driveFolderId}
                </div>
              )}
            </div>
            <div className="divide-y divide-slate-800 max-h-96 overflow-y-auto text-sm text-slate-200">
              {driveFiles.map((file) => (
                <div key={file.id} className="px-4 py-2 flex items-center justify-between">
                  <div className="truncate">
                    <span className="font-medium">{file.name}</span>
                    <span className="text-[11px] text-slate-500 ml-2">{file.mimeType}</span>
                  </div>
                  <div className="text-[11px] text-slate-500 ml-4 whitespace-nowrap">
                    {file.modifiedTime ? new Date(file.modifiedTime).toLocaleDateString() : ''}
                  </div>
                </div>
              ))}
              {!driveLoading && driveFiles.length === 0 && (
                <div className="px-4 py-6 text-center text-slate-500">No results yet.</div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Storj Browse */}
      <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 overflow-hidden">
        <div className="p-6 border-b border-slate-700/50">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-emerald-500/20 flex items-center justify-center text-2xl">
              ☁️
            </div>
            <div>
              <h2 className="text-xl font-semibold text-white">Storj Browse</h2>
              <p className="text-slate-400 text-sm">
                Peek into Storj via S3 list (read-only). Uses default bucket unless overridden.
              </p>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-sm text-slate-300">Bucket (optional)</label>
              <input
                value={storjBucket}
                onChange={(e) => setStorjBucket(e.target.value)}
                placeholder="Leave blank to use STORJ_S3_BUCKET"
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div className="md:col-span-2">
              <label className="text-sm text-slate-300">Prefix</label>
              <input
                value={storjPrefix}
                onChange={(e) => setStorjPrefix(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="flex justify-end">
            <button
              onClick={() => fetchStorjObjects()}
              disabled={storjLoading}
              className="py-3 px-4 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white font-medium rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {storjLoading ? (
                <>
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Loading...
                </>
              ) : (
                <>
                  <span>👁️</span>
                  List objects
                </>
              )}
            </button>
          </div>

          {storjError && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-sm text-red-300">
              {storjError}
            </div>
          )}

          <div className="bg-slate-900/60 border border-slate-700/70 rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
              <div className="text-slate-200 text-sm">
                {storjLoading
                  ? 'Loading...'
                  : storjObjects.length
                    ? `${storjObjects.length} items`
                    : 'No objects loaded yet'}
              </div>
              {(storjBucket || storjPrefix) && (
                <div className="text-[11px] text-slate-500 truncate max-w-md">
                  {storjBucket ? `Bucket: ${storjBucket} ` : ''}
                  {storjPrefix ? `Prefix: ${storjPrefix}` : ''}
                </div>
              )}
            </div>
            <div className="divide-y divide-slate-800 max-h-96 overflow-y-auto text-sm text-slate-200">
              {storjObjects.map((obj) => (
                <div key={obj.key} className="px-4 py-2 flex items-center justify-between">
                  <div className="truncate">
                    <span className="font-medium">{obj.key}</span>
                  </div>
                  <div className="text-[11px] text-slate-500 ml-4 whitespace-nowrap">
                    {obj.lastModified
                      ? new Date(obj.lastModified).toLocaleDateString()
                      : ''}
                  </div>
                </div>
              ))}
              {!storjLoading && storjObjects.length === 0 && (
                <div className="px-4 py-6 text-center text-slate-500">No results yet.</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

