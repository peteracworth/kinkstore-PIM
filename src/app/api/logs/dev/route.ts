import { NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'

const LOG_PATH = path.join(process.cwd(), 'logs', 'next-dev.log')
const DEFAULT_LINES = 400

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const linesParam = url.searchParams.get('lines')
    const maxLines = Math.min(
      Math.max(parseInt(linesParam || '', 10) || DEFAULT_LINES, 50),
      2000
    )

    const file = await fs.readFile(LOG_PATH, 'utf8')
    const allLines = file.split('\n')
    const sliceStart = Math.max(allLines.length - maxLines, 0)
    const tail = allLines.slice(sliceStart).join('\n')

    return new NextResponse(tail, {
      status: 200,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
      },
    })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return NextResponse.json(
        { error: 'Log file not found', path: LOG_PATH },
        { status: 404 }
      )
    }
    return NextResponse.json(
      { error: 'Failed to read log file' },
      { status: 500 }
    )
  }
}

