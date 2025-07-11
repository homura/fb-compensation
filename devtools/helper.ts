import { parseArgs } from 'node:util'

import {
  BI,
  BIish,
  Hash,
  HexNumber,
  HexString,
  Input,
  OutPoint,
  Output,
  RPC,
  Script,
  Transaction,
} from '@ckb-lumos/lumos'
import { Uint128 } from '@ckb-lumos/lumos/codec'
import { MAINNET, ScriptConfig, TESTNET } from '@ckb-lumos/lumos/config'
import { CKBComponents } from '@ckb-lumos/lumos/rpc'
import { formatUnit } from '@ckb-lumos/lumos/utils'
import {
  bufferTime,
  concatMap,
  distinct,
  EMPTY,
  expand,
  filter,
  from,
  identity,
  map,
  mergeMap,
  Observable,
  ObservableInput,
  scan,
  shareReplay,
  take,
} from 'rxjs'

import { Indexer } from '@/sdk'
import TestnetTokens from '@/sdk/forcebridge/testnet-tokens.json'
import MainnetTokens from '@/sdk/forcebridge/tokens.json'

const DEFAULT_BATCH_SIZE = 20

export const logger: {
  debug: (...msg: unknown[]) => void
  info: (...msg: unknown[]) => void
  warn: (...msg: unknown[]) => void
  error: (...msg: unknown[]) => void
} = console

export const context = (() => {
  const { values } = parseArgs({
    options: {
      testnet: { type: 'string' },
    },
  })

  const isTestnet = values.testnet === 'true'
  return createContext({ isTestnet })
})()

function createContext({ isTestnet }: { isTestnet: boolean }) {
  const IS_TESTNET: boolean = isTestnet

  const CKB_RPC_URL = IS_TESTNET
    ? 'https://testnet.ckb.dev'
    : 'https://mainnet.ckb.dev'

  logger.info(
    `------Running env------\n` +
      Object.entries({ IS_TESTNET, CKB_RPC_URL })
        .map(([key, value]) => `${key}: ${value}`)
        .join('\n') +
      '\n------',
  )

  const SCRIPT_CONFIG_LEGACY_OMNILOCK: ScriptConfig = IS_TESTNET
    ? {
        CODE_HASH:
          '0x79f90bb5e892d80dd213439eeab551120eb417678824f282b4ffb5f21bad2e1e',
        HASH_TYPE: 'type',
        DEP_TYPE: 'code',
        INDEX: '0x0',
        TX_HASH:
          '0x9154df4f7336402114d04495175b37390ce86a4906d2d4001cf02c3e6d97f39c',
      }
    : {
        CODE_HASH:
          '0x9f3aeaf2fc439549cbc870c653374943af96a0658bd6b51be8d8983183e6f52f',
        HASH_TYPE: 'type',
        DEP_TYPE: 'code',
        INDEX: '0x1',
        TX_HASH:
          '0xaa8ab7e97ed6a268be5d7e26d63d115fa77230e51ae437fc532988dd0c3ce10a',
      }

  const SCRIPT_CONFIG_SUDT: ScriptConfig = IS_TESTNET
    ? TESTNET.SCRIPTS.SUDT
    : MAINNET.SCRIPTS.SUDT

  const TOKEN_INFOS: TokenInfo[] = (
    IS_TESTNET ? TestnetTokens : MainnetTokens
  ) as TokenInfo[]

  return {
    isTestnet,
    indexer: new Indexer(CKB_RPC_URL),
    rpc: new RPC(CKB_RPC_URL),
    scriptConfigs: {
      sudt: SCRIPT_CONFIG_SUDT,
      legacyOmnilock: SCRIPT_CONFIG_LEGACY_OMNILOCK,
    },
    tokens: TOKEN_INFOS,
  }
}

function isLegacyOmnilockScript(script: Script): boolean {
  const { scriptConfigs } = context
  return (
    script.codeHash === scriptConfigs.legacyOmnilock.CODE_HASH &&
    script.hashType === scriptConfigs.legacyOmnilock.HASH_TYPE
  )
}

function isSudtScript(script: Script): boolean {
  const { scriptConfigs } = context
  return (
    script.codeHash === scriptConfigs.sudt.CODE_HASH &&
    script.hashType === scriptConfigs.sudt.HASH_TYPE
  )
}

type TokenInfo = {
  // EVM address
  address: string
  symbol: string
  decimal: number
  logoURI: string
  source: 'Ethereum' | 'BSC'
  sudtArgs: string
}

