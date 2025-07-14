import { NextRequest } from 'next/server'
import * as R from 'remeda'

function parseFileContent(content: string) {
  const lines = content.split(/\r?\n/)
  return lines
    .slice(1)
    .map((v) => {
      const values = v.split(',')
      // source,evmTokenAddress,evmReceiverAddress,formattedAmount,amount,sudtArgs,burnTxHash,transferTxHash
      if (!values[5] || !values[6] || !values[7]) return
      return {
        ckbTxHash: values[6],
        sudtArgs: values[5],
        compensationHash: values[7],
      }
    })
    .filter((v) => !!v)
}

async function readGithub<R extends { path: string; name: string }>(
  githubAPIUrl: string,
) {
  const res = await fetch(githubAPIUrl)
  return (await res.json()) as R[]
}

function splitBlockFromFileName(fileName: string) {
  const fileNameWithoutType = fileName.split('.')[0]
  const blocks = fileNameWithoutType.split('-').slice(1)
  if (blocks.length !== 2)
    throw new Error(`${fileName} is not a valid file name`)
  return blocks.map((v) => +v)
}

async function queryAllCsv(githubApiPrefix: string, fileDir: string) {
  const dirs = await readGithub(`${githubApiPrefix}${fileDir}`)
  const files = await Promise.all(
    dirs.map((v) => readGithub(`${githubApiPrefix}${v.path}`)),
  )
  const allFiles = files.flat()
  return allFiles
    .filter((v) => v.name.endsWith('.csv') && !v.name.startsWith('burn-aggr'))
    .map((v) => ({
      ...v,
      blockRange: splitBlockFromFileName(v.name),
    }))
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const blocks = searchParams.get('blocks')?.split(',')
  if (!blocks || !blocks.length)
    return Response.json(
      { message: 'blocks parameter is required' },
      { status: 400 },
    )
  const githubRepo = process.env.GITHUB_REPO
  const githubCsvPath = process.env.GITHUB_CSV_PATH
  if (!githubRepo || !githubCsvPath)
    return Response.json(
      {
        message:
          'GITHUB_REPO or GITHUB_CSV_PATH environment variable is not set',
      },
      { status: 500 },
    )
  const githubAPIPrefix = `https://api.github.com/repos/${githubRepo}/contents/`
  const files = await queryAllCsv(githubAPIPrefix, githubCsvPath)
  const requestFiles = files.filter((v) =>
    blocks.some((b) => v.blockRange[0] <= +b && v.blockRange[1] >= +b),
  )
  const fileContents = (
    await Promise.all(
      requestFiles.map((f) =>
        fetch(`${githubAPIPrefix}${f.path}`)
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
