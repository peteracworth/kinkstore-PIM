/**
 * Shopify Product Import Service
 * 
 * Imports products from Shopify and creates corresponding records in Supabase:
 * - products
 * - product_variants
 * - media_buckets (one per product)
 */

import { SupabaseClient } from '@supabase/supabase-js'
import { getShopifyClient } from './client'
import {
  GET_PRODUCTS,
  GET_PRODUCTS_COUNT,
  GetProductsResponse,
  GetProductsCountResponse,
  ShopifyProduct,
  extractShopifyId,
  convertWeightUnit,
} from './queries'

interface ImportProgress {
  total: number
  imported: number
  skipped: number
  errors: Array<{ productId: string; error: string }>
}

interface ImportResult {
  success: boolean
  message: string
  progress: ImportProgress
}

/**
 * Derive sku_label from variant SKUs
 * For multi-variant products: strip size/color suffix
 * For single-variant: use the SKU as-is
 */
function deriveSkuLabel(variants: ShopifyProduct['variants']): string | null {
  const skus = variants.edges
    .map(e => e.node.sku)
    .filter((sku): sku is string => sku !== null && sku.length > 0)

  if (skus.length === 0) return null

  if (skus.length === 1) {
    // Single variant - use SKU as-is
    return skus[0]
  }

  // Multi-variant - find common prefix
  // Example: RSV-V-PRODUCT-S, RSV-V-PRODUCT-M, RSV-V-PRODUCT-L -> RSV-V-PRODUCT
  const firstSku = skus[0]
  
  // Try to find a common base by removing common size/color suffixes
  const suffixPattern = /[-_](XXS|XS|S|M|L|XL|XXL|XXXL|2XL|3XL|ONE|OS|\d+)$/i
  const baseSkus = skus.map(sku => sku.replace(suffixPattern, ''))
  
  // Check if all base SKUs are the same
  const allSame = baseSkus.every(s => s === baseSkus[0])
  if (allSame && baseSkus[0].length > 0) {
    return baseSkus[0]
  }

  // Fallback: use first SKU as base
  return firstSku.replace(suffixPattern, '') || firstSku
}

/**
 * Convert Shopify metafields to our metadata JSONB format
 */
function convertMetafields(
  metafields: ShopifyProduct['metafields']
): Record<string, unknown> {
  const metadata: Record<string, unknown> = {}
  
  for (const { node } of metafields.edges) {
    const key = `${node.namespace}.${node.key}`
    
    // Try to parse JSON values
    try {
      metadata[key] = JSON.parse(node.value)
    } catch {
      metadata[key] = node.value
    }
  }

  return metadata
}

/**
 * Import a single product from Shopify to Supabase
 */
async function importProduct(
  supabase: SupabaseClient,
  product: ShopifyProduct
): Promise<void> {
  const shopifyProductId = extractShopifyId(product.id)
  const skuLabel = deriveSkuLabel(product.variants)
  const metadata = convertMetafields(product.metafields)

  // Upsert product
  const { data: productData, error: productError } = await supabase
    .from('products')
    .upsert({
      shopify_product_id: shopifyProductId,
      title: product.title,
      description: product.descriptionHtml?.replace(/<[^>]*>/g, '') || null,
      description_html: product.descriptionHtml || null,
      handle: product.handle,
      sku_label: skuLabel,
      vendor: product.vendor || null,
      product_type: product.productType || null,
      tags: product.tags,
      status: 'active',
      shopify_status: product.status,
      shopify_published_at: product.publishedAt,
      metadata,
      last_synced_at: new Date().toISOString(),
    }, {
      onConflict: 'shopify_product_id',
    })
    .select('id')
    .single()

  if (productError) {
    throw new Error(`Failed to upsert product: ${productError.message}`)
  }

  const productId = productData.id

  await upsertShopifyMedia(supabase, product, productId, shopifyProductId)

  // Upsert variants
  for (const { node: variant } of product.variants.edges) {
    const shopifyVariantId = extractShopifyId(variant.id)
    
    const weight = variant.inventoryItem?.measurement?.weight
    
    const { error: variantError } = await supabase
      .from('product_variants')
      .upsert({
        product_id: productId,
        shopify_variant_id: shopifyVariantId,
        sku: variant.sku,
        title: variant.title,
        price: parseFloat(variant.price),
        compare_at_price: variant.compareAtPrice ? parseFloat(variant.compareAtPrice) : null,
        weight: weight?.value ?? null,
        weight_unit: weight?.unit ? convertWeightUnit(weight.unit) : null,
        inventory_quantity: variant.inventoryQuantity,
        position: variant.position,
        option1: variant.selectedOptions[0]?.value || null,
        option2: variant.selectedOptions[1]?.value || null,
        option3: variant.selectedOptions[2]?.value || null,
      }, {
        onConflict: 'shopify_variant_id',
      })

    if (variantError) {
      console.error(`Failed to upsert variant ${shopifyVariantId}:`, variantError.message)
    }
  }

  // Create media bucket if it doesn't exist
  if (skuLabel) {
    const { error: bucketError } = await supabase
      .from('media_buckets')
      .upsert({
        product_id: productId,
        sku_label: skuLabel,
        storj_path: `products/${skuLabel}/`,
        bucket_status: 'active',
      }, {
        onConflict: 'product_id',
        ignoreDuplicates: true,
      })

    if (bucketError && !bucketError.message.includes('duplicate')) {
      console.error(`Failed to create media bucket:`, bucketError.message)
    }
  }
}

