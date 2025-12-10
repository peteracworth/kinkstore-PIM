import { drive_v3, google } from 'googleapis'

const DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive.readonly']

let driveClientPromise: Promise<drive_v3.Drive> | null = null

function getServiceAccountCredentials() {
  const keyB64 = process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY
  if (!keyB64) {
    throw new Error('Missing GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY')
  }

  try {
    const json = Buffer.from(keyB64, 'base64').toString('utf8')
    return JSON.parse(json)
  } catch (err) {
    throw new Error(
      `Failed to parse GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY: ${
        err instanceof Error ? err.message : 'unknown error'
      }`,
    )
  }
}

async function getDriveClient(): Promise<drive_v3.Drive> {
  if (driveClientPromise) return driveClientPromise

  driveClientPromise = (async () => {
    const credentials = getServiceAccountCredentials()
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: DRIVE_SCOPES,
    })

    return google.drive({ version: 'v3', auth })
  })()

  return driveClientPromise
}

export async function listFilesInFolder(folderId: string) {
  const drive = await getDriveClient()

  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    fields: 'files(id,name,mimeType,size,modifiedTime)',
    pageSize: 200,
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
    orderBy: 'folder,name',
  })

  return res.data.files ?? []
}

