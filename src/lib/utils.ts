import { BI, BIish } from '@ckb-lumos/lumos'
import { blockchain } from '@ckb-lumos/lumos/codec'
import {
  createTransactionFromSkeleton,
  TransactionSkeletonType,
} from '@ckb-lumos/lumos/helpers'
import BigNumber from 'bignumber.js'
import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function unimplemented(): never {
  throw new Error('Not implemented')
}

export function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

export function amountUnitToAmountScaled(
  amount: bigint | number | string,
  unit: number,
): number {
  return new BigNumber(amount).div(10 ** unit).toNumber()
}

export function getTransactionSize(
  txSkeleton: TransactionSkeletonType,
): number {
  const tx = createTransactionFromSkeleton(txSkeleton)
  const serializedTx = blockchain.Transaction.pack(tx)
  const offset = 4 // 4 is serialized offset bytesize
  const size = serializedTx.byteLength + offset
  return size
}

export function calculateFeeCompatible(size: number, feeRate: BIish): BI {
  const ratio = BI.from(1000)
  const base = BI.from(size).mul(feeRate)
  const fee = base.div(ratio)
  if (fee.mul(ratio).lt(base)) {
    return fee.add(1)
  }
  return BI.from(fee)
}
