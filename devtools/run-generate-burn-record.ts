import fs from 'node:fs/promises'
import { EOL } from 'node:os'
import { join } from 'node:path'

import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import { parse, unparse } from 'papaparse'
import {
  EMPTY,
  forkJoin,
  from,
  identity,
  lastValueFrom,
  map,
  mergeMap,
  of,
  reduce,
  toArray,
} from 'rxjs'

import {
  aggregateBurnRecords,
  BurnRecord,
  context,
  fetchBurnSummaries,
  fetchTransactions,
  logger,
  mapToBurnRecord,
  resolveTransaction,
} from './helper'

dayjs.extend(utc)

const CKB_CONFIRMATION_BLOCK_COUNT = 24

const UTC_OFFSET = 8
const TODAY = dayjs().subtract(1, 'day').utcOffset(UTC_OFFSET)

async function run() {
  logger.info(`Generate burn records for ${TODAY.format('YYYY-MM-DD')}`)
  if (context.isTestnet) {
    logger.info('Run in testnet mode')
  }

  const lastBlockNumber = await getLastSavedBlockNumber()
  const defaultFromBlock = context.isTestnet ? 17000000 : 16720000

  const fromBlock = lastBlockNumber ? lastBlockNumber + 1 : defaultFromBlock
  // make sure the toBlock is confirmed
  const toBlock = await context.rpc
    .getIndexerTip()
    .then((res) => Number(res.blockNumber) - CKB_CONFIRMATION_BLOCK_COUNT)

  logger.info(`Generating burn records from block ${fromBlock} to ${toBlock}`)

  const burnTxHash$ = fetchBurnSummaries({ fromBlock, toBlock }).pipe(
    map((summary) => summary.txHash),
  )

  fetchTransactions(burnTxHash$)
    .pipe(resolveTransaction, mergeMap(mapToBurnRecord), toArray())
    .subscribe(async (records) => {
      await writeBurnRecords(records, fromBlock, toBlock)
      if (process.env.GITHUB_OUTPUT) {
        const output = `${EOL}from_block=${fromBlock}${EOL}to_block=${toBlock}${EOL}`
        await fs.appendFile(process.env.GITHUB_OUTPUT, output)
      }

      // if today is the last day of the week, aggregate the burn records
      const isEndOfTheWeek = TODAY.day() === 6
      if (isEndOfTheWeek || context.aggrBurnRecord) {
        logger.info(`Start aggregating burn records`)
        await writeAggrBurnRecords()
      }
    })
}

// .data folder is structured as the following:
// .data/{yyyymmdd}-{yyyymmdd}/burn-{from_block}-{to_block}.csv and
// .data/{yyyymmdd}-{yyyymmdd}/burn-aggr-{from_block}-{to_block}.csv
const REGEX_DATE_RANGE = /^\d{8}-\d{8}$/
const REGEX_BURN_RECORD = /^burn-(\d+)-(\d+)\.csv$/

async function getLastSavedBlockNumber(): Promise<undefined | number> {
  const dataFolder = await getDataDir()
  return fs
    .readdir(dataFolder)
    .then((folderNames) => {
      const latestFolderName = folderNames
        .filter((name) => name.match(REGEX_DATE_RANGE))
        .sort((a, b) => a.localeCompare(b))
        .at(-1)

      if (!latestFolderName) return undefined
      return fs.readdir(join(dataFolder, latestFolderName))
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

async function getDataDir(): Promise<string> {
  const dataFolder = context.isTestnet ? '.data-testnet' : '.data'
  await fs
    .access(dataFolder, fs.constants.F_OK)
    .catch(() => fs.mkdir(dataFolder))
  return dataFolder
}

async function getCurrentWeekDir(): Promise<string> {
  const dataFolder = await getDataDir()
  const weekStart = TODAY.startOf('week').format('YYYYMMDD')
  const weekEnd = TODAY.endOf('week').format('YYYYMMDD')
  const weekDir = join(dataFolder, `${weekStart}-${weekEnd}`)
  await fs.access(weekDir, fs.constants.F_OK).catch(() => fs.mkdir(weekDir))
  return weekDir
}

async function writeBurnRecords(
  records: BurnRecord[],
  fromBlock: number,
  toBlock: number,
): Promise<void> {
  const currentFolder = await getCurrentWeekDir()
  const fileName = `burn-${fromBlock}-${toBlock}.csv`
  await fs.writeFile(join(currentFolder, fileName), unparse(records))
}

async function writeAggrBurnRecords() {
  const currentFolder = await getCurrentWeekDir()

  const burnRecords$ = from(fs.readdir(currentFolder)).pipe(
    mergeMap(identity),
    mergeMap((fileName) => {
      const match = fileName.match(REGEX_BURN_RECORD)
      if (!match) return EMPTY

      logger.debug(`Aggregating ${fileName}`)
      const [, fromBlock, toBlock] = match
      return forkJoin({
        fromBlock: of(Number(fromBlock)),
        toBlock: of(Number(toBlock)),
        records: fs
          .readFile(join(currentFolder, fileName), 'utf-8')
          .then((data) =>
            data
              ? parse<BurnRecord>(data, { header: true })
              : { data: [], errors: [] },
          )
          .then((res) => {
            if (res.errors.length > 0) {
              throw res.errors
            }
            return res.data
          }),
      })
    }),
    reduce(
      (acc, file) => {
        return {
          fromBlock: Math.min(acc.fromBlock, file.fromBlock),
          toBlock: Math.max(acc.toBlock, file.toBlock),
          records: [...acc.records, ...file.records],
        }
      },
      {
        fromBlock: Infinity,
        toBlock: -Infinity,
        records: [] as BurnRecord[],
      },
    ),
  )

  return lastValueFrom(burnRecords$).then(({ records, fromBlock, toBlock }) => {
    const aggrBurnRecords = aggregateBurnRecords(records)
    fs.writeFile(
      join(currentFolder, `burn-aggr-${fromBlock}-${toBlock}.csv`),
      unparse(aggrBurnRecords),
    )
  })
}

run()
