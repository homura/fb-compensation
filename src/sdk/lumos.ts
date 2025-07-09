import { Indexer } from '@ckb-lumos/lumos/ckb-indexer'
import { Config, MAINNET, TESTNET } from '@ckb-lumos/lumos/config'
import { RPC as OriginalRPC } from '@ckb-lumos/lumos/rpc'

import { isMainnet } from '@/env'

// @ts-expect-error gerCkbRpc is a private method
Indexer.prototype.getCkbRpc = function () {
  return new OriginalRPC(this.uri, { fetch: globalThis.fetch.bind(globalThis) })
}

class RPC extends OriginalRPC {
  constructor(url: string) {
    super(url, { fetch: globalThis.fetch.bind(globalThis) })
  }
}

export const CONFIG_TESTNET: Config = {
  ...TESTNET,
  SCRIPTS: {
    ...TESTNET.SCRIPTS,
    OMNILOCK: {
      CODE_HASH:
        '0x79f90bb5e892d80dd213439eeab551120eb417678824f282b4ffb5f21bad2e1e',
      HASH_TYPE: 'type',
      TX_HASH:
        '0x9154df4f7336402114d04495175b37390ce86a4906d2d4001cf02c3e6d97f39c',
      INDEX: '0x0',
      DEP_TYPE: 'code',
    },
    OMNI_LOCK_V0: {
      CODE_HASH:
        '0x79f90bb5e892d80dd213439eeab551120eb417678824f282b4ffb5f21bad2e1e',
      HASH_TYPE: 'type',
      TX_HASH:
        '0x9154df4f7336402114d04495175b37390ce86a4906d2d4001cf02c3e6d97f39c',
      INDEX: '0x0',
      DEP_TYPE: 'code',
    },
  },
}

export const CONFIG_MAINNET: Config = {
  ...MAINNET,
  SCRIPTS: {
    ...MAINNET.SCRIPTS,
    OMNI_LOCK_V0: {
      CODE_HASH:
        '0x9f3aeaf2fc439549cbc870c653374943af96a0658bd6b51be8d8983183e6f52f',
      HASH_TYPE: 'type',
      TX_HASH:
        '0xaa8ab7e97ed6a268be5d7e26d63d115fa77230e51ae437fc532988dd0c3ce10a',
      INDEX: '0x1',
      DEP_TYPE: 'code',
    },
  },
}

const config = isMainnet ? CONFIG_MAINNET : CONFIG_TESTNET
const rpcURL = isMainnet ? 'https://mainnet.ckb.dev' : 'https://testnet.ckb.dev'
const indexer = new Indexer(rpcURL)
const rpc = new RPC(rpcURL)

export { config, Indexer, indexer, RPC, rpc }
