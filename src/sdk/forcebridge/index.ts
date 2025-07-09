import type { Cell, OutPoint, Script } from '@ckb-lumos/lumos'
import { Uint128 } from '@ckb-lumos/lumos/codec'
import { encodeToAddress, parseAddress } from '@ckb-lumos/lumos/helpers'
import { from, lastValueFrom, map, mergeMap, toArray } from 'rxjs'

import { isMainnet } from '@/env'
import { assert } from '@/lib/utils'

import { config, indexer } from '../lumos'
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
        mergeMap((type) => indexer.collector({ lock, type }).collect()),
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
  }
}
