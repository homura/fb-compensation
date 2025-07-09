import { parseArgs } from 'node:util'

import { writeToPath } from 'fast-csv'
import { map, mergeMap, share, toArray } from 'rxjs'

import {
  aggregateBurnRecords,
  fetchBurnSummaries,
  fetchTransactions,
  initContext,
  logger,
  mapToBurnRecord,
  resolveTransaction,
} from './helper'

function run() {
  const { values } = parseArgs({
    options: {
      fromBlock: { type: 'string' },
      toBlock: { type: 'string' },
      testnet: { type: 'string' },
    },
  })

  initContext(values.testnet === 'true')

  const { fromBlock, toBlock } = values
  if (!fromBlock || !toBlock) {
    throw new Error('fromBlock is required')
  }

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
      writeToPath(
        `.data/burn-${Number(fromBlock)}-${Number(toBlock)}.csv`,
        records,
        { headers: true },
      )
      writeToPath(
        `.data/burn-${Number(fromBlock)}-${Number(toBlock)}-aggr.csv`,
        aggregateBurnRecords(records),
        { headers: true },
      )
    })
}

run()
