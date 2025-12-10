import { listFilesInFolder } from '@/lib/googleDrive'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const folderId =
      url.searchParams.get('folderId') || process.env.GOOGLE_DRIVE_SKU_FOLDER_ID

    if (!folderId) {
      return NextResponse.json(
        { error: 'folderId is required (or set GOOGLE_DRIVE_SKU_FOLDER_ID)' },
        { status: 400 },
      )
    }

    const files = await listFilesInFolder(folderId)

    return NextResponse.json({
      folderId,
      count: files.length,
      files,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

