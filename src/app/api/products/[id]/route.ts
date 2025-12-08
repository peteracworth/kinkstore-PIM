import { createUntypedClient } from '@/lib/supabase/server-untyped'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params
    const supabase = await createUntypedClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: product, error } = await supabase
      .from('products')
      .select(`
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
        last_synced_at,
        metadata,
        variants:product_variants(
          id,
          title,
          sku,
          price,
          compare_at_price,
          weight,
          weight_unit,
          inventory_quantity,
          position,
          option1,
          option2,
          option3,
          shopify_variant_id
        )
      `)
      .eq('id', id)
      .single()

    if (product) {
      const { data: stagedMedia, error: mediaError } = await supabase
        .from('product_images_unassociated')
        .select(
          'id, shopify_media_id, source_url, filename, alt_text, mime_type, width, height, position, shopify_created_at, shopify_updated_at'
        )
        .or(
          `product_id.eq.${product.id},shopify_product_id.eq.${product.shopify_product_id ?? 'null'}`
        )
        .order('position', { ascending: true })

      if (mediaError) {
        console.error('Product media staging error:', mediaError)
      }

      return NextResponse.json({ product: { ...product, unassociated_media: stagedMedia ?? [] } })
    }

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
      }
      console.error('Product detail error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ product })
  } catch (error) {
    console.error('Product detail API error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch product' },
      { status: 500 }
    )
  }
}

