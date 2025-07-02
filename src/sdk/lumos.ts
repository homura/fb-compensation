import { Indexer } from '@ckb-lumos/lumos/ckb-indexer'
import { RPC as OriginalRPC } from '@ckb-lumos/lumos/rpc'

// @ts-expect-error gerCkbRpc is a private method
Indexer.prototype.getCkbRpc = function () {
  return new OriginalRPC(this.uri, { fetch: globalThis.fetch.bind(globalThis) })
}

class RPC extends OriginalRPC {
  constructor(url: string) {
    super(url, { fetch: globalThis.fetch.bind(globalThis) })
  }
}

export { Indexer, RPC }
