import { NextRequest } from 'next/server'
import * as R from 'remeda'

function parseFileContent(content: string) {
  const lines = content.split('\n')
  return lines
    .slice(1)
    .map((v) => {
      const values = v.split(',')
      if (!values[0] || !values[1]) return
      return {
        ckbTxHash: values[0],
        sudtArgs: values[1],
        compensationHash: values[6],
      }
    })
    .filter((v) => !!v)
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const dates = searchParams.get('dates')?.split(',')
  if (!dates || !dates.length)
    return Response.json(
      { message: 'dates parameter is required' },
      { status: 400 },
    )
  const githubRepo = process.env.GITHUB_REPO
  if (!githubRepo)
    return Response.json(
      { message: 'GITHUB_REPO environment variable is not set' },
      { status: 500 },
    )
  const githubRepoCsvPath = process.env.GITHUB_CSV_PATH ?? 'compensation'
  const res = await fetch(
    `https://api.github.com/repos${githubRepo}/contents/${githubRepoCsvPath}`,
  )
  if (!res.ok) {
    return Response.json(
      { message: 'Failed to fetch from GitHub' },
      { status: 502 },
    )
  }
  const files = await res.json()
  if (!Array.isArray(files)) {
    console.error('Unexpected response from GitHub API:', files)
    return Response.json(
      { message: 'Unexpected response from GitHub API' },
      { status: 502 },
    )
  }
  const typedFiles = files as { path: string; name: string }[]
  const requestFiles = typedFiles.filter((v) =>
    dates.includes(v.name.split('.')[0]),
  )
  const fileContents = (
    await Promise.all(
      requestFiles.map((f) =>
        fetch(`https://api.github.com/repos${githubRepo}/contents/${f.path}`)
          .then((res) => res.json() as unknown as { content: string })
          .then((res) =>
            parseFileContent(Buffer.from(res.content, 'base64').toString()),
          ),
      ),
    )
  ).flat()
  return Response.json(
    R.pipe(
      fileContents,
      R.groupBy(R.prop('ckbTxHash')),
      R.mapValues(R.mapToObj((v) => [v.sudtArgs, v.compensationHash])),
    ),
  )
}
