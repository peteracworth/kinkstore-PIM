import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET() {
  try {
    const supabase = await createClient()
    
    // Test each table
    const tables = ['users', 'products', 'product_variants', 'media_buckets', 'media_assets', 'product_media_associations', 'sync_logs', 'audit_logs']
    const tableStatus: Record<string, string> = {}
    
    for (const table of tables) {
      const { error } = await supabase.from(table).select('count').limit(1)
      tableStatus[table] = error ? `error: ${error.message}` : 'ok'
    }

    // Test auth connection
    const { error: authError } = await supabase.auth.getSession()

    return NextResponse.json({
      status: 'ok',
      database: 'connected',
      auth: authError ? 'error' : 'connected',
      tables: tableStatus,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    return NextResponse.json({
      status: 'error',
      message: err instanceof Error ? err.message : 'Unknown error',
    }, { status: 500 })
  }
}