function getTokenInfo(filter: { sudtArgs: string }): TokenInfo | undefined {
  const { tokens } = context
  return tokens.find((token) => token.sudtArgs === filter.sudtArgs)
}

export type ResolvedOutput = { data: HexString; cellOutput: Output }

export type ResolvedInput = {
  previousOutput: OutPoint
  since: HexNumber
} & ResolvedOutput

export type ResolvedTransaction = Omit<Transaction, 'inputs' | 'outputs'> & {
  inputs: ResolvedInput[]
  outputs: ResolvedOutput[]
  hash: Hash
}

export type BurnSummary = {
  txHash: Hash
  blockNumber: number
  txIndex: number
}

export function fetchBurnSummaries({
  fromBlock,
  toBlock = '0xffffffff',
}: {
  fromBlock: BIish
  toBlock?: BIish
}): Observable<BurnSummary> {
  const { tokens, rpc, scriptConfigs } = context
  const pageSize = 100

  const generateSearchKey = (
    args: string,
  ): CKBComponents.GetTransactionsSearchKey<true> => ({
    groupByTransaction: true,
    script: {
      codeHash: scriptConfigs.sudt.CODE_HASH,
      hashType: scriptConfigs.sudt.HASH_TYPE,
      args,
    },
    scriptType: 'type',
    filter: {
      blockRange: [
        BI.from(fromBlock).toHexString(),
        BI.from(toBlock).toHexString(),
      ],
    },
    scriptSearchMode: 'exact',
  })

  return from(tokens).pipe(
    mergeMap((token) => {
      return from(
        rpc.getTransactions(
          generateSearchKey(token.sudtArgs),
          'asc',
          '0x' + pageSize.toString(16),
        ),
      ).pipe(
        expand((res) =>
          res.objects.length === pageSize
            ? rpc.getTransactions(
                generateSearchKey(token.sudtArgs),
                'asc',
                '0x' + pageSize.toString(16),
                res.lastCursor,
              )
            : EMPTY,
        ),
      )
    }, 5),
    concatMap((res) => res.objects),
    // a burn tx should ONLY contain sudt cells in inputs
    filter((obj) => obj.cells.every(([ioType]) => ioType === 'input')),
    distinct((obj) => obj.txHash),
    map((obj) => ({
      blockNumber: Number(obj.blockNumber),
      txIndex: Number(obj.txIndex),
      txHash: obj.txHash,
    })),
  )
}

export function fetchTransactions(
  txHashes: ObservableInput<Hash>,
): Observable<CKBComponents.Transaction> {
  const { rpc } = context

  return from(txHashes).pipe(
    map((txHash) => ['getTransaction', txHash] as ['getTransaction', string]),
    bufferTime(50, undefined, DEFAULT_BATCH_SIZE),
    filter((requests) => requests.length > 0),
    concatMap((requests) =>
      (
        rpc.createBatchRequest(requests).exec() as Promise<
          CKBComponents.TransactionWithStatus[]
        >
      ).then<CKBComponents.TransactionWithStatus[]>((txs) => {
        txs.forEach((tx, i) => {
          if (!tx.transaction) {
            throw new Error(`Failed to fetch transaction ${requests[i][1]}`)
          }
        })
        return txs as CKBComponents.TransactionWithStatus[]
      }),
    ),
    concatMap(identity),
    filter((tx) => tx.txStatus.status === 'committed'),
    map((tx) => tx.transaction),
  )
}

export function resolveTransaction(
  txsSource: ObservableInput<Transaction>,
): Observable<ResolvedTransaction> {
  const txs$ = from(txsSource)

  const inputHash$ = from(txs$).pipe(
    mergeMap((tx) => tx.inputs.map((input) => input.previousOutput.txHash)),
  )

  const previousTxMap$ = fetchTransactions(inputHash$).pipe(
    scan(
      (acc, tx) => ({ ...acc, [tx.hash]: tx }),
      {} as Record<Hash, Transaction>,
    ),
    shareReplay(1),
  )

  return txs$.pipe(
    mergeMap((tx) =>
      previousTxMap$.pipe(
        filter((previousTx) =>
          tx.inputs.every((input) => input.previousOutput.txHash in previousTx),
        ),
        take(1),
        map(
          (previousTxMap): ResolvedTransaction => ({
            ...tx,
            inputs: tx.inputs.map((input) => ({
              ...input,
              ...resolveInput(input, previousTxMap),
            })),
            outputs: mapOutputs(tx.outputs, tx.outputsData),
            hash: tx.hash!,
          }),
        ),
      ),
    ),
  )
}

