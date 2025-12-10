import { ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3'

type StorjObject = {
  key: string
  size?: number
  lastModified?: Date
}

let storjClient: S3Client | null = null

function getClient() {
  if (storjClient) return storjClient

  const endpoint = process.env.STORJ_S3_ENDPOINT || process.env.STORJ_ENDPOINT
  const accessKeyId =
    process.env.STORJ_S3_ACCESS_KEY_ID || process.env.STORJ_ACCESS_KEY_ID
  const secretAccessKey =
    process.env.STORJ_S3_SECRET_ACCESS_KEY || process.env.STORJ_SECRET_ACCESS_KEY
  const region = process.env.STORJ_S3_REGION || 'us-east-1'

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error(
      'Missing Storj S3 envs. Set STORJ_S3_ENDPOINT/STORJ_S3_ACCESS_KEY_ID/STORJ_S3_SECRET_ACCESS_KEY (or STORJ_ENDPOINT/STORJ_ACCESS_KEY_ID/STORJ_SECRET_ACCESS_KEY).',
    )
  }

  storjClient = new S3Client({
    region,
    endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  })

  return storjClient
}

export async function listStorjPrefix(bucket: string, prefix: string) {
  const client = getClient()

  const res = await client.send(
    new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      MaxKeys: 200,
    }),
  )

  const objects: StorjObject[] =
    res.Contents?.map((c) => ({
      key: c.Key || '',
      size: c.Size,
      lastModified: c.LastModified,
    })) || []

  const commonPrefixes = (res.CommonPrefixes || []).map((cp) => cp.Prefix || '')

  return { objects, commonPrefixes, isTruncated: !!res.IsTruncated, nextContinuationToken: res.NextContinuationToken }
}