/**
 * Import all products from Shopify
 */
export async function importAllProducts(
  supabase: SupabaseClient,
  onProgress?: (progress: ImportProgress) => void
): Promise<ImportResult> {
  const shopify = getShopifyClient()
  
  // Get total count
  const countData = await shopify.query<GetProductsCountResponse>(GET_PRODUCTS_COUNT)
  const total = countData.productsCount.count

  const progress: ImportProgress = {
    total,
    imported: 0,
    skipped: 0,
    errors: [],
  }

  onProgress?.(progress)

  // Paginate through all products
  const pageGenerator = shopify.paginate<GetProductsResponse, ShopifyProduct>(
    GET_PRODUCTS,
    {},
    (data) => data.products.pageInfo,
    (data) => data.products.edges.map(e => e.node),
    { pageSize: 50 }
  )

  for await (const products of pageGenerator) {
    for (const product of products) {
      try {
        await importProduct(supabase, product)
        progress.imported++
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        progress.errors.push({
          productId: product.id,
          error: errorMessage,
        })
        console.error(`Error importing ${product.title}:`, errorMessage)
      }
    }

    onProgress?.(progress)
  }

  // Log sync
  await supabase.from('sync_logs').insert({
    sync_type: 'import_from_shopify',
    entity_type: 'product',
    status: progress.errors.length === 0 ? 'success' : 'partial',
    details: {
      total: progress.total,
      imported: progress.imported,
      errors: progress.errors.length,
    },
  })

  return {
    success: progress.errors.length === 0,
    message: `Imported ${progress.imported} of ${progress.total} products`,
    progress,
  }
}

export type { ImportProgress, ImportResult }

/**
 * Upsert Shopify media into staging table product_images_unassociated
 */
async function upsertShopifyMedia(
  supabase: SupabaseClient,
  product: ShopifyProduct,
  productId: string,
  shopifyProductId: number
) {
  const mediaEdges = product.media?.edges || []
  const now = new Date().toISOString()

  for (let idx = 0; idx < mediaEdges.length; idx++) {
    const node = mediaEdges[idx].node as {
      id: string
      alt?: string | null
      image?: { url?: string; width?: number; height?: number } | null
    }

    const url = node.image?.url
    if (!url) continue

    const filename = extractFilename(url)
    const mime = guessMime(filename)

    const { error } = await supabase
      .from('product_images_unassociated')
      .upsert(
        {
          shopify_media_id: node.id,
          shopify_product_id: shopifyProductId,
          product_id: productId,
          source_url: url,
          filename,
          alt_text: node.alt ?? null,
          mime_type: mime,
          byte_size: null,
          width: node.image?.width ?? null,
          height: node.image?.height ?? null,
          position: idx + 1,
          shopify_created_at: null,
          shopify_updated_at: null,
          updated_at: now,
        },
        { onConflict: 'shopify_media_id' }
      )

    if (error) {
      console.error(`Failed to upsert Shopify media ${node.id}:`, error.message)
    }
  }
}

function extractFilename(url: string): string {
  try {
    const u = new URL(url)
    const path = u.pathname.split('/')
    const last = path[path.length - 1]
    return last || url
  } catch {
    const parts = url.split('/')
    return parts[parts.length - 1] || url
  }
}

function guessMime(filename: string): string | null {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.avif')) return 'image/avif'
  return null
}

