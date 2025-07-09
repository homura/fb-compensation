import { BI, commons, helpers, type Script } from '@ckb-lumos/lumos'
import { blockchain, bytify, hexify } from '@ckb-lumos/lumos/codec'
import { parseAddress, TransactionSkeletonType } from '@ckb-lumos/lumos/helpers'
import { useCallback, useEffect, useMemo, useState } from 'react'
import * as R from 'remeda'
import { toast } from 'sonner'
import { useAccount, useSignMessage } from 'wagmi'
import { SignMessageMutateAsync } from 'wagmi/query'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { isMainnet } from '@/env'
import {
  amountUnitToAmountScaled,
  calculateFeeCompatible,
  getTransactionSize,
} from '@/lib/utils'
import {
  createForceBridgeHelper,
  generateCKBAddress,
  type TokenCell,
} from '@/sdk/forcebridge'
import { config, indexer, rpc } from '@/sdk/lumos'

const SECP_SIGNATURE_PLACEHOLDER = hexify(
  new Uint8Array(
    commons.omnilock.OmnilockWitnessLock.pack({
      signature: new Uint8Array(65).buffer,
    }).byteLength,
  ),
)

const EXPLORER_URL = isMainnet
  ? 'https://explorer.nervos.org/'
  : 'https://testnet.explorer.nervos.org/'

function generateBurnTx(cells: TokenCell[], recipientLockScript: Script) {
  let txSkeleton = helpers.TransactionSkeleton({
    cellProvider: indexer,
  })
  const totalCKBShannon = R.sumBy(cells, (v) => BigInt(v.cellOutput.capacity))
  txSkeleton = txSkeleton.update('inputs', (v) =>
    v.push(
      ...cells.map((v) => ({
        outPoint: v.outPoint,
        cellOutput: v.cellOutput,
        data: v.data,
      })),
    ),
  )
  txSkeleton = txSkeleton.update('outputs', (o) =>
    o.push({
      cellOutput: {
        capacity: `0x${totalCKBShannon.toString(16)}`,
        lock: recipientLockScript,
      },
      data: '0x',
    }),
  )
  txSkeleton = txSkeleton.update('cellDeps', (v) =>
    v.push(
      {
        outPoint: {
          txHash: config.SCRIPTS.OMNILOCK!.TX_HASH,
          index: config.SCRIPTS.OMNILOCK!.INDEX,
        },
        depType: config.SCRIPTS.OMNILOCK!.DEP_TYPE,
      },
      {
        outPoint: {
          txHash: config.SCRIPTS.SECP256K1_BLAKE160!.TX_HASH,
          index: config.SCRIPTS.SECP256K1_BLAKE160!.INDEX,
        },
        depType: config.SCRIPTS.SECP256K1_BLAKE160!.DEP_TYPE,
      },
      {
        outPoint: {
          txHash: config.SCRIPTS.SUDT!.TX_HASH,
          index: config.SCRIPTS.SUDT!.INDEX,
        },
        depType: config.SCRIPTS.SUDT!.DEP_TYPE,
      },
    ),
  )
  const witness = hexify(
    blockchain.WitnessArgs.pack({ lock: SECP_SIGNATURE_PLACEHOLDER }),
  )
  // fill txSkeleton's witness with placeholder
  for (let i = 0; i < txSkeleton.inputs.toArray().length; i++) {
    txSkeleton = txSkeleton.update('witnesses', (witnesses) =>
      witnesses.push(witness),
    )
  }
  const txSize = getTransactionSize(txSkeleton)
  const fee = calculateFeeCompatible(txSize, 1000)
  return txSkeleton.update('outputs', (outputs) =>
    outputs.set(0, {
      ...outputs.get(0)!,
      cellOutput: {
        ...outputs.get(0)!.cellOutput,
        capacity: `0x${BI.from(totalCKBShannon).sub(fee).toString(16)}`,
      },
    }),
  )
}

async function signTx(
  tx: TransactionSkeletonType,
  signMessageAsync: SignMessageMutateAsync<unknown>,
  address: `0x${string}`,
) {
  tx = commons.omnilock.prepareSigningEntries(tx, { config })

  let signedMessage = await signMessageAsync({
    account: address,
    message: {
      raw: tx.signingEntries.get(0)!.message as `0x${string}`,
    },
  })

  let v = Number.parseInt(signedMessage.slice(-2), 16)
  if (v >= 27) v -= 27
  signedMessage =
    '0x' + signedMessage.slice(2, -2) + v.toString(16).padStart(2, '0')

  const signedWitness = hexify(
    blockchain.WitnessArgs.pack({
      lock: commons.omnilock.OmnilockWitnessLock.pack({
        signature: bytify(signedMessage),
      }),
    }),
  )
  tx = tx.update('witnesses', (witnesses) => witnesses.set(0, signedWitness))
  return helpers.createTransactionFromSkeleton(tx)
}

