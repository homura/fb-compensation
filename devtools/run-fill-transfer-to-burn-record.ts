// this script fill the `transferTxHash` field
// from burn-aggr-{from_block}-{to_block}.csv
// to burn-{from_block}-{to_block}.csv

import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

import { parse, unparse } from 'papaparse'
import { forkJoin, from, map, mergeMap, of } from 'rxjs'

import {
  AggrBurnRecord,
  asserts,
  BurnRecord,
  getDataDir,
  initContext,
  startFillTransferTxHash,
} from './helper'

const { values } = parseArgs({
  options: {
    testnet: { type: 'string' },
    aggrWeekDir: { type: 'string' },
  },
})
initContext({ isTestnet: values.testnet === 'true' })

async function run() {
  asserts(values.aggrWeekDir != null)
  const currentDir = join(await getDataDir(), values.aggrWeekDir)
  const fileNames = await readdir(currentDir)

  const burnRecordPaths = fileNames.filter((fileName) =>
    fileName.match(/^burn-\d+-\d+\.csv$/),
  )
  const aggrRecordPaths = fileNames.filter((fileName) =>
    fileName.match(/^burn-aggr-\d+-\d+\.csv$/),
  )

  asserts(burnRecordPaths.length > 0, 'Cannot find burn record')
  asserts(
    aggrRecordPaths.length === 1 && aggrRecordPaths[0] != null,
    'Cannot find or find multiple aggr record',
  )

  const aggrRecord = await readFile(join(currentDir, aggrRecordPaths[0])).then(
    (data) => data.toString(),
  )

  const parsedAggrBurnRecords = parse<AggrBurnRecord>(aggrRecord, {
    header: true,
  })

  asserts(
    parsedAggrBurnRecords.errors.length === 0,
    () =>
      `Invalid aggr record ${aggrRecordPaths} ${JSON.stringify(parsedAggrBurnRecords.errors)}, ${JSON.stringify(parsedAggrBurnRecords.data)}`,
  )

  const fillTransferTxHash = startFillTransferTxHash(parsedAggrBurnRecords.data)

  from(burnRecordPaths)
    .pipe(
      map((fileName) => join(currentDir, fileName)),
      mergeMap((burnRecordPath) =>
        forkJoin({
          content: readFile(burnRecordPath)
            .then((data) =>
              data.toString()
                ? parse<BurnRecord>(data.toString(), { header: true })
                : { data: [], errors: [] },
            )
            .then((res) => {
              if (res.errors.length > 0) {
                throw res.errors
              }
              return res.data
            })
            .then(fillTransferTxHash),
          path: of(burnRecordPath),
        }),
      ),
    )
    .subscribe(({ content, path }) => {
      void writeFile(path, unparse(content, { header: true }))
    })
}

void run()
