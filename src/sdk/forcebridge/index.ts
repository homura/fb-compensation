import type { Cell, Indexer, OutPoint, Script } from '@ckb-lumos/lumos'
import { Uint128 } from '@ckb-lumos/lumos/codec'
import { encodeToAddress, parseAddress } from '@ckb-lumos/lumos/helpers'
import {
  bufferCount,
  catchError,
  defer,
  distinct,
  EMPTY,
  expand,
  filter,
  forkJoin,
  from,
  lastValueFrom,
  map,
  mergeAll,
  mergeMap,
  retry,
  scan,
  toArray,
} from 'rxjs'

import { burnStartBlockNumber, isMainnet } from '@/env'
import { assert } from '@/lib/utils'

import { config, indexer, rpc } from '../lumos'
import testnetTokens from './testnet-tokens.json'
import tokens from './tokens.json'

export type TokenInfo = {
  // EVM address
  address: string
  symbol: string
  decimal: number
  logoURI: string
  source: 'Ethereum' | 'BSC'
  sudtArgs: string
}

export type TokenCell = TokenInfo & {
  outPoint: OutPoint
  tokenAmountUnit: bigint
  cellOutput: Cell['cellOutput']
  data: Cell['data']
}

export type ForceBridgeHelper = {
  getForceBridgeUDTInfos(): TokenInfo[]
  getSudtTypeInfo(): { codeHash: string; hashType: 'type' }

  fetchUserTokenCells(ckbAddress: string): Promise<TokenCell[]>
  fetchBurnTxs(ckbAddress: string): Promise<
    {
      txHash: string
      timestamp: number
      tokens: (TokenInfo & { tokenAmountUnit: bigint })[]
    }[]
  >
}

export function generateCKBAddress(ethAddress: string) {
  const ethAddressWithout0x = ethAddress.replace('0x', '')
  assert(ethAddressWithout0x.length === 40, 'Invalid ETH address')
  return encodeToAddress(
    {
      codeHash: config.SCRIPTS.OMNI_LOCK_V0!.CODE_HASH,
      hashType: config.SCRIPTS.OMNI_LOCK_V0!.HASH_TYPE,
      args: `0x01${ethAddressWithout0x}00`,
    },
    { config },
  )
}

export function createForceBridgeHelper(): ForceBridgeHelper {
  const tokenInfos = (isMainnet ? tokens : testnetTokens) as TokenInfo[]

  type SudtArgs = string
  const tokenMap: Record<SudtArgs, TokenInfo> = Object.fromEntries(
    tokenInfos.map((info) => [info.sudtArgs, info]),
  )

  const sudtTypeInfo = {
    codeHash: config.SCRIPTS.SUDT!.CODE_HASH,
    hashType: config.SCRIPTS.SUDT!.HASH_TYPE,
  }

  return {
    getForceBridgeUDTInfos: () => tokenInfos,
    getSudtTypeInfo: () => ({
      codeHash: config.SCRIPTS.SUDT!.CODE_HASH,
      hashType: config.SCRIPTS.SUDT!.HASH_TYPE as 'type',
    }),
    fetchUserTokenCells: async (ckbAddress: string) => {
      const lock = parseAddress(ckbAddress, { config })
      const sudtTypes = tokenInfos.map<Script>((info) => ({
        ...sudtTypeInfo,
        args: info.sudtArgs,
      }))

      const cells$ = from(sudtTypes).pipe(
        mergeMap((type) =>
          indexer
            .collector({ lock, type, scriptSearchMode: 'exact' })
            .collect(),
        ),
        map((cell) => {
          const tokenInfo = tokenMap[cell.cellOutput.type!.args]
          if (!tokenInfo || !cell.outPoint) {
            throw new Error('Token not found' + cell.cellOutput.type!.args)
          }

          return {
            ...tokenInfo,
            outPoint: cell.outPoint,
            tokenAmountUnit: Uint128.unpack(cell.data).toBigInt(),
            cellOutput: cell.cellOutput,
            data: cell.data,
          } satisfies TokenCell
        }),
        toArray(),
      )

      return lastValueFrom(cells$)
    },
    fetchBurnTxs: async (ckbAddress: string) => {
      const lock = parseAddress(ckbAddress, { config })

      const result$ = from(tokenInfos).pipe(
        mergeMap((info) => {
          const typeScript: Script = { ...sudtTypeInfo, args: info.sudtArgs }
          const filterParams = {
            script: lock,
            scriptType: 'lock',
            filter: {
              script: typeScript,
              blockRange: [
                `0x${burnStartBlockNumber.toString(16)}`,
                '0xffffffff',
              ],
            },
          } satisfies Parameters<Indexer['getTransactions']>[0]

          return defer(() => indexer.getTransactions(filterParams)).pipe(
            expand((result) =>
              result.lastCursor && result.lastCursor !== '0x'
                ? defer(() =>
                    indexer.getTransactions(filterParams, {
                      lastCursor: result.lastCursor,
                    }),
                  ).pipe(retry(3))
                : EMPTY,
            ),
            map((result) => result.objects.filter((v) => v.ioType === 'input')),
            scan(
              (acc, curr) => [...acc, ...curr],
              [] as Awaited<ReturnType<Indexer['getTransactions']>>['objects'],
            ),
          )
        }, 3),
        mergeAll(),
        distinct((v) => v.txHash),
        bufferCount(50),
        mergeMap((batch) =>
          forkJoin(
            batch.map((v) =>
              forkJoin({
                tx: from(rpc.getTransaction(v.txHash)),
                block: from(rpc.getHeaderByNumber(v.blockNumber)),
              }).pipe(
                map(({ tx, block }) => ({
                  ...tx.transaction,
                  timestamp: block.timestamp,
                  txHash: v.txHash,
                })),
              ),
            ),
          ),
        ),
        mergeMap((txs) =>
          from(txs).pipe(
            filter((tx) => tx.outputs.every((o) => !o.type)),
            mergeMap((tx) =>
              from(tx.inputs).pipe(
                map((input) => input.previousOutput.txHash),
                distinct(),
                bufferCount(50),
                mergeMap((hashes) =>
                  forkJoin(
                    hashes.map((hash) =>
                      from(rpc.getTransaction(hash)).pipe(
                        map((v) => v.transaction),
                        catchError(() => EMPTY),
                      ),
                    ),
                  ),
                ),
                map((inputTxs) => ({
                  tx,
                  inputMap: new Map(inputTxs.map((t) => [t.hash, t])),
                })),
              ),
            ),
          ),
        ),
        map(({ tx, inputMap }) => {
          const tokens = tx.inputs.flatMap((input) => {
            const prevTx = inputMap.get(input.previousOutput.txHash)
            if (!prevTx) return []

            const outputIndex = +input.previousOutput.index
            const cell = prevTx.outputs[outputIndex]

            if (
              !cell.type ||
              cell.type.hashType !== sudtTypeInfo.hashType ||
              cell.type.codeHash !== sudtTypeInfo.codeHash
            )
              return []

            const token = tokenMap[cell.type.args]
            return token
              ? [
                  {
                    ...token,
                    tokenAmountUnit: Uint128.unpack(
                      prevTx.outputsData[outputIndex],
                    ).toBigInt(),
                  },
                ]
              : []
          })

          return tokens.length
            ? { txHash: tx.hash, timestamp: +tx.timestamp, tokens }
            : null
        }),
        filter((v): v is NonNullable<typeof v> => !!v),
        toArray(),
      )
      return (await lastValueFrom(result$)).sort(
        (a, b) => +b.timestamp - +a.timestamp,
      )
    },
  }
}