export default function BurnTokens() {
  const { address: ethAddress } = useAccount()
  const ckbAddress = ethAddress ? generateCKBAddress(ethAddress) : ''
  const [userTokenCells, setUserTokenCells] = useState<TokenCell[]>([])
  const { signMessageAsync } = useSignMessage()
  useEffect(() => {
    if (!ckbAddress) return
    const forcebridgeHelper = createForceBridgeHelper()
    forcebridgeHelper.fetchUserTokenCells(ckbAddress).then(setUserTokenCells)
  }, [ckbAddress])
  const [showZeroToken, setShowZeroToken] = useState(false)
  const userTokens = useMemo(() => {
    return R.pipe(
      userTokenCells,
      R.groupBy(R.prop('sudtArgs')),
      R.mapValues((v) => ({
        symbol: v[0].symbol,
        sudtArgs: v[0].sudtArgs,
        ckbAmountUnit: R.sumBy(v, (v) => BigInt(v.cellOutput.capacity)),
        tokenAmountUnit: R.sumBy(v, R.prop('tokenAmountUnit')),
        tokenAmountScaled: amountUnitToAmountScaled(
          R.sumBy(v, R.prop('tokenAmountUnit')),
          v[0].decimal,
        ),
      })),
      R.values(),
      showZeroToken ? R.identity() : R.filter((v) => v.tokenAmountUnit > 0),
    )
  }, [userTokenCells, showZeroToken])
  const [dialogVisible, setDialogVisible] = useState(false)
  const [recipientAddress, setRecipientAddress] = useState('')
  const [error, setError] = useState('')
  const [isPending, setIsPending] = useState(false)
  const totalCKBShannon = useMemo(
    () => R.sumBy(userTokens, R.prop('ckbAmountUnit')),
    [userTokens],
  )
  const onViewSummaryDialog = useCallback(async () => {
    if (!ckbAddress || !userTokenCells.length) {
      return
    }
    setDialogVisible(true)
    setRecipientAddress(ckbAddress)
  }, [ckbAddress, userTokenCells])
  const tokens = useMemo(() => userTokens.map((v) => v.sudtArgs), [userTokens])
  const onSignAndSend = useCallback(async () => {
    let recipientLockScript: Script | undefined = undefined
    try {
      recipientLockScript = parseAddress(recipientAddress, { config })
    } catch {
      setError('Invalid CKB address, please check again')
      return
    }
    if (!recipientLockScript || !ethAddress) {
      return
    }
    setIsPending(true)
    try {
      const tx = generateBurnTx(
        userTokenCells.filter((v) => tokens.includes(v.sudtArgs)),
        recipientLockScript,
      )
      const signedTx = await signTx(tx, signMessageAsync, ethAddress)
      const txHash = await rpc.sendTransaction(signedTx, 'passthrough')
      setDialogVisible(false)
      toast.success(`Transaction sent, txHash: ${txHash}`, {
        richColors: true,
        position: 'top-center',
        duration: 10_000,
        action: {
          label: 'View',
          onClick: () =>
            window.open(`${EXPLORER_URL}/transaction/${txHash}`, '_blank'),
        },
      })
    } catch (error) {
      toast.error(
        `Transaction sent failed, reason: ${error instanceof Error ? error.message : error}`,
        {
          richColors: true,
          position: 'top-right',
          duration: 10_000,
        },
      )
    } finally {
      setIsPending(false)
    }
  }, [ethAddress, recipientAddress, signMessageAsync, userTokenCells, tokens])
  return (
    <div>
      <div className="flex items-center gap-2 pb-2">
        <Checkbox
          id="show-zero-token"
          checked={showZeroToken}
          onCheckedChange={(v) => setShowZeroToken(v as boolean)}
        />
        <Label htmlFor="show-zero-token">show 0 balance tokens</Label>
      </div>
      <ul>
        {userTokens.map((v) => (
          <>
            <li key={v.sudtArgs} className="flex justify-between">
              <span>{v.symbol}:</span>
              <span>{v.tokenAmountScaled}</span>
            </li>
            <Separator className="my-2" />
          </>
        ))}
      </ul>
      <Button
        className="mt-2 w-full"
        disabled={!ckbAddress || !userTokenCells.length}
        onClick={onViewSummaryDialog}
      >
        Burn
      </Button>
      <Dialog open={dialogVisible} onOpenChange={setDialogVisible}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Burn Tokens</DialogTitle>
            <div className="text-[#64748B]">
              <ul className="list-inside list-disc">
                <li>
                  Tokens (
                  {userTokens
                    .map((v) => `${v.tokenAmountScaled} ${v.symbol}`)
                    .join(', ')}
                  ) will be paid to the address {ethAddress}
                </li>
                <li>Transfer is made on a weekly basis</li>
              </ul>
              <p className="pt-4">
                I want send the occupied{' '}
                {amountUnitToAmountScaled(totalCKBShannon, 8)} CKB to the CKB
                address
              </p>
            </div>
          </DialogHeader>
          <Input
            value={recipientAddress}
            onChange={(e) => {
              setRecipientAddress(e.target.value)
              setError('')
            }}
          />
          {error && <p className="text-red-500">{error}</p>}
          <DialogFooter>
            <Button
              className="w-3/4 text-right"
              disabled={isPending}
              onClick={onSignAndSend}
            >
              I know, burn and send occupied CKB!
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
