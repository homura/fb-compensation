import tokens from './tokens.json'
import { MAINNET, TESTNET } from '@ckb-lumos/lumos/config'
import type { OutPoint, Script } from '@ckb-lumos/lumos'
import { Indexer } from '../lumos'
import { parseAddress } from '@ckb-lumos/lumos/helpers'
import { from, lastValueFrom, map, mergeMap, toArray } from 'rxjs'

export type TokenInfo = {
  // EVM address
  address: string
  symbol: string
  decimal: number
  logoURI: string
  source: 'Ethereum' | 'BSC'
  sudtArgs: string
}

export type TokenCell = TokenInfo & { value: string; outPoint: OutPoint }

export type ForceBridgeHelper = {
  getForceBridgeUDTInfos(): TokenInfo[]
  getSudtTypeInfo(): { codeHash: string; hashType: 'type' }

  fetchUserTokenCells(ckbAddress: string): Promise<TokenCell[]>
}

export function createForceBridgeHelper({
  network = 'mainnet',
}: {
  network: 'mainnet' | 'testnet'
}): ForceBridgeHelper {
  const config = network === 'mainnet' ? MAINNET : TESTNET
  const indexer = new Indexer(
    network === 'mainnet'
      ? 'https://mainnet.ckb.dev'
      : 'https://testnet.ckb.dev',
  )
  const tokenInfos = tokens as TokenInfo[]

  type SudtArgs = string
  const tokenMap: Record<SudtArgs, TokenInfo> = Object.fromEntries(
    tokenInfos.map((info) => [info.sudtArgs, info]),
  )

  const sudtTypeInfo = {
    codeHash: config.SCRIPTS.SUDT.CODE_HASH,
    hashType: config.SCRIPTS.SUDT.HASH_TYPE,
  }

  return {
    getForceBridgeUDTInfos: () => tokenInfos,
    getSudtTypeInfo: () => ({
      codeHash: config.SCRIPTS.SUDT.CODE_HASH,
      hashType: config.SCRIPTS.SUDT.HASH_TYPE,
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
            value: cell.cellOutput.capacity,
            outPoint: cell.outPoint,
          } satisfies TokenCell
        }),
        toArray(),
      )

      return lastValueFrom(cells$)
    },
  }
}
