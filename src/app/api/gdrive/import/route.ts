import { downloadDriveFile, listFolderTree } from '@/lib/googleDrive'
import { uploadObject } from '@/lib/storj'
import { createUntypedClient } from '@/lib/supabase/server-untyped'
import { NextResponse } from 'next/server'

export const maxDuration = 300

function cleanPrefix(prefix?: string | null) {
  if (!prefix) return ''
  return prefix.replace(/^\/+/, '').replace(/\/+$/, '')
}

/**
 * Determine workflow category based on Google Drive folder path
 * For now, we import everything and will set proper constraints later
 */
function determineWorkflowCategory(filePath: string): string {
  const lowerPath = filePath.toLowerCase()

  // Check for raw captures folder
  if (lowerPath.includes('/raw captures/') || lowerPath.includes('/raw_captures/')) {
    return 'raw_capture'
  }

  // Check for final ecom folder
  if (lowerPath.includes('/final ecom') || lowerPath.includes('/final_ecom')) {
    return 'final_ecom'
  }

  // Check for PSD cutouts specifically
  if (lowerPath.includes('/psd') && lowerPath.includes('/cutouts')) {
    return 'psd_cutout'
  }

  // Check for other PSD or project files
  if (lowerPath.includes('/psd') || lowerPath.includes('/project')) {
    return 'project_file'
  }

  // For any other folders under Photos/, default to raw_capture
  // This allows importing everything now and categorizing later
  if (lowerPath.includes('/photos/')) {
    return 'raw_capture'
  }

  // Ultimate fallback
  return 'raw_capture'
}

export async function POST(request: Request) {
  try {
    console.log('=== GOOGLE DRIVE IMPORT STARTED ===')
    const body = await request.json().catch(() => ({}))
    const folderId = body.folderId || process.env.GOOGLE_DRIVE_SKU_FOLDER_ID
    const bucket = process.env.STORJ_S3_BUCKET || process.env.STORJ_BUCKET
    const supabase = await createUntypedClient()
    console.log('Auth check starting...')
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!folderId) {
      return NextResponse.json({ error: 'folderId is required (or set GOOGLE_DRIVE_SKU_FOLDER_ID)' }, { status: 400 })
    }
    if (!bucket) {
      return NextResponse.json({ error: 'bucket is required (set STORJ_S3_BUCKET or STORJ_BUCKET)' }, { status: 400 })
    }
    if (!user) {
      console.log('Auth failed: no user')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    console.log('Auth successful, user:', user.email)

    const basePath =
      cleanPrefix(body.basePath) ||
      cleanPrefix(process.env.STORJ_BASE_PATH || process.env.STORJ_PATH_PREFIX || '')

    console.log('Calling listFolderTree with folderId:', folderId)
    const files = await listFolderTree(folderId)
    console.log('Found', files.length, 'files in Google Drive')

    const results = {
      total: files.length,
      uploaded: 0,
      failed: 0,
      errors: [] as Array<{ path: string; message: string }>,
      assetsCreated: 0,
      bucketsCreated: 0,
      skippedNoProduct: 0,
    }

    const seenSkuLogs = new Set<string>()
    const bucketCache = new Map<
      string,
      { id: string; storjPath: string }
    >()

    for (const file of files) {
      try {
        const buffer = await downloadDriveFile(file.id)
        const pathParts = file.path.split('/')
        const skuLabel = pathParts[0]

        if (!skuLabel) {
          throw new Error('Missing SKU label in path')
        }

        // Log once per SKU when starting
        if (!seenSkuLogs.has(skuLabel)) {
          console.info(`IMPORTING SKU folder ${skuLabel}`)
          seenSkuLogs.add(skuLabel)
        }

        // Lookup/create media bucket for sku_label
        let bucketInfo = bucketCache.get(skuLabel)
        if (!bucketInfo) {
          const storjPath = [basePath, `products/${skuLabel}/`].filter(Boolean).join('')

          // Product lookup is optional; bucket can exist without a product
          const { data: product } = await supabase
            .from('products')
            .select('id, sku_label')
            .eq('sku_label', skuLabel)
            .single()

          const { data: mb, error: bucketErr } = await supabase
            .from('media_buckets')
            .upsert(
              {
                product_id: product?.id ?? null,
                sku_label: skuLabel,
                storj_path: storjPath,
                bucket_status: 'active',
                google_drive_folder_path: file.path.split('/').slice(0, -1).join('/'),
                last_upload_at: new Date().toISOString(),
              },
              { onConflict: 'sku_label', ignoreDuplicates: false },
            )
            .select('id, storj_path')
            .single()

          if (bucketErr) {
            console.error(
              `IMPORT ERROR bucket upsert failed sku=${skuLabel}: ${bucketErr.message}`,
            )
            throw new Error(`Bucket upsert failed for ${skuLabel}: ${bucketErr.message}`)
          }

          if (mb) {
            if (mb.id !== undefined) {
              results.bucketsCreated += 1
              console.log(`✓ Created media_bucket for SKU: ${skuLabel}, ID: ${mb.id}`)
            }
            bucketInfo = { id: mb.id, storjPath: mb.storj_path }
            bucketCache.set(skuLabel, bucketInfo)
            console.info(`MADE ENTRY IN media_buckets for ${skuLabel}`)
          } else {
            console.log(`✗ Bucket upsert returned no data for ${skuLabel}`)
            throw new Error(`Bucket upsert returned no data for ${skuLabel}`)
          }
        }

        const key = [basePath, file.path].filter(Boolean).join('/')
        await uploadObject(bucket, key, buffer, file.mimeType)
        results.uploaded += 1
        console.info(`STORED to STORJ with path ${key}`)

        const mediaType = file.mimeType.startsWith('image/')
          ? 'image'
          : file.mimeType.startsWith('video/')
            ? 'video'
            : 'file'

        const workflowCategory = determineWorkflowCategory(file.path)

        // Check if asset already exists to prevent duplicates
        const { data: existingAsset } = await supabase
          .from('media_assets')
          .select('id')
          .eq('file_key', key)
          .single()

        if (existingAsset) {
          console.log(`⏭️  Skipping duplicate file: ${file.name} (already exists)`)
          results.assetsCreated += 1 // Count as "created" for stats
          continue
        }

        const { error: assetErr } = await supabase.from('media_assets').insert({
          media_bucket_id: bucketInfo.id,
          media_type: mediaType,
          workflow_state: 'raw',
          workflow_category: workflowCategory,
          file_url: `storj://${bucket}/${key}`,
          file_key: key,
          file_size: buffer.length,
          file_mime_type: file.mimeType,
          original_filename: file.name,
          source_folder_path: file.path,
          google_drive_file_id: file.id,
          google_drive_folder_path: file.path.split('/').slice(0, -1).join('/'),
          import_source: 'google_drive',
        })

        if (assetErr) {
          console.error(
            `IMPORT ERROR media_assets insert failed sku=${skuLabel} path=${file.path}: ${assetErr.message}`,
          )
          throw new Error(`Asset insert failed for ${file.path}: ${assetErr.message}`)
        }

        results.assetsCreated += 1
        console.info(`MADE ENTRY IN media_assets for ${file.path}`)
      } catch (err) {
        results.failed += 1
        results.errors.push({
          path: file.path,
          message: err instanceof Error ? err.message : 'Unknown error',
        })
        console.error(
          `IMPORT ERROR sku=${file.path.split('/')[0] || 'unknown'} path=${file.path}: ${
            err instanceof Error ? err.message : 'Unknown error'
          }`,
        )
      }
    }

    return NextResponse.json({
      folderId,
      bucket,
      basePath,
      ...results,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