export type BurnRecord = {
  sudtArgs: string
  evmTokenAddress: string
  evmReceiverAddress: string
  source: 'Ethereum' | 'BSC'
  amount: string
  formattedAmount: string
  burnTxHash: string
  transferTxHash: string
}

export function mapToBurnRecord(resolvedTx: ResolvedTransaction): BurnRecord[] {
  if (resolvedTx.outputs.some((output) => output.cellOutput.type != null)) {
    logger.warn(
      `Invalid burn tx found: ${resolvedTx.hash}, the output type is not null`,
    )
    return []
  }

  return resolvedTx.inputs
    .map<BurnRecord | undefined>((input, i) => {
      const { type, lock } = input.cellOutput

      if (!type || !isSudtScript(type)) {
        return undefined
      }

      const sudtArgs = type.args
      const tokenInfo = getTokenInfo({ sudtArgs })

      if (!tokenInfo) {
        return undefined
      }

      if (!isLegacyOmnilockScript(lock) || !lock.args.startsWith('0x01')) {
        logger.warn(`Burn with non-LegacyOmnilock found: ${resolvedTx.hash}`)
        return undefined
      }

      const amount = Uint128.unpack(resolvedTx.inputs[i].data)

      return {
        source: tokenInfo.source,
        evmTokenAddress: tokenInfo.address,
        evmReceiverAddress: '0x' + lock.args.slice(4, 44),
        formattedAmount:
          formatUnit(amount, tokenInfo.decimal) + ' ' + tokenInfo.symbol,
        amount: amount.toString(),
        sudtArgs: tokenInfo.sudtArgs,
        burnTxHash: resolvedTx.hash,
        transferTxHash: '',
      }
    })
    .filter((x) => x != null)
}

type AggrBurnRecord = Omit<BurnRecord, 'burnTxHash'> & {
  txHash?: string
}

export function aggregateBurnRecords(records: BurnRecord[]): AggrBurnRecord[] {
  const aggregatedRecords = Object.groupBy(
    records,
    (record) => `${record.sudtArgs}-${record.evmReceiverAddress}`,
  )
  return Object.entries(aggregatedRecords)
    .reduce((acc, [key, group]) => {
      const [sudtArgs, evmReceiverAddress] = key.split('-')

      if (!group) {
        throw new Error(`Cannot find group of the key: ${key}`)
      }

      const tokenInfo = getTokenInfo({ sudtArgs })
      if (!tokenInfo) {
        throw new Error(`Cannot find token info for sudt: ${sudtArgs}`)
      }
      const amount = group.reduce(
        (sum, record) => sum.add(record.amount),
        BI.from(0),
      )
      const formattedAmount =
        formatUnit(amount, tokenInfo.decimal) + ' ' + tokenInfo.symbol

      const aggrRecord: AggrBurnRecord = {
        evmTokenAddress: tokenInfo.address,
        evmReceiverAddress,
        source: tokenInfo.source,
        amount: amount.toString(),
        formattedAmount,
        sudtArgs: tokenInfo.sudtArgs,
        transferTxHash: '',
      }
      return acc.concat(aggrRecord)
    }, [] as AggrBurnRecord[])
    .sort((a, b) =>
      (a.source + a.evmTokenAddress + a.evmReceiverAddress).localeCompare(
        b.source + b.evmTokenAddress + b.evmReceiverAddress,
      ),
    )
}

function resolveInput(
  input: Input,
  transactionDict: Record<Hash, Transaction>,
): { data: HexString; cellOutput: Output } {
  const transaction = transactionDict[input.previousOutput.txHash]
  const outputIndex = Number(input.previousOutput.index)

  if (
    !transaction?.outputsData[outputIndex] ||
    !transaction?.outputs[outputIndex]
  ) {
    throw new Error('Cannot find corresponding transaction from the dictionary')
  }

  return {
    data: transaction.outputsData[outputIndex],
    cellOutput: transaction.outputs[outputIndex],
  }
}

function mapOutputs(
  outputs: Output[],
  outputsData: HexString[],
): ResolvedOutput[] {
  return outputs.map((output, i) => {
    if (outputsData[i] == null) {
      throw new Error('Cannot find corresponding outputsData')
    }
    return { cellOutput: output, data: outputsData[i] }
  })
}

export function getEnv(key: string, defaultValue?: string): string {
  const value = process.env[key]
  if (!value && !defaultValue) {
    throw new Error(`Environment variable ${key} is not set`)
  }
  return (value || defaultValue)!
}
