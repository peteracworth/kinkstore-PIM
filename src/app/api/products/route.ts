import { createUntypedClient } from '@/lib/supabase/server-untyped'
import { NextRequest, NextResponse } from 'next/server'
import { buildCreatePayload } from './validate'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createUntypedClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Parse query params
    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1')
    const pageSize = parseInt(searchParams.get('pageSize') || '20')
    const search = (searchParams.get('search') || '').trim()
    const searchEscaped = search.replace(/,/g, '\\,')

    const offset = (page - 1) * pageSize

    // If searching, prefetch product IDs that match variant-side criteria so we can include them in the OR filter without duplicating rows
    const variantProductIds: string[] = []
    if (search) {
      const { data: variantHits } = await supabase
        .from('product_variants')
        .select('product_id')
        .or(
          [
            `sku.ilike.%${searchEscaped}%`,
            `id.eq.${searchEscaped}`,
            `shopify_variant_id.eq.${searchEscaped}`,
          ].join(',')
        )
        .limit(500)

      variantHits?.forEach((v) => {
        if (v.product_id) variantProductIds.push(v.product_id)
      })
    }

    // Build query
    let query = supabase
      .from('products')
      .select(
        `
        id,
        title,
        handle,
        sku_label,
        vendor,
        product_type,
        status,
        shopify_status,
        tags,
        last_synced_at,
        variants:product_variants(count)
      `,
        { count: 'exact' }
      )
      .order('title', { ascending: true })
      .range(offset, offset + pageSize - 1)

    // Add search filter across product fields and variant-linked product IDs
    if (search) {
      const isNumeric = /^[0-9]+$/.test(search)
      const filters = [
        `title.ilike.%${searchEscaped}%`,
        `sku_label.ilike.%${searchEscaped}%`,
        `handle.ilike.%${searchEscaped}%`,
        `id.eq.${searchEscaped}`,
      ]
      if (isNumeric) {
        filters.push(`shopify_product_id.eq.${searchEscaped}`)
      }
      if (variantProductIds.length > 0) {
        filters.push(`id.in.(${variantProductIds.join(',')})`)
      }
      query = query.or(filters.join(','))
    }

    const { data: products, count, error } = await query

    if (error) {
      console.error('Products query error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      products,
      total: count ?? 0,
      page,
      pageSize,
    })
  } catch (error) {
    console.error('Products API error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch products' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createUntypedClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const result = buildCreatePayload(body)
    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }
    const payload = result.payload

    const { data, error } = await supabase
      .from('products')
      .insert(payload)
      .select(
        `
        id,
        title,
        handle,
        sku_label,
        vendor,
        product_type,
        status,
        shopify_status,
        tags,
        description,
        description_html,
        shopify_product_id,
        shopify_published_at,
        created_at,
        updated_at,
        last_synced_at
      `
      )
      .single()

    if (error) {
      console.error('Product create error:', error)
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ product: data }, { status: 201 })
  } catch (error) {
    console.error('Product create API error:', error)
    return NextResponse.json(
      { error: 'Failed to create product' },
      { status: 500 }
    )
  }
}

