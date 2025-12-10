import { createUntypedClient } from '@/lib/supabase/server-untyped'
import { importAllProducts } from '@/lib/shopify/import'
import { NextRequest, NextResponse } from 'next/server'

export async function POST() {
  try {
    // Check auth
    const supabase = await createUntypedClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check user role - only admins can import
    const { data: appUser } = await supabase
      .from('users')
      .select('role')
      .eq('auth_user_id', user.id)
      .single()

    if (appUser?.role !== 'admin') {
      return NextResponse.json(
        { error: 'Admin access required' },
        { status: 403 }
      )
    }

    // create running log
    const { data: logRow, error: logError } = await supabase
      .from('sync_logs')
      .insert({
        sync_type: 'import_from_shopify',
        entity_type: 'product',
        status: 'partial', // using partial to satisfy check constraint; in_progress flag tracks running
        details: { total: null, imported: 0, errors: 0, in_progress: true },
        performed_by: null,
      })
      .select('id')
      .single()

    if (logError || !logRow?.id) {
      return NextResponse.json({ error: 'Failed to start import log' }, { status: 500 })
    }

    const logId = logRow.id

    // Run import with progress logging
    const result = await importAllProducts(supabase, {
      logId,
      progressEvery: 1,
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error('Import error:', error)
    return NextResponse.json(
      { 
        error: 'Import failed', 
        message: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  // Return import status / last sync info
  try {
    const url = new URL(request.url)
    const errorsPage = Math.max(parseInt(url.searchParams.get('errorsPage') || '1', 10) || 1, 1)
    const errorsPageSize = Math.min(
      Math.max(parseInt(url.searchParams.get('errorsPageSize') || '10', 10) || 10, 1),
      50
    )
    const errorsOffset = (errorsPage - 1) * errorsPageSize

    const supabase = await createUntypedClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: runningLog } = await supabase
      .from('sync_logs')
      .select('*')
      .eq('sync_type', 'import_from_shopify')
      .eq('status', 'partial')
      .contains('details', { in_progress: true })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const { data: lastLog } = await supabase
      .from('sync_logs')
      .select('*')
      .eq('sync_type', 'import_from_shopify')
      .in('status', ['success', 'partial', 'failed'])
      .or('details->>in_progress.is.null,details->>in_progress.eq.false')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    // Get product count
    const { count: productCount } = await supabase
      .from('products')
      .select('*', { count: 'exact', head: true })

    // Get unassociated media count and last update
    const { count: mediaCount } = await supabase
      .from('product_images_unassociated')
      .select('*', { count: 'exact', head: true })

    const { data: mediaLast } = await supabase
      .from('product_images_unassociated')
      .select('updated_at')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    // Recent errors (if any) for display
    const {
      data: recentErrors,
      count: recentErrorsCount,
    } = await supabase
      .from('sync_logs')
      .select(`
        id,
        created_at,
        status,
        details
      `, { count: 'exact' })
      .not('details->>lastError', 'is', null)
      .order('created_at', { ascending: false })
      .range(errorsOffset, errorsOffset + errorsPageSize - 1)

    return NextResponse.json({
      running: runningLog
        ? {
            status: runningLog.status,
            startedAt: runningLog.created_at,
            updatedAt: runningLog.updated_at,
            ...(runningLog.details || {}),
          }
        : null,
      lastCompleted: lastLog
        ? {
            status: lastLog.status,
            finishedAt: lastLog.created_at,
            ...(lastLog.details || {}),
          }
        : null,
      productCount,
      unassociatedMedia: {
        count: mediaCount ?? 0,
        lastUpdated: mediaLast?.updated_at ?? null,
      },
      recentErrors: recentErrors?.map((row) => ({
        id: row.id,
        createdAt: row.created_at,
        status: row.status,
        lastError: row.details?.lastError ?? null,
      })) ?? [],
      recentErrorsMeta: {
        page: errorsPage,
        pageSize: errorsPageSize,
        total: recentErrorsCount ?? 0,
        totalPages: recentErrorsCount ? Math.max(1, Math.ceil(recentErrorsCount / errorsPageSize)) : 1,
      },
    })
  } catch (error) {
    console.error('Status error:', error)
    return NextResponse.json(
      { error: 'Failed to get status' },
      { status: 500 }
    )
  }
}

