import { listStorjPrefix } from '@/lib/storj'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const bucket =
      url.searchParams.get('bucket') ||
      process.env.STORJ_S3_BUCKET ||
      process.env.STORJ_BUCKET
    const prefix = url.searchParams.get('prefix') || 'products/'

    if (!bucket) {
      return NextResponse.json(
        { error: 'bucket is required (or set STORJ_S3_BUCKET)' },
        { status: 400 },
      )
    }

    const data = await listStorjPrefix(bucket, prefix)

    return NextResponse.json({
      bucket,
      prefix,
      ...data,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

