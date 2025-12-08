'use client'

import { use, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

interface Variant {
  id: string
  title: string
  sku: string | null
  price: number | null
  compare_at_price: number | null
  weight: number | null
  weight_unit: string | null
  inventory_quantity: number | null
  position: number
  option1: string | null
  option2: string | null
  option3: string | null
  shopify_variant_id: number | null
}

interface ProductDetail {
  id: string
  title: string
  handle: string
  sku_label: string | null
  vendor: string | null
  product_type: string | null
  status: string
  shopify_status: string
  tags: string[]
  description: string | null
  description_html: string | null
  shopify_product_id: number | null
  shopify_published_at: string | null
  created_at: string
  updated_at: string
  last_synced_at: string | null
  metadata: Record<string, unknown> | null
  variants: Variant[]
  unassociated_media?: UnassociatedMedia[]
}

interface UnassociatedMedia {
  id: string
  shopify_media_id: string
  source_url: string
  filename: string | null
  alt_text: string | null
  mime_type: string | null
  width: number | null
  height: number | null
  position: number | null
  shopify_created_at: string | null
  shopify_updated_at: string | null
}

export default function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter()
  const { id } = use(params)
  const [product, setProduct] = useState<ProductDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/products/${id}`)
        if (res.status === 404) {
          if (!active) return
          setError('Product not found')
          return
        }
        if (res.status === 401) {
          router.push('/auth/login')
          return
        }
        const data = await res.json()
        if (!res.ok) {
          throw new Error(data.error || 'Failed to load product')
        }
        if (!active) return
        setProduct(data.product)
      } catch (err) {
        if (!active) return
        setError(err instanceof Error ? err.message : 'Failed to load product')
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => {
      active = false
    }
  }, [id, router])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400">
        <div className="w-5 h-5 border-2 border-slate-400/30 border-t-slate-400 rounded-full animate-spin mr-2" />
        Loading product...
      </div>
    )
  }

  if (error || !product) {
    return (
      <div className="bg-red-500/10 border border-red-500/20 text-red-300 rounded-xl p-6">
        {error || 'Product not found'}
      </div>
    )
  }

  const metaEntries = product.metadata ? Object.entries(product.metadata) : []

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white">{product.title}</h1>
          <p className="text-slate-400 mt-1">{product.handle}</p>
          <div className="flex gap-2 mt-2 flex-wrap">
            <span className="px-3 py-1 rounded-full bg-amber-500/15 text-amber-300 text-xs font-semibold">
              {product.sku_label || 'No SKU label'}
            </span>
            <span className="px-3 py-1 rounded-full bg-slate-700 text-slate-200 text-xs">
              {product.vendor || 'No vendor'}
            </span>
            <span className="px-3 py-1 rounded-full bg-slate-700 text-slate-200 text-xs">
              {product.product_type || 'No type'}
            </span>
            <span
              className={`px-3 py-1 rounded-full text-xs font-semibold ${
                product.shopify_status === 'ACTIVE'
                  ? 'bg-green-500/15 text-green-300'
                  : product.shopify_status === 'DRAFT'
                    ? 'bg-yellow-500/15 text-yellow-300'
                    : 'bg-slate-700 text-slate-200'
              }`}
            >
              {product.shopify_status}
            </span>
          </div>
        </div>
        <div className="text-right text-slate-400 text-sm">
          <p>Last synced: {product.last_synced_at ? new Date(product.last_synced_at).toLocaleString() : '—'}</p>
          <p>Updated: {new Date(product.updated_at).toLocaleString()}</p>
          <p>Created: {new Date(product.created_at).toLocaleString()}</p>
        </div>
      </div>

      {/* Description */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-2">Description</h2>
        <p className="text-slate-300 leading-relaxed">
          {product.description || 'No description'}
        </p>
      </div>

      {/* Variants */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-700/50 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Variants</h2>
          <span className="text-slate-400 text-sm">{product.variants.length} variants</span>
        </div>
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-700/50 text-slate-400 text-sm">
              <th className="px-6 py-3 text-left">Title</th>
              <th className="px-6 py-3 text-left">SKU</th>
              <th className="px-6 py-3 text-left">Price</th>
              <th className="px-6 py-3 text-left">Inventory</th>
              <th className="px-6 py-3 text-left">Options</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/50">
            {product.variants.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-6 text-center text-slate-400">
                  No variants
                </td>
              </tr>
            ) : (
              product.variants.map((variant) => (
                <tr key={variant.id} className="hover:bg-slate-700/30 transition-colors">
                  <td className="px-6 py-4 text-white">
                    <div className="font-medium">{variant.title}</div>
                    <div className="text-xs text-slate-500">Shopify ID: {variant.shopify_variant_id ?? '—'}</div>
                  </td>
                  <td className="px-6 py-4 text-slate-200 font-mono text-sm">
                    {variant.sku || '—'}
                  </td>
                  <td className="px-6 py-4 text-slate-200">
                    ${variant.price?.toFixed(2) ?? '—'}
                    {variant.compare_at_price ? (
                      <span className="text-xs text-slate-500 ml-2">
                        (Compare at ${variant.compare_at_price.toFixed(2)})
                      </span>
                    ) : null}
                  </td>
                  <td className="px-6 py-4 text-slate-200">
                    {variant.inventory_quantity ?? '—'}
                  </td>
                  <td className="px-6 py-4 text-slate-200 text-sm">
                    {[variant.option1, variant.option2, variant.option3].filter(Boolean).join(' / ') || '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Unassociated Shopify Media */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">Shopify Media (Unassociated)</h2>
          <span className="text-slate-400 text-sm">
            {product.unassociated_media?.length ?? 0} item(s)
          </span>
        </div>
        {(!product.unassociated_media || product.unassociated_media.length === 0) ? (
          <p className="text-slate-400">No unassociated Shopify media.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {product.unassociated_media.map((media) => (
              <div
                key={media.id}
                className="bg-slate-900/50 border border-slate-700/50 rounded-lg overflow-hidden"
              >
                {media.source_url ? (
                  <div className="aspect-video bg-slate-950 flex items-center justify-center">
                    <img
                      src={media.source_url}
                      alt={media.alt_text || media.filename || 'Shopify image'}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  </div>
                ) : (
                  <div className="aspect-video bg-slate-950 flex items-center justify-center text-slate-500">
                    No preview
                  </div>
                )}
                <div className="p-4 space-y-2">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>Position: {media.position ?? '—'}</span>
                    <span className="px-2 py-1 rounded-full bg-amber-500/15 text-amber-300 font-semibold">
                      Unassociated
                    </span>
                  </div>
                  <p className="text-sm text-white truncate">{media.filename || media.shopify_media_id}</p>
                  <p className="text-xs text-slate-500 truncate">{media.alt_text || 'No alt text'}</p>
                  <div className="text-xs text-slate-500 flex gap-2">
                    {media.width && media.height ? (
                      <span>{media.width}×{media.height}</span>
                    ) : null}
                    {media.mime_type ? <span>{media.mime_type}</span> : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Metadata */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Metadata</h2>
        {metaEntries.length === 0 ? (
          <p className="text-slate-400">No metadata</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {metaEntries.map(([key, value]) => (
              <div key={key} className="bg-slate-900/50 border border-slate-700/50 rounded-lg p-3">
                <p className="text-xs text-slate-500 mb-1">{key}</p>
                <pre className="text-sm text-slate-200 whitespace-pre-wrap break-words">
                  {JSON.stringify(value, null, 2)}
                </pre>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

