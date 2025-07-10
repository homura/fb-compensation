import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import fs from 'fs/promises'
import { EOL } from 'os'
import { unparse } from 'papaparse'
import { map, mergeMap, share, toArray } from 'rxjs'
import { parseArgs } from 'util'

import {
  BurnRecord,
  context,
  fetchBurnSummaries,
  fetchTransactions,
  initContext,
  logger,
  mapToBurnRecord,
  resolveTransaction,
} from './helper'

const CKB_CONFIRMATION_BLOCK_COUNT = 24

dayjs.extend(utc)

async function run() {
  const { values } = parseArgs({
    options: {
      testnet: { type: 'string' },
    },
  })
  const isTestnet = values.testnet === 'true'
  initContext(isTestnet)

  const lastBlockNumber = await getLastSavedBlockNumber()
  const defaultFromBlock = isTestnet ? 17000000 : 16720000
  const fromBlock = lastBlockNumber ?? defaultFromBlock

  const tipBlockNumber = await context.rpc
    .getIndexerTip()
    .then((res) => Number(res.blockNumber))
  const toBlock = tipBlockNumber - CKB_CONFIRMATION_BLOCK_COUNT

  logger.info(`Generating burn records from block ${fromBlock} to ${toBlock}`)

  const burnSummary$ = fetchBurnSummaries({ fromBlock, toBlock }).pipe(share())
  const burnTxHash$ = burnSummary$.pipe(map((summary) => summary.txHash))

  burnTxHash$
    .pipe(
      fetchTransactions,
      resolveTransaction,
      mergeMap(mapToBurnRecord),
      toArray(),
    )
    .subscribe((records) => {
      writeBurnRecords(records, fromBlock, toBlock)
    })
}

run()

// .data folder is structured as the following:
// .data/{yyyymmdd}-{yyyymmdd}/burn-{from_block}-{to_block}.csv and
// .data/{yyyymmdd}-{yyyymmdd}/burn-{from_block}-{to_block}-aggr.csv

const REGEX_DATE_RANGE = /^\d{8}-\d{8}$/
const REGEX_BURN_RECORD = /^burn-(\d+)-(\d+)\.csv$/

async function getLastSavedBlockNumber(): Promise<undefined | number> {
  const dataFolder = context.isTestnet ? '.data-testnet' : '.data'
  await fs
    .access(dataFolder, fs.constants.F_OK)
    .catch(() => fs.mkdir(dataFolder))

  return fs
    .readdir(dataFolder)
    .then((folderNames) => {
      const latestFolderName = folderNames
        .filter((name) => name.match(REGEX_DATE_RANGE))
        .sort((a, b) => a.localeCompare(b))
        .at(-1)

      if (!latestFolderName) return undefined
      return fs.readdir(`${dataFolder}/${latestFolderName}`)
    })
    .then((fileNames) => {
      if (!fileNames) return undefined
      const latestRecord = fileNames
        .filter((fileName) => fileName.match(REGEX_BURN_RECORD))
        .sort((a, b) => a.localeCompare(b))
        .at(-1)

      if (!latestRecord) return undefined

      const [, toBlock] = latestRecord.match(REGEX_BURN_RECORD)!.slice(1)
      return Number(toBlock)
    })
}

const UTC_OFFSET = 8

async function writeBurnRecords(
  records: BurnRecord[],
  fromBlock: number,
  toBlock: number,
): Promise<void> {
  const dataFolder = context.isTestnet ? '.data-testnet' : '.data'

  const today = dayjs().subtract(1, 'day').utcOffset(UTC_OFFSET)
  logger.info(`generate burn records for ${today.format('YYYYMMDD')}`)
  const weekStart = today.startOf('week').format('YYYYMMDD')
  const weekEnd = today.endOf('week').format('YYYYMMDD')

  const currentFolder = `${dataFolder}/${weekStart}-${weekEnd}`

  await fs
    .access(currentFolder, fs.constants.F_OK)
    .catch(() => fs.mkdir(currentFolder))

  const fileName = `burn-${fromBlock}-${toBlock}.csv`

  await fs.writeFile(`${currentFolder}/${fileName}`, unparse(records))

  if (process.env.GITHUB_OUTPUT) {
    const output = `from_block=${fromBlock}${EOL}to_block=${toBlock}${EOL}`
    await fs.appendFile(process.env.GITHUB_OUTPUT, output)
  }
}
